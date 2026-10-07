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
alter table public.room_private add column if not exists wheel_qids int[] not null default '{}';

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
alter table public.teams add column if not exists correct_count int not null default 0;
alter table public.rooms add column if not exists wheel jsonb not null default '[]'::jsonb;   -- segmentos que quedan

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
  v_w record;
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
      select * into v_w from public._build_wheel();
      insert into public.room_private (room_code, wheel_qids) values (v_code, v_w.o_qids);
      update public.rooms set wheel = v_w.o_wheel where code = v_code;
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

-- Orden de las categorías. DEBE coincidir con R.CATEGORIES de js/config.js.
create or replace function public._wheel_categories()
returns text[] language sql immutable as $$
  select array['KYOTO','ROTTERDAM','ESCAZU','BASILEA','CITES','RAMSAR','PARIS',
               'MONTREAL','GINEBRA','GOTHENBURG','BRUNDTLAND','EPI','INTEGRADORA'];
$$;

-- Ruleta inicial: UN segmento por pregunta + 3 BONUS. Mismo algoritmo que R.buildWheel (js/config.js):
-- primera pregunta de cada categoría, luego la segunda…; los BONUS repartidos a lo largo.
-- o_wheel es público ([{c: categoría}]); o_qids (qué pregunta hay en cada segmento) es privado.
create or replace function public._build_wheel(out o_wheel jsonb, out o_qids int[])
language plpgsql stable as $$
declare
  v_bonus constant int := 3;
  v_c text; v_k int := 0; v_added boolean; v_q int; v_total int; v_pos int;
begin
  o_wheel := '[]'::jsonb;
  o_qids := '{}';
  loop
    v_added := false;
    foreach v_c in array public._wheel_categories() loop
      select q.id into v_q from public.questions q where q.category = v_c order by q.id offset v_k limit 1;
      if found then
        o_wheel := o_wheel || jsonb_build_array(jsonb_build_object('c', v_c));
        o_qids := o_qids || v_q;
        v_added := true;
      end if;
    end loop;
    exit when not v_added;
    v_k := v_k + 1;
  end loop;
  v_total := jsonb_array_length(o_wheel) + v_bonus;
  for b in 0 .. v_bonus - 1 loop
    v_pos := floor((b + 0.5) * v_total / v_bonus)::int;
    o_wheel := (select coalesce(jsonb_agg(e order by i), '[]'::jsonb) from (
                  select e, (case when i - 1 < v_pos then i - 1 else i end) as i
                  from jsonb_array_elements(o_wheel) with ordinality as x(e, i)
                  union all select jsonb_build_object('c', 'BONUS'), v_pos) y);
    o_qids := o_qids[1:v_pos] || 0 || o_qids[v_pos + 1:];
  end loop;
end $$;

-- El segmento (y con él la categoría y la pregunta) se decide AQUÍ, una sola vez, para todos los dispositivos.
create or replace function public.spin(p_code text)
returns void language plpgsql security definer set search_path = public as $$
declare
  r public.rooms;
  v_w record;
  v_n int;
  v_idx int;
  v_cat text;
  v_qid int;
  v_seg numeric;
  v_jitter numeric;
  v_landing numeric;
  v_rotation numeric;
