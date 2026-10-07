-- ============================================================================
-- RULETA AMBIENTAL — Fase 2: esquema, seguridad y lógica autoritativa
--
-- Ejecutar COMPLETO en el SQL Editor de Supabase (se puede repetir sin romper nada).
-- Requisito: Authentication → Providers → "Allow anonymous sign-ins" ACTIVADO.
--
-- Modelo de seguridad:
--   * Cada dispositivo entra con una sesión anónima de Supabase (auth.uid()).
--   * Los clientes SOLO pueden LEER rooms y teams de las salas en las que participan.
--   * Los clientes NO pueden escribir en ninguna tabla. Todo cambio pasa por funciones
--     RPC (SECURITY DEFINER) que validan rol, fase, tiempo y duplicados.
--   * La respuesta correcta vive en `questions`, que ningún cliente puede leer.
--   * El tiempo de respuesta se mide con el reloj del servidor (clock_timestamp()).
-- ============================================================================

-- ---------- Tablas ----------

create table if not exists public.questions (
  id             int primary key,
  category       text not null,
  type           text not null,
  question       text not null,
  options        jsonb not null,
  context        text,
  explanation    text,
  correct_answer int  not null
);

create table if not exists public.rooms (
  code              text primary key,
  host_id           uuid not null,
  phase             text not null default 'LOBBY'
                    check (phase in ('LOBBY','WAITING','SPINNING','CATEGORY_SELECTED','QUESTION_ACTIVE',
                                     'ANSWER_LOCKED','RESULTS','LEADERBOARD','GAME_OVER')),
  current_round     int  not null default 1,
  total_rounds      int  not null default 10,
  question_seconds  int  not null default 20,
  wheel_rotation    double precision not null default 0,
  spin              jsonb,
  spin_started_at   timestamptz,
  current_category  text,
  question          jsonb,             -- versión PÚBLICA de la pregunta (sin respuesta correcta)
  question_started_at timestamptz,
  question_deadline timestamptz,
  answered_count    int  not null default 0,
  results           jsonb,
  created_at        timestamptz not null default now()
);

-- Datos internos de la sala que ningún cliente puede leer.
create table if not exists public.room_private (
  room_code           text primary key references public.rooms(code) on delete cascade,
  pending_category    text,
  question_id         int,
  used_question_ids   int[] not null default '{}'
);

create table if not exists public.teams (
  id           uuid primary key default gen_random_uuid(),
  room_code    text not null references public.rooms(code) on delete cascade,
  user_id      uuid not null,
  name         text not null,
  name_key     text not null,
  score        int  not null default 0,
  round_points int  not null default 0,
  created_at   timestamptz not null default now(),
  unique (room_code, user_id),   -- un dispositivo = un equipo
  unique (room_code, name_key)   -- sin nombres duplicados en la sala
);

create table if not exists public.answers (
  room_code    text not null,
  round        int  not null,
  team_id      uuid not null references public.teams(id) on delete cascade,
  option_index int  not null,
  is_correct   boolean not null,
  response_ms  int  not null,
  received_at  timestamptz not null default clock_timestamp(),
  primary key (room_code, round, team_id)   -- una sola respuesta por equipo y ronda
);

-- ---------- Seguridad a nivel de fila ----------

alter table public.questions    enable row level security;
alter table public.rooms        enable row level security;
alter table public.room_private enable row level security;
alter table public.teams        enable row level security;
alter table public.answers      enable row level security;

revoke all on public.questions, public.rooms, public.room_private, public.teams, public.answers from anon, authenticated;
grant select on public.rooms, public.teams to authenticated;

create or replace function public.is_room_member(p_code text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.rooms where code = p_code and host_id = auth.uid())
      or exists (select 1 from public.teams where room_code = p_code and user_id = auth.uid());
$$;

drop policy if exists rooms_select on public.rooms;
create policy rooms_select on public.rooms for select to authenticated
  using (public.is_room_member(code));

drop policy if exists teams_select on public.teams;
create policy teams_select on public.teams for select to authenticated
  using (public.is_room_member(room_code));
-- No existen políticas de INSERT/UPDATE/DELETE: ningún cliente puede escribir directamente.

-- ---------- Utilidades internas ----------

