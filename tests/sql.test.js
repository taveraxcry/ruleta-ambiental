/* Pruebas de la lógica autoritativa y de la seguridad (RLS + RPC) sobre Postgres real. */
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { startDb } = require('./pgtest');

// Mismas categorías, preguntas y ruleta que el frontend
global.window = {};
eval(fs.readFileSync(path.join(__dirname, '../js/config.js'), 'utf8'));
eval(fs.readFileSync(path.join(__dirname, '../js/questions.js'), 'utf8'));
const RJ = window.Ruleta;
const CATS = RJ.CATEGORIES.map((c) => c.id);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ✓', name); }
  catch (e) { console.log('  ✗', name, '\n     ', e.message); process.exitCode = 1; }
}
async function rejects(promise, re, label) {
  try { await promise; } catch (e) { if (re.test(e.message)) return; throw new Error(label + ': error inesperado: ' + e.message); }
  throw new Error(label + ': debía fallar y no falló');
}

(async () => {
  const db = await startDb(54329);
  const uuid = () => crypto.randomUUID();
  const host = uuid(), other = uuid();
  const teams = { A: uuid(), B: uuid(), C: uuid() };
  const q = (u, sql, p) => db.asUser(u, sql, p);
  const rpc = async (u, fn, ...args) => {
    const ph = args.map((_, i) => '$' + (i + 1)).join(',');
    return (await q(u, `select public.${fn}(${ph}) as r`, args)).rows[0].r;
  };
  const room = async (u, code) => (await q(u, 'select * from public.rooms where code=$1', [code])).rows[0];
  const priv = async (code) => (await db.admin.query('select * from public.room_private where room_code=$1', [code])).rows[0];
  const scores = async (code) => Object.fromEntries((await db.admin.query('select name, score, correct_count from public.teams where room_code=$1', [code])).rows.map((r) => [r.name, r]));
  /* Prepara la ruleta con segmentos concretos (solo pruebas) para que el resultado del giro sea determinista. */
  const setWheel = async (code, segs) => {
    await db.admin.query('update public.rooms set wheel=$2 where code=$1', [code, JSON.stringify(segs.map((s) => ({ c: s.c })))]);
    await db.admin.query('update public.room_private set wheel_qids=$2 where room_code=$1', [code, segs.map((s) => s.q)]);
  };
  const spinAndReveal = async (code) => { await rpc(host, 'spin', code); await sleep(6900); await rpc(host, 'reveal_category', code); };
  let code;

  console.log('\nSala y equipos');
  await test('el anfitrión crea una sala con código ECO-XXX y una ruleta de 23 segmentos', async () => {
    code = await rpc(host, 'create_room', 4, 20);
    assert.match(code, /^ECO-[2-9A-HJKMNP-Z]{3}$/);
    const r = await room(host, code), p = await priv(code);
    assert.strictEqual(r.wheel.length, 23);
    assert.strictEqual(p.wheel_qids.length, 23);
  });
  await test('la ruleta del servidor es idéntica a la del frontend (orden, categorías, preguntas y BONUS)', async () => {
    const r = await room(host, code), p = await priv(code);
    const js = RJ.buildWheel(RJ.QUESTIONS);
    assert.deepStrictEqual(r.wheel.map((s, i) => s.c + '#' + p.wheel_qids[i]), js.map((s) => s.c + '#' + s.q));
    assert.strictEqual(r.wheel.filter((s) => s.c === 'BONUS').length, 3);
    assert.ok(!r.wheel.some((s) => s.c === 'ROTTERDAM' || s.c === 'MONTREAL'), 'categorías sin material no aparecen');
  });
  await test('la ruleta pública no revela qué pregunta hay en cada segmento', async () => {
    const r = await room(teams.A, code).catch(() => null);
    const r2 = await room(host, code);
    assert.ok(!JSON.stringify(r2.wheel).match(/"q"|\d{1,2}\b/), 'el segmento solo lleva la categoría');
    assert.strictEqual(r, undefined);   // A aún no es miembro de la sala
  });
  await test('los equipos se unen con nombre libre', async () => {
    const a = await rpc(teams.A, 'join_room', code.toLowerCase(), '  Eco   Team ');
    assert.strictEqual(a.name, 'Eco Team');
    await rpc(teams.B, 'join_room', code, 'Los Verdes');
    await rpc(teams.C, 'join_room', code, 'Guardianes');
  });
  await test('rechaza nombre vacío, largo y duplicado (sin tildes/mayúsculas)', async () => {
    await rejects(rpc(other, 'join_room', code, '   '), /nombre/i, 'vacío');
    await rejects(rpc(other, 'join_room', code, 'x'.repeat(21)), /largo/i, 'largo');
    await rejects(rpc(other, 'join_room', code, 'ECO TEAM'), /Ya existe/, 'duplicado');
    await rejects(rpc(other, 'join_room', 'ECO-ZZZ', 'Nuevo'), /No se encontró/, 'sala inexistente');
  });
  await test('reconexión: el mismo dispositivo recupera su equipo sin duplicarlo', async () => {
    const again = await rpc(teams.A, 'join_room', code, 'Otro nombre cualquiera');
    assert.strictEqual(again.name, 'Eco Team');
    const n = (await q(host, 'select count(*)::int n from public.teams where room_code=$1', [code])).rows[0].n;
    assert.strictEqual(n, 3);
  });
  await test('el anfitrión no puede unirse como equipo', async () => {
    await rejects(rpc(host, 'join_room', code, 'Host Team'), /anfitrión/, 'host como equipo');
  });

  console.log('\nSeguridad');
  await test('los equipos no pueden usar controles del anfitrión', async () => {
    for (const fn of ['start_game', 'spin', 'reveal_category', 'show_question', 'close_answers', 'finish_round', 'apply_bonus', 'close_room']) {
      await rejects(rpc(teams.A, fn, code), /Solo el anfitrión/, fn);
    }
  });
  await test('un cliente no puede escribir directamente en las tablas', async () => {
    await rejects(q(teams.A, 'update public.teams set score = 9999 where room_code = $1', [code]), /permission denied/i, 'update teams');
    await rejects(q(teams.A, 'insert into public.answers values ($1,1,gen_random_uuid(),0,true,1,now())', [code]), /permission denied/i, 'insert answers');
    await rejects(q(host, "update public.rooms set phase='GAME_OVER' where code=$1", [code]), /permission denied/i, 'update rooms');
    await rejects(q(host, "update public.rooms set wheel='[]' where code=$1", [code]), /permission denied/i, 'update wheel');
    await rejects(q(teams.A, 'delete from public.teams where room_code=$1', [code]), /permission denied/i, 'delete teams');
  });
  await test('ningún cliente puede leer preguntas, respuestas ni datos privados (qué pregunta hay en cada segmento)', async () => {
    await rejects(q(teams.A, 'select * from public.questions'), /permission denied/i, 'questions');
    await rejects(q(host, 'select * from public.questions'), /permission denied/i, 'questions host');
    await rejects(q(teams.A, 'select * from public.answers'), /permission denied/i, 'answers');
    await rejects(q(teams.A, 'select * from public.room_private'), /permission denied/i, 'room_private');
  });
  await test('un usuario ajeno a la sala no ve la sala ni los equipos', async () => {
    assert.strictEqual((await q(other, 'select * from public.rooms')).rowCount, 0);
    assert.strictEqual((await q(other, 'select * from public.teams')).rowCount, 0);
  });
  await test('anon (sin sesión) no puede ejecutar RPC', async () => {
    await db.withClient(async (c) => {
      await c.query('begin');
      await c.query('set local role anon');
      await rejects(c.query('select public.create_room(3,20)'), /permission denied/i, 'anon rpc');
      await c.query('rollback');
    });
  });

  console.log('\nFlujo de partida y estado autoritativo');
  await test('no se puede girar antes de iniciar; iniciar pasa a WAITING', async () => {
    await rejects(rpc(host, 'spin', code), /fase/, 'spin en LOBBY');
    await rpc(host, 'start_game', code);
    assert.strictEqual((await room(host, code)).phase, 'WAITING');
  });
  await test('no se pueden unir equipos nuevos con la partida iniciada', async () => {
    await rejects(rpc(other, 'join_room', code, 'Tarde'), /ya comenzó/, 'join tarde');
  });
  let before;
  await test('todos leen el MISMO giro; la ruleta cae en el segmento sorteado y la categoría coincide', async () => {
    before = await room(host, code);
    // Ronda 1 con una pregunta conocida (la 7, CITES): el resto de segmentos queda igual
    const p = await priv(code);
    const idx7 = p.wheel_qids.indexOf(7);
    await rpc(host, 'spin', code);
    const [h, a, b] = await Promise.all([room(host, code), room(teams.A, code), room(teams.B, code)]);
    assert.deepStrictEqual(h.spin, a.spin); assert.deepStrictEqual(a.spin, b.spin);
    const n = h.wheel.length;
    const idx = Math.floor(((360 - (h.spin.rotation % 360)) % 360) / (360 / n));
    assert.strictEqual(idx, h.spin.categoryIndex, 'el ángulo final apunta al segmento sorteado');
    await rejects(rpc(host, 'reveal_category', code), /girando/, 'revelar antes de tiempo');
    await sleep(6900);
    await rpc(host, 'reveal_category', code);
    const r = await room(teams.C, code);
    assert.strictEqual(r.phase, 'CATEGORY_SELECTED');
    assert.strictEqual(r.current_category, h.wheel[idx].c);
    // Para que el resto del flujo sea determinista, se vuelve a girar la pregunta 7 si no salió
    if (r.current_category === 'BONUS' || p.wheel_qids[idx] !== 7) {
      await db.admin.query("update public.rooms set phase='WAITING' where code=$1", [code]);
      await setWheel(code, [{ c: 'CITES', q: 7 }].concat(before.wheel.map((s, i) => ({ c: s.c, q: p.wheel_qids[i] })).filter((s, i) => i !== idx7)));
      await spinAndReveal(code);
      await db.admin.query("update public.rooms set spin = jsonb_set(spin, '{categoryIndex}', '0'), current_category='CITES' where code=$1", [code]);
      await db.admin.query("update public.room_private set pending_category='CITES', question_id=7 where room_code=$1", [code]);
    }
  });
  let question;
  await test('todos reciben la misma pregunta y NUNCA la respuesta correcta', async () => {
    await rpc(host, 'show_question', code);
    const [a, b] = await Promise.all([room(teams.A, code), room(teams.B, code)]);
    assert.deepStrictEqual(a.question, b.question);
    assert.ok(!/"correct(_answer|Answer)"/.test(JSON.stringify(a)), 'la sala filtra la respuesta correcta');
    question = a;
    assert.strictEqual(question.question.id, 7);
    assert.strictEqual(new Date(a.question_deadline) - new Date(a.question_started_at), 20000);
  });
  const correctOf = async (id) => (await db.admin.query('select correct_answer c from public.questions where id=$1', [id])).rows[0].c;
  await test('respuestas: A correcta rápido, B incorrecta, C sin responder', async () => {
    const c = await correctOf(7);
    await rpc(teams.A, 'submit_answer', code, c);
    await rpc(teams.B, 'submit_answer', code, (c + 1) % 4);
    assert.strictEqual((await room(host, code)).answered_count, 2);
  });
  await test('una respuesta no se puede repetir ni modificar', async () => {
    const c = await correctOf(7);
    await rejects(rpc(teams.A, 'submit_answer', code, c), /ya respondió/, 'duplicada');
    await rejects(rpc(teams.B, 'submit_answer', code, c), /ya respondió/, 'cambio');
  });
  await test('opciones inválidas y usuarios ajenos son rechazados', async () => {
    await rejects(rpc(teams.C, 'submit_answer', code, 9), /inválida/, 'opción 9');
    await rejects(rpc(other, 'submit_answer', code, 0), /no tiene un equipo/, 'ajeno');
  });
  await test('al cerrar, los puntos se guardan en segundo plano y se vuelve DIRECTO a la ruleta', async () => {
    const wheelBefore = (await room(host, code)).wheel.length;
    await rpc(host, 'close_answers', code);
    await rejects(rpc(teams.C, 'submit_answer', code, 0), /cerradas/, 'tarde');
    await rpc(host, 'finish_round', code);
    const r = await room(teams.A, code);
    assert.strictEqual(r.phase, 'WAITING'); assert.strictEqual(r.current_round, 2);
    assert.strictEqual(r.question, null); assert.strictEqual(r.results, null, 'no se publican resultados por ronda');
    assert.strictEqual(r.wheel.length, wheelBefore - 1, 'el segmento usado desaparece');
    const sc = await scores(code);
    assert.deepStrictEqual([sc['Eco Team'].score, sc['Los Verdes'].score, sc['Guardianes'].score], [100, 0, 0]);
    assert.deepStrictEqual([sc['Eco Team'].correct_count, sc['Los Verdes'].correct_count], [1, 0]);
    const p = await priv(code);
    assert.strictEqual(p.wheel_qids.length, r.wheel.length, 'ruleta pública y privada siguen alineadas');
    assert.ok(!p.wheel_qids.includes(7), 'la pregunta usada ya no está en la ruleta');
  });
  await test('los puntos no se pueden recalcular (no hay puntos dobles)', async () => {
    await rejects(rpc(host, 'finish_round', code), /fase/, 'segundo cálculo');
  });

  console.log('\nBONUS');
  await test('BONUS: no tiene pregunta, suma 5 a todos, desaparece de la ruleta y pasa a la siguiente ronda', async () => {
    const r0 = await room(host, code), p0 = await priv(code);
    const bi = r0.wheel.findIndex((s) => s.c === 'BONUS');
    const segs = r0.wheel.map((s, i) => ({ c: s.c, q: p0.wheel_qids[i] }));
    await setWheel(code, [segs[bi]].concat(segs.filter((_, i) => i !== bi)));   // BONUS en el segmento 0
    await db.admin.query("update public.rooms set wheel = jsonb_build_array(wheel->0) where code=$1", [code]);
    await db.admin.query('update public.room_private set wheel_qids = wheel_qids[1:1] where room_code=$1', [code]);
    await spinAndReveal(code);
    const r = await room(teams.B, code);
    assert.strictEqual(r.current_category, 'BONUS');
    await rejects(rpc(host, 'show_question', code), /BONUS/, 'pregunta en BONUS');
    await rejects(rpc(teams.A, 'apply_bonus', code), /Solo el anfitrión/, 'bonus por un equipo');
    await rpc(host, 'apply_bonus', code);
    const sc = await scores(code);
    assert.deepStrictEqual([sc['Eco Team'].score, sc['Los Verdes'].score, sc['Guardianes'].score], [105, 5, 5]);
    assert.deepStrictEqual([sc['Eco Team'].correct_count, sc['Los Verdes'].correct_count], [1, 0], 'el BONUS no cuenta como acierto');
    const r2 = await room(host, code);
    assert.strictEqual(r2.phase, 'WAITING'); assert.strictEqual(r2.current_round, 3);
    assert.strictEqual(r2.wheel.length, 0, 'el BONUS usado desaparece');
    await rejects(rpc(host, 'apply_bonus', code), /fase/, 'BONUS repetido');
  });
  await test('si la ruleta se queda sin segmentos, se vuelve a armar completa al girar', async () => {
    await rpc(host, 'spin', code);
    const r = await room(host, code);
    assert.strictEqual(r.wheel.length, 23);
    await sleep(6900); await rpc(host, 'reveal_category', code);
  });

  console.log('\nPuntuación por velocidad y final');
  await test('respuesta correcta a ~2.4 s cae en el tramo 3–4 s y vale 90', async () => {
    let r = await room(host, code);
    if (r.current_category === 'BONUS') { await rpc(host, 'apply_bonus', code); }
    else {   // ronda 3: se responde la pregunta que salió
      await rpc(host, 'show_question', code);
      r = await room(host, code);
      const before = (await scores(code))['Los Verdes'].score;
      await sleep(2300);
      await rpc(teams.B, 'submit_answer', code, await correctOf(r.question.id));
      await rpc(host, 'close_answers', code); await rpc(host, 'finish_round', code);
      assert.strictEqual((await scores(code))['Los Verdes'].score - before, 90);
    }
  });
  await test('tras la última ronda la partida termina (GAME_OVER) con puntos y aciertos guardados', async () => {
    let r = await room(host, code);
    assert.strictEqual(r.current_round, 4);
    await spinAndReveal(code);
    r = await room(host, code);
    if (r.current_category === 'BONUS') await rpc(host, 'apply_bonus', code);
    else { await rpc(host, 'show_question', code); await rpc(host, 'close_answers', code); await rpc(host, 'finish_round', code); }
    r = await room(teams.C, code);
    assert.strictEqual(r.phase, 'GAME_OVER');
    const t = (await q(teams.C, 'select name, score, correct_count from public.teams where room_code=$1 order by score desc', [code])).rows;
    assert.strictEqual(t[0].name, 'Eco Team'); assert.ok(t[0].score >= 105);
  });
  await test('el anfitrión puede cerrar la sala (se borran equipos)', async () => {
    await rpc(host, 'close_room', code);
    assert.strictEqual((await q(teams.A, 'select * from public.rooms where code=$1', [code])).rowCount, 0);
  });

  console.log('\nBanco de preguntas');
  await test('el banco tiene las 20 preguntas, idénticas a js/questions.js (texto, opciones y respuesta)', async () => {
    const rows = (await db.admin.query('select * from public.questions order by id')).rows;
    assert.strictEqual(rows.length, 20);
    for (const x of RJ.QUESTIONS) {
      const r = rows.find((y) => y.id === x.id);
      assert.ok(r, 'falta la pregunta ' + x.id);
      assert.strictEqual(r.category, x.category); assert.strictEqual(r.question, x.question);
      assert.deepStrictEqual(r.options, x.options); assert.strictEqual(r.correct_answer, x.correctAnswer, 'respuesta de la ' + x.id);
    }
  });
  await test('la ruleta del servidor tiene las mismas categorías y orden que el frontend', async () => {
    assert.deepStrictEqual((await db.admin.query('select public._wheel_categories() c')).rows[0].c, CATS);
  });

  console.log('\nTabla de puntos (todos los tramos)');
  await test('_calc_score respeta la tabla exacta', async () => {
    const cases = [[0, 100], [2000, 100], [2001, 90], [4000, 90], [6000, 80], [8000, 70], [10000, 60], [12000, 50], [14000, 40], [16000, 30], [18000, 25], [20000, 20], [20001, 0]];
    for (const [ms, pts] of cases) {
      assert.strictEqual((await db.admin.query('select public._calc_score($1,true) p', [ms])).rows[0].p, pts, ms + ' ms');
    }
    assert.strictEqual((await db.admin.query('select public._calc_score(500,false) p')).rows[0].p, 0);
    assert.strictEqual((await db.admin.query('select public._calc_score(null,true) p')).rows[0].p, 0);
  });

  console.log(`\n${passed} pruebas correctas${process.exitCode ? ' — HAY FALLOS' : ''}`);
  await db.stop();
  process.exit(process.exitCode || 0);
})().catch((e) => { console.error(e); process.exit(1); });