begin
  r := public._host_room(p_code);
  perform public._require_phase(r, 'WAITING');
  if jsonb_array_length(r.wheel) = 0 then   -- ruleta agotada: se vuelve a armar
    select * into v_w from public._build_wheel();
    update public.rooms set wheel = v_w.o_wheel where code = r.code;
    update public.room_private set wheel_qids = v_w.o_qids where room_code = r.code;
    r.wheel := v_w.o_wheel;
  end if;

  v_n := jsonb_array_length(r.wheel);
  v_idx := floor(random() * v_n)::int;
  v_cat := r.wheel -> v_idx ->> 'c';
  select wheel_qids[v_idx + 1] into v_qid from public.room_private where room_code = r.code for update;

  v_seg := 360.0 / v_n;
  -- La aguja se detiene a un lado del centro (nunca encima del nombre), siempre dentro del segmento
  v_jitter := (case when random() < 0.5 then -1 else 1 end) * v_seg * (0.22 + random() * 0.16);
  v_landing := mod(mod(360 - (v_idx * v_seg + v_seg / 2 + v_jitter), 360) + 360, 360);
  v_rotation := floor(r.wheel_rotation / 360) * 360 + (7 + floor(random() * 3)) * 360 + v_landing;

  update public.room_private set pending_category = v_cat, question_id = nullif(v_qid, 0) where room_code = r.code;
  update public.rooms set
    phase = 'SPINNING',
    spin = jsonb_build_object('id', (extract(epoch from clock_timestamp()) * 1000)::bigint,
                              'categoryIndex', v_idx, 'rotation', v_rotation, 'durationMs', 7000),
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
  if r.current_category = 'BONUS' then raise exception 'Salió BONUS: no hay pregunta en esta ronda'; end if;
  select qq.* into q from public.questions qq
    where qq.id = (select question_id from public.room_private where room_code = r.code);
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

-- Quita de la ruleta el segmento usado y pasa a la siguiente ronda, o termina la partida.
-- Interna: la llaman finish_round y apply_bonus con la sala ya bloqueada.
create or replace function public._advance(p_code text)
returns void language plpgsql security definer set search_path = public as $$
declare r public.rooms; v_idx int; v_q int[];
begin
  select * into r from public.rooms where code = p_code;
  v_idx := (r.spin->>'categoryIndex')::int;
  if v_idx is not null then
    select wheel_qids into v_q from public.room_private where room_code = r.code;
    update public.room_private set wheel_qids = v_q[1:v_idx] || v_q[v_idx + 2:], pending_category = null, question_id = null
      where room_code = r.code;
    update public.rooms set wheel = wheel - v_idx where code = r.code;
  end if;
  if r.current_round >= r.total_rounds then
    update public.rooms set phase = 'GAME_OVER' where code = r.code;
  else
    update public.rooms set
      phase = 'WAITING', current_round = r.current_round + 1,
      spin = null, spin_started_at = null, current_category = null, question = null,
      question_started_at = null, question_deadline = null, answered_count = 0, results = null
    where code = r.code;
  end if;
end $$;

-- Cierra la ronda: calcula los puntos UNA vez (la fase lo garantiza) y vuelve a la ruleta.
-- Los puntos se guardan en segundo plano; la interfaz solo los muestra al final de la partida.
create or replace function public.finish_round(p_code text)
returns void language plpgsql security definer set search_path = public as $$
declare r public.rooms;
begin
  r := public._host_room(p_code);
  perform public._require_phase(r, 'ANSWER_LOCKED');
  with calc as (
    select t.id, coalesce(a.is_correct, false) as ok,
           public._calc_score(a.response_ms, coalesce(a.is_correct, false)) as pts
    from public.teams t
    left join public.answers a
      on a.team_id = t.id and a.room_code = t.room_code and a.round = r.current_round
    where t.room_code = r.code
  )
  update public.teams t set score = t.score + c.pts, correct_count = t.correct_count + (case when c.ok then 1 else 0 end)
  from calc c where t.id = c.id;
  perform public._advance(r.code);
end $$;

-- BONUS: se salta la pregunta y todos los equipos suman 5 puntos.
create or replace function public.apply_bonus(p_code text)
returns void language plpgsql security definer set search_path = public as $$
declare r public.rooms;
begin
  r := public._host_room(p_code);
  perform public._require_phase(r, 'CATEGORY_SELECTED');
  if r.current_category is distinct from 'BONUS' then raise exception 'Esta ronda no es BONUS'; end if;
  update public.teams set score = score + 5 where room_code = r.code;
  perform public._advance(r.code);
end $$;

-- Funciones de versiones anteriores (resultados y marcador entre rondas)
drop function if exists public.show_results(text);
drop function if exists public.show_leaderboard(text);
drop function if exists public.next_round(text);
drop function if exists public._pick_question(int[]);

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
                        'finish_round','apply_bonus','submit_answer',
                        '_calc_score','_host_room','_require_phase','_wheel_categories','_build_wheel','_advance')
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
