/* Pruebas de la lógica autoritativa y de la seguridad (RLS + RPC) sobre Postgres real. */
const assert = require('assert');
const crypto = require('crypto');
const { startDb } = require('./pgtest');

// Mismo orden y estado que R.CATEGORIES (js/config.js)
global.window = {};
eval(require('fs').readFileSync(require('path').join(__dirname, '../js/config.js'), 'utf8'));
const CATS = window.Ruleta.CATEGORIES.map((c) => c.id);
const DISABLED = window.Ruleta.CATEGORIES.filter((c) => !c.enabled).map((c) => c.id);

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
  let code;

  console.log('\nSala y equipos');
  await test('el anfitrión crea una sala con código ECO-XXX', async () => {
    code = await rpc(host, 'create_room', 3, 20);
    assert.match(code, /^ECO-[2-9A-HJKMNP-Z]{3}$/);
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
    for (const fn of ['start_game', 'spin', 'reveal_category', 'show_question', 'close_answers', 'show_results', 'show_leaderboard', 'next_round', 'close_room']) {
      await rejects(rpc(teams.A, fn, code), /Solo el anfitrión/, fn);
    }
  });
  await test('un cliente no puede escribir directamente en las tablas', async () => {
    await rejects(q(teams.A, "update public.teams set score = 9999 where room_code = $1", [code]), /permission denied/i, 'update teams');
    await rejects(q(teams.A, "insert into public.answers values ($1,1,gen_random_uuid(),0,true,1,now())", [code]), /permission denied/i, 'insert answers');
    await rejects(q(host, "update public.rooms set phase='GAME_OVER' where code=$1", [code]), /permission denied/i, 'update rooms');
    await rejects(q(teams.A, "delete from public.teams where room_code=$1", [code]), /permission denied/i, 'delete teams');
  });
  await test('ningún cliente puede leer preguntas con respuesta, respuestas ni datos privados', async () => {
    await rejects(q(teams.A, 'select * from public.questions'), /permission denied/i, 'questions');
    await rejects(q(host, 'select * from public.questions'), /permission denied/i, 'questions host');
    await rejects(q(teams.A, 'select * from public.answers'), /permission denied/i, 'answers');
    await rejects(q(teams.A, 'select * from public.room_private'), /permission denied/i, 'room_private');
  });
  await test('un usuario ajeno a la sala no ve la sala ni los equipos', async () => {
    assert.strictEqual((await q(other, 'select * from public.rooms')).rowCount, 0);
    assert.strictEqual((await q(other, 'select * from public.teams')).rowCount, 0);
  });
  await test('los equipos de otra sala no se ven entre sí', async () => {
    const code2 = await rpc(other, 'create_room', 3, 20);
    assert.strictEqual((await q(other, 'select * from public.teams')).rowCount, 0);
    assert.strictEqual((await q(teams.A, 'select * from public.rooms')).rowCount, 1);
    assert.notStrictEqual(code2, code);
  });
  await test('anon (sin sesión) no puede ejecutar RPC', async () => {
    await db.withClient(async (c) => {
      await c.query('begin');
      await c.query('set local role anon');
      await rejects(c.query("select public.create_room(3,20)"), /permission denied/i, 'anon rpc');
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
  await test('todos leen la MISMA ruleta; el giro cae en el segmento de la categoría', async () => {
    await rpc(host, 'spin', code);
    const cats = CATS;
    const [h, a, b] = await Promise.all([room(host, code), room(teams.A, code), room(teams.B, code)]);
    assert.deepStrictEqual(h.spin, a.spin); assert.deepStrictEqual(a.spin, b.spin);
    assert.strictEqual(h.phase, 'SPINNING');
    const idx = Math.floor(((360 - (h.spin.rotation % 360)) % 360) / (360 / CATS.length));
    assert.strictEqual(idx, h.spin.categoryIndex);
    await rejects(rpc(host, 'reveal_category', code), /girando/, 'revelar antes de tiempo');
    await sleep(5000);
    await rpc(host, 'reveal_category', code);
    const r = await room(teams.C, code);
    assert.strictEqual(r.phase, 'CATEGORY_SELECTED');
    assert.strictEqual(r.current_category, cats[h.spin.categoryIndex]);
  });
  let question;
  await test('todos reciben la misma pregunta y NUNCA la respuesta correcta', async () => {
    await rpc(host, 'show_question', code);
    const [a, b] = await Promise.all([room(teams.A, code), room(teams.B, code)]);
    assert.deepStrictEqual(a.question, b.question);
    assert.ok(!/"correct(_answer|Answer)"/.test(JSON.stringify(a)), 'la sala filtra la respuesta correcta');
    question = a;
    assert.strictEqual(new Date(a.question_deadline) - new Date(a.question_started_at), 20000);
  });
  const correct = async () => (await db.admin.query(
    'select correct_answer c from public.questions where id=$1', [question.question.id])).rows[0].c;
  await test('respuestas: A correcta rápido, B incorrecta, C sin responder', async () => {
    const c = await correct();
    const wrong = (c + 1) % question.question.options.length;
    await rpc(teams.A, 'submit_answer', code, c);
    await rpc(teams.B, 'submit_answer', code, wrong);
    assert.strictEqual((await room(host, code)).answered_count, 2);
  });
  await test('una respuesta no se puede repetir ni modificar', async () => {
    const c = await correct();
    await rejects(rpc(teams.A, 'submit_answer', code, c), /ya respondió/, 'duplicada');
    await rejects(rpc(teams.B, 'submit_answer', code, c), /ya respondió/, 'cambio');
  });
  await test('opciones inválidas y usuarios ajenos son rechazados', async () => {
    await rejects(rpc(teams.C, 'submit_answer', code, 9), /inválida/, 'opción 9');
    await rejects(rpc(other, 'submit_answer', code, 0), /no tiene un equipo/, 'ajeno');
  });
  await test('cerrar respuestas bloquea más envíos; los puntos se calculan en el servidor', async () => {
    await rpc(host, 'close_answers', code);
    await rejects(rpc(teams.C, 'submit_answer', code, await correct()), /cerradas/, 'tarde');
    await rpc(host, 'show_results', code);
    const r = await room(teams.A, code);
    assert.strictEqual(r.phase, 'RESULTS');
    const byName = Object.fromEntries(r.results.rows.map((x) => [x.name, x]));
    assert.strictEqual(byName['Eco Team'].points, 100);
    assert.strictEqual(byName['Eco Team'].correct, true);
    assert.strictEqual(byName['Los Verdes'].points, 0);
    assert.strictEqual(byName['Guardianes'].points, 0);
    assert.strictEqual(byName['Guardianes'].answerIndex, null);
    assert.strictEqual(r.results.rows[0].name, 'Eco Team');
    assert.strictEqual(r.results.correctAnswer, await correct());
    const t = (await q(teams.B, 'select name, score from public.teams where room_code=$1 order by name', [code])).rows;
    assert.deepStrictEqual(t.map((x) => x.score).sort((a, b) => b - a), [100, 0, 0]);
    assert.strictEqual(t.find((x) => x.name === 'Eco Team').score, 100);
  });
  await test('los resultados no se pueden recalcular (no hay puntos dobles)', async () => {
    await rejects(rpc(host, 'show_results', code), /fase/, 'segundo cálculo');
  });
  await test('marcador y siguiente ronda', async () => {
    await rpc(host, 'show_leaderboard', code);
    await rpc(host, 'next_round', code);
    const r = await room(teams.A, code);
    assert.strictEqual(r.phase, 'WAITING'); assert.strictEqual(r.current_round, 2);
    assert.strictEqual(r.question, null); assert.strictEqual(r.results, null);
    const t = (await q(teams.A, "select score from public.teams where name='Eco Team'")).rows[0];
    assert.strictEqual(t.score, 100);
  });

  console.log('\nPuntuación por velocidad (servidor)');
  async function playRound({ delayMs, pick }) {
    await rpc(host, 'spin', code); await sleep(5000); await rpc(host, 'reveal_category', code);
    await rpc(host, 'show_question', code);
    const r0 = await room(host, code);
    const c = (await db.admin.query('select correct_answer c from public.questions where id=$1', [r0.question.id])).rows[0].c;
    await sleep(delayMs);
    await rpc(teams.A, 'submit_answer', code, pick === 'ok' ? c : (c + 1) % r0.question.options.length);
    await rpc(host, 'close_answers', code); await rpc(host, 'show_results', code);
    return (await room(host, code)).results.rows.find((x) => x.name === 'Eco Team');
  }
  await test('respuesta correcta a ~2.4 s cae en el tramo 3–4 s y vale 90', async () => {
    const row = await playRound({ delayMs: 2300, pick: 'ok' });
    assert.ok(row.responseTime >= 2.3 && row.responseTime < 3.5, 'tiempo medido ' + row.responseTime);
    assert.strictEqual(row.points, 90);
  });

  console.log('\nFinal de la partida');
  await test('tras la última ronda aparece GAME_OVER con puntuaciones finales', async () => {
    await rpc(host, 'show_leaderboard', code); await rpc(host, 'next_round', code);  // ronda 3
    const row = await playRound({ delayMs: 100, pick: 'bad' });
    assert.strictEqual(row.points, 0);               // incorrecta y rápida = 0
    await rpc(host, 'show_leaderboard', code);
    await rpc(host, 'next_round', code);              // era la ronda 3 de 3 → fin
    const r = await room(teams.B, code);
    assert.strictEqual(r.phase, 'GAME_OVER');
    const t = (await q(teams.B, 'select name, score from public.teams where room_code=$1 order by score desc', [code])).rows;
    assert.strictEqual(t[0].name, 'Eco Team'); assert.strictEqual(t[0].score, 190);
  });
  await test('el anfitrión puede cerrar la sala (se borran equipos)', async () => {
    await rpc(host, 'close_room', code);
    assert.strictEqual((await q(teams.A, 'select * from public.rooms where code=$1', [code])).rowCount, 0);
  });

  console.log('\nSelección de preguntas (20 preguntas definitivas)');
  await test('la ruleta del servidor tiene las mismas categorías y orden que el frontend', async () => {
    const r = (await db.admin.query('select public._wheel_categories() c')).rows[0].c;
    assert.deepStrictEqual(r, CATS);
  });
  await test('el banco tiene 20 preguntas y solo categorías de la ruleta', async () => {
    const r = (await db.admin.query('select count(*)::int n, bool_and(category = any(public._wheel_categories())) ok from public.questions')).rows[0];
    assert.strictEqual(r.n, 20); assert.strictEqual(r.ok, true);
  });
  await test('20 giros seguidos: sin repetir, sin categorías deshabilitadas, pregunta de la categoría elegida', async () => {
    const used = [];
    for (let i = 0; i < 20; i++) {
      const p = (await db.admin.query('select * from public._pick_question($1)', [used])).rows[0];
      assert.strictEqual(p.o_reset, false, 'no debe reiniciar antes de agotar el banco');
      assert.ok(!DISABLED.includes(p.o_category), 'salió una categoría deshabilitada: ' + p.o_category);
      const qc = (await db.admin.query('select category from public.questions where id=$1', [p.o_question_id])).rows[0].category;
      assert.strictEqual(qc, p.o_category);
      assert.ok(!used.includes(p.o_question_id), 'pregunta repetida');
      used.push(p.o_question_id);
    }
    const p = (await db.admin.query('select * from public._pick_question($1)', [used])).rows[0];
    assert.strictEqual(p.o_reset, true, 'al agotar las 20 se reinicia el banco');
  });

  console.log('\nTabla de puntos (todos los tramos)');
  await test('_calc_score respeta la tabla exacta', async () => {
    const cases = [[0,100],[2000,100],[2001,90],[4000,90],[6000,80],[8000,70],[10000,60],[12000,50],[14000,40],[16000,30],[18000,25],[20000,20],[20001,0]];
    for (const [ms, pts] of cases) {
      const r = (await db.admin.query('select public._calc_score($1,true) p', [ms])).rows[0].p;
      assert.strictEqual(r, pts, ms + ' ms');
    }
    assert.strictEqual((await db.admin.query('select public._calc_score(500,false) p')).rows[0].p, 0);
    assert.strictEqual((await db.admin.query('select public._calc_score(null,true) p')).rows[0].p, 0);
  });

  console.log(`\n${passed} pruebas correctas${process.exitCode ? ' — HAY FALLOS' : ''}`);
  await db.stop();
  process.exit(process.exitCode || 0);
})().catch((e) => { console.error(e); process.exit(1); });