-- Tabla de puntos por velocidad (idéntica a SCORE_TABLE de js/config.js).
create or replace function public._calc_score(p_response_ms int, p_correct boolean)
returns int language plpgsql immutable as $$
declare t numeric;
begin
  if not coalesce(p_correct, false) or p_response_ms is null then return 0; end if;
  t := greatest(p_response_ms, 0) / 1000.0;
  return case
    when t <= 2  then 100
    when t <= 4  then 90
    when t <= 6  then 80
    when t <= 8  then 70
    when t <= 10 then 60
    when t <= 12 then 50
    when t <= 14 then 40
    when t <= 16 then 30
    when t <= 18 then 25
    when t <= 20 then 20
    else 0 end;
end $$;

-- Bloquea la sala y comprueba que quien llama es el anfitrión.
create or replace function public._host_room(p_code text)
returns public.rooms language plpgsql security definer set search_path = public as $$
declare r public.rooms;
begin
  if auth.uid() is null then raise exception 'Sesión requerida'; end if;
  select * into r from public.rooms where code = upper(trim(p_code)) for update;
  if not found then raise exception 'Sala no encontrada'; end if;
  if r.host_id is distinct from auth.uid() then raise exception 'Solo el anfitrión puede hacer esto'; end if;
  return r;
end $$;

create or replace function public._require_phase(p_room public.rooms, p_phase text)
returns void language plpgsql as $$
begin
  if p_room.phase <> p_phase then
    raise exception 'Acción no permitida en la fase % (se esperaba %)', p_room.phase, p_phase;
  end if;
end $$;

-- ---------- RPC: salas y equipos ----------

create or replace function public.server_time()
returns bigint language sql stable security definer set search_path = public as $$
  select (extract(epoch from clock_timestamp()) * 1000)::bigint;
$$;

create or replace function public.create_room(p_total_rounds int default 10, p_question_seconds int default 20)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_alpha constant text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';  -- sin 0/O/1/I
  v_code text;
  v_try int := 0;
begin
  if auth.uid() is null then raise exception 'Sesión requerida'; end if;
  if p_total_rounds not between 1 and 50 then raise exception 'Número de rondas inválido'; end if;
  if p_question_seconds not between 5 and 120 then raise exception 'Tiempo de pregunta inválido'; end if;

  delete from public.rooms where created_at < now() - interval '1 day';  -- limpieza de salas viejas

  loop
    v_try := v_try + 1;
    v_code := 'ECO-'
      || substr(v_alpha, 1 + floor(random() * 31)::int, 1)
      || substr(v_alpha, 1 + floor(random() * 31)::int, 1)
      || substr(v_alpha, 1 + floor(random() * 31)::int, 1);
    begin
      insert into public.rooms (code, host_id, total_rounds, question_seconds)
        values (v_code, auth.uid(), p_total_rounds, p_question_seconds);
      insert into public.room_private (room_code) values (v_code);
      return v_code;
    exception when unique_violation then
      if v_try >= 30 then raise exception 'No se pudo generar un código único'; end if;
    end;
  end loop;
end $$;

create or replace function public.join_room(p_code text, p_name text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r public.rooms;
  t public.teams;
  v_code text := upper(trim(coalesce(p_code, '')));
  v_name text;
  v_key  text;
  v_idx  int;
begin
  if auth.uid() is null then raise exception 'Sesión requerida'; end if;
  select * into r from public.rooms where code = v_code for update;
  if not found then raise exception 'No se encontró la sala. Revisa el código.'; end if;
  if r.host_id = auth.uid() then raise exception 'El anfitrión no puede unirse como equipo'; end if;

  -- Reconexión: el mismo dispositivo recupera su equipo, puntos y respuesta.
  select * into t from public.teams where room_code = v_code and user_id = auth.uid();
  if found then
    select option_index into v_idx from public.answers
      where room_code = v_code and round = r.current_round and team_id = t.id;
    return jsonb_build_object('teamId', t.id, 'name', t.name,
      'myAnswer', case when v_idx is null then null
                       else jsonb_build_object('round', r.current_round, 'index', v_idx) end);
  end if;

  if r.phase <> 'LOBBY' then raise exception 'La partida ya comenzó. No se pueden unir más equipos.'; end if;

  v_name := regexp_replace(trim(coalesce(p_name, '')), '\s+', ' ', 'g');
  if v_name = '' then raise exception 'Escribe un nombre para tu equipo.'; end if;
  if char_length(v_name) < 2 then raise exception 'El nombre es demasiado corto.'; end if;
  if char_length(v_name) > 20 then raise exception 'El nombre es demasiado largo (máximo 20 caracteres).'; end if;
  v_key := translate(lower(v_name), 'áéíóúüñ', 'aeiouun');

  if (select count(*) from public.teams where room_code = v_code) >= 40 then
    raise exception 'La sala está llena.';
  end if;

  begin
    insert into public.teams (room_code, user_id, name, name_key)
      values (v_code, auth.uid(), v_name, v_key) returning * into t;
  exception when unique_violation then
    raise exception 'Ya existe un equipo con ese nombre en la sala.';
  end;
  return jsonb_build_object('teamId', t.id, 'name', t.name, 'myAnswer', null);
end $$;

create or replace function public.leave_room(p_code text)
returns void language plpgsql security definer set search_path = public as $$
declare r public.rooms;
begin
  select * into r from public.rooms where code = upper(trim(p_code)) for update;
  if found and r.phase = 'LOBBY' then
    delete from public.teams where room_code = r.code and user_id = auth.uid();
  end if;
end $$;

create or replace function public.close_room(p_code text)
returns void language plpgsql security definer set search_path = public as $$
declare r public.rooms;
begin
  r := public._host_room(p_code);
  delete from public.rooms where code = r.code;
end $$;

-- ---------- RPC: flujo de la partida (solo anfitrión) ----------

create or replace function public.start_game(p_code text)
returns void language plpgsql security definer set search_path = public as $$
declare r public.rooms;
begin
  r := public._host_room(p_code);
  perform public._require_phase(r, 'LOBBY');
  if not exists (select 1 from public.teams where room_code = r.code) then
    raise exception 'Necesitas al menos un equipo para iniciar.';
  end if;
  update public.rooms set phase = 'WAITING' where code = r.code;
end $$;

-- Segmentos de la ruleta en orden horario. DEBE coincidir con R.CATEGORIES de js/config.js.
create or replace function public._wheel_categories()
returns text[] language sql immutable as $$
  select array['KYOTO','ROTTERDAM','ESCAZU','BASILEA','CITES','RAMSAR','PARIS',
               'MONTREAL','GINEBRA','GOTHENBURG','BRUNDTLAND','EPI','INTEGRADORA'];
$$;

-- Elige categoría y pregunta SOLO entre categorías de la ruleta que aún tienen preguntas sin usar
-- en la partida. Una categoría sin preguntas cargadas (p. ej. ROTTERDAM, MONTREAL) nunca sale.
create or replace function public._pick_question(p_used int[], out o_category text, out o_question_id int, out o_reset boolean)
language plpgsql volatile as $$
declare v_avail text[];
begin
  o_reset := false;
  select array_agg(distinct q.category) into v_avail from public.questions q
    where q.category = any (public._wheel_categories()) and q.id <> all (coalesce(p_used, '{}'));
  if v_avail is null then   -- banco agotado: se empieza de nuevo
    o_reset := true;
    select array_agg(distinct q.category) into v_avail from public.questions q
      where q.category = any (public._wheel_categories());
  end if;
  if v_avail is null then raise exception 'No hay preguntas cargadas'; end if;
  o_category := v_avail[1 + floor(random() * array_length(v_avail, 1))::int];
  select q.id into o_question_id from public.questions q
    where q.category = o_category and (o_reset or q.id <> all (coalesce(p_used, '{}')))
    order by random() limit 1;
end $$;

-- La categoría y la pregunta se deciden AQUÍ, una sola vez, para todos los dispositivos.
create or replace function public.spin(p_code text)
returns void language plpgsql security definer set search_path = public as $$
declare
  r public.rooms;
  v_cats text[] := public._wheel_categories();
  v_n int := array_length(v_cats, 1);
  v_pick record;
  v_idx int;
  v_seg numeric;
  v_jitter numeric;
  v_landing numeric;
  v_rotation numeric;
  v_used int[];
begin
  r := public._host_room(p_code);
  perform public._require_phase(r, 'WAITING');

  select used_question_ids into v_used from public.room_private where room_code = r.code for update;
  select * into v_pick from public._pick_question(v_used);
  if v_pick.o_reset then v_used := '{}'; end if;

  v_idx := array_position(v_cats, v_pick.o_category) - 1;
  v_seg := 360.0 / v_n;
  v_jitter := (random() - 0.5) * v_seg * 0.7;   -- aterriza dentro del segmento, no siempre al centro
  v_landing := mod(mod(360 - (v_idx * v_seg + v_seg / 2 + v_jitter), 360) + 360, 360);
  v_rotation := floor(r.wheel_rotation / 360) * 360 + (5 + floor(random() * 3)) * 360 + v_landing;

  update public.room_private
     set pending_category = v_pick.o_category, question_id = v_pick.o_question_id,
         used_question_ids = array_append(v_used, v_pick.o_question_id)
   where room_code = r.code;

  update public.rooms set
    phase = 'SPINNING',
    spin = jsonb_build_object('id', (extract(epoch from clock_timestamp()) * 1000)::bigint,
                              'categoryIndex', v_idx, 'rotation', v_rotation, 'durationMs', 5200),
    spin_started_at = clock_timestamp(),
    wheel_rotation = v_rotation,
    current_category = null
  where code = r.code;
end $$;

create or replace function public.reveal_category(p_code text)
returns void language plpgsql security definer set search_path = public as $$
declare r public.rooms; v_cat text;
begin
  r := public._host_room(p_code);
  perform public._require_phase(r, 'SPINNING');
  if clock_timestamp() < r.spin_started_at + ((r.spin->>'durationMs')::int - 300) * interval '1 millisecond' then
    raise exception 'La ruleta aún está girando';
  end if;
  select pending_category into v_cat from public.room_private where room_code = r.code;
  update public.rooms set phase = 'CATEGORY_SELECTED', current_category = v_cat where code = r.code;
end $$;

create or replace function public.show_question(p_code text)
returns void language plpgsql security definer set search_path = public as $$
declare r public.rooms; q public.questions; v_start timestamptz := clock_timestamp();
begin
  r := public._host_room(p_code);
  perform public._require_phase(r, 'CATEGORY_SELECTED');
  select qq.* into q from public.questions qq
    where qq.id = (select question_id from public.room_private where room_code = r.code);
  update public.teams set round_points = 0 where room_code = r.code;
  update public.rooms set
    phase = 'QUESTION_ACTIVE',
    question = jsonb_build_object('id', q.id, 'type', q.type, 'question', q.question,
                                  'options', q.options, 'context', q.context),
    question_started_at = v_start,
    question_deadline = v_start + r.question_seconds * interval '1 second',
    answered_count = 0,
    results = null
  where code = r.code;
end $$;

create or replace function public.close_answers(p_code text)
returns void language plpgsql security definer set search_path = public as $$
declare r public.rooms;
begin
  r := public._host_room(p_code);
  perform public._require_phase(r, 'QUESTION_ACTIVE');
  update public.rooms set phase = 'ANSWER_LOCKED' where code = r.code;
end $$;

-- Calcula puntos UNA vez (la transición de fase lo garantiza) y publica los resultados.
create or replace function public.show_results(p_code text)
returns void language plpgsql security definer set search_path = public as $$
declare r public.rooms; q public.questions; v_rows jsonb;
begin
  r := public._host_room(p_code);
  perform public._require_phase(r, 'ANSWER_LOCKED');
  select qq.* into q from public.questions qq
    where qq.id = (select question_id from public.room_private where room_code = r.code);

  with calc as (
    select t.id, t.name, t.created_at, a.option_index, a.response_ms,
           coalesce(a.is_correct, false) as ok,
           public._calc_score(a.response_ms, coalesce(a.is_correct, false)) as pts
    from public.teams t
    left join public.answers a
      on a.team_id = t.id and a.room_code = t.room_code and a.round = r.current_round
    where t.room_code = r.code
  ), upd as (
    update public.teams t set score = t.score + c.pts, round_points = c.pts
    from calc c where t.id = c.id returning t.id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'teamId', c.id, 'name', c.name, 'answerIndex', c.option_index,
           'responseTime', case when c.response_ms is null then null else round(c.response_ms / 1000.0, 2) end,
           'correct', c.ok, 'points', c.pts) order by c.pts desc, c.created_at), '[]'::jsonb)
    into v_rows from calc c;

  update public.rooms set
    phase = 'RESULTS',
    results = jsonb_build_object('round', r.current_round, 'correctAnswer', q.correct_answer,
                                 'explanation', q.explanation, 'rows', v_rows)
  where code = r.code;
end $$;

create or replace function public.show_leaderboard(p_code text)
returns void language plpgsql security definer set search_path = public as $$
declare r public.rooms;
begin
  r := public._host_room(p_code);
  perform public._require_phase(r, 'RESULTS');
  update public.rooms set phase = 'LEADERBOARD' where code = r.code;
end $$;

-- Avanza de ronda o, tras la última, finaliza la partida.
create or replace function public.next_round(p_code text)
returns void language plpgsql security definer set search_path = public as $$
declare r public.rooms;
begin
  r := public._host_room(p_code);
  perform public._require_phase(r, 'LEADERBOARD');
  if r.current_round >= r.total_rounds then
    update public.rooms set phase = 'GAME_OVER' where code = r.code;
  else
    update public.teams set round_points = 0 where room_code = r.code;
    update public.room_private set pending_category = null, question_id = null where room_code = r.code;
    update public.rooms set
      phase = 'WAITING', current_round = r.current_round + 1,
      spin = null, spin_started_at = null, current_category = null, question = null,
      question_started_at = null, question_deadline = null, answered_count = 0, results = null
    where code = r.code;
  end if;
end $$;

-- ---------- RPC: respuesta de un equipo ----------

create or replace function public.submit_answer(p_code text, p_index int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r public.rooms;
  t public.teams;
  v_now timestamptz := clock_timestamp();   -- reloj del servidor: nunca el del teléfono
  v_correct int;
  v_nopts int;
  v_rows int;
begin
  if auth.uid() is null then raise exception 'Sesión requerida'; end if;
  select * into r from public.rooms where code = upper(trim(p_code)) for update;
  if not found then raise exception 'Sala no encontrada'; end if;
  select * into t from public.teams where room_code = r.code and user_id = auth.uid();
  if not found then raise exception 'Tu dispositivo no tiene un equipo en esta sala'; end if;

  if r.phase <> 'QUESTION_ACTIVE' then raise exception 'Las respuestas están cerradas.'; end if;
  if v_now > r.question_deadline + interval '500 milliseconds' then  -- margen por latencia de red
    raise exception 'Se acabó el tiempo.';
  end if;

  select q.correct_answer, jsonb_array_length(q.options) into v_correct, v_nopts
    from public.questions q
    where q.id = (select question_id from public.room_private where room_code = r.code);
  if p_index is null or p_index < 0 or p_index >= v_nopts then raise exception 'Opción inválida.'; end if;

  insert into public.answers (room_code, round, team_id, option_index, is_correct, response_ms, received_at)
    values (r.code, r.current_round, t.id, p_index, p_index = v_correct,
            round(extract(epoch from (v_now - r.question_started_at)) * 1000)::int, v_now)
    on conflict do nothing;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then raise exception 'Tu equipo ya respondió.'; end if;

  update public.rooms set answered_count = answered_count + 1 where code = r.code;
  return jsonb_build_object('round', r.current_round, 'index', p_index);
end $$;

-- ---------- Permisos de las funciones ----------

do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig, p.proname
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('is_room_member','server_time','create_room','join_room','leave_room','close_room',
                        'start_game','spin','reveal_category','show_question','close_answers',
                        'show_results','show_leaderboard','next_round','submit_answer',
                        '_calc_score','_host_room','_require_phase','_wheel_categories','_pick_question')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    if left(f.proname, 1) <> '_' then
      execute format('grant execute on function %s to authenticated', f.sig);
    end if;
  end loop;
end $$;

-- ---------- Realtime ----------

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin alter publication supabase_realtime add table public.rooms; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.teams; exception when duplicate_object then null; end;
  end if;
end $$;
