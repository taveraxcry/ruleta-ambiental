/* Flujo completo con 1 anfitrión (computador) + 3 equipos (móviles) en navegadores independientes.
   La app real corre en Chrome; el backend es Postgres real con el MISMO schema.sql (ver tests/bridge.js). */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const { startBridge } = require('./bridge');

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const SHIM = fs.readFileSync(path.join(__dirname, 'supabase-shim.js'), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const POINTS = [[2, 100], [4, 90], [6, 80], [8, 70], [10, 60], [12, 50], [14, 40], [16, 30], [18, 25], [20, 20]];
const expectedPoints = (sec, ok) => (!ok || sec == null ? 0 : (POINTS.find((b) => sec <= b[0]) || [0, 0])[1]);

let failures = 0, checks = 0;
function check(cond, msg) { checks++; if (cond) console.log('  ✓', msg); else { failures++; console.log('  ✗', msg); } }
const allEqual = (arr) => arr.every((x) => JSON.stringify(x) === JSON.stringify(arr[0]));

(async () => {
  const bridge = await startBridge({ dbPort: 54331, httpPort: 8099, rounds: 2 });
  globalThis.__bridge = bridge;
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const errors = [];
  const contexts = [];

  async function newPage(kind) {
    const ctx = await browser.newContext(kind === 'host'
      ? { viewport: { width: 1280, height: 800 } }
      : { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    contexts.push(ctx);
    await ctx.route('https://cdn.jsdelivr.net/**', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: SHIM }));
    await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    const page = await ctx.newPage();
    page.setDefaultTimeout(45000);
    page.on('pageerror', (e) => errors.push(kind + ': ' + e.message));
    if (process.env.DEBUG_E2E) page.on('console', (m) => console.log('   [' + kind + ' console]', m.text()));
    await page.goto(bridge.url);
    return page;
  }
  const visible = (page, sel, t) => page.waitForSelector(sel + ':not(.hidden)', { timeout: t || 45000 });
  const norm = (arr) => arr.map((x) => x.replace(/\s+/g, ''));
  const rowsOf = (page, sel) => page.locator(sel).allInnerTexts().then(norm);
  const text = (page, sel) => page.locator(sel).first().innerText().then((s) => s.trim());
  const allPages = () => [host, ...teams];
  const everyone = (fn) => Promise.all(allPages().map(fn));
  const correctIndex = async (code) => (await bridge.db.admin.query(
    'select q.correct_answer c from public.questions q join public.room_private p on p.question_id = q.id where p.room_code = $1', [code])).rows[0].c;
  const roomRow = async (code) => (await bridge.db.admin.query('select * from public.rooms where code=$1', [code])).rows[0];

  const host = await newPage('host');
  const teams = [await newPage('team'), await newPage('team'), await newPage('team')];
  const [A, B, C] = teams;
  const names = ['Eco Team', 'Los Verdes', 'Guardianes'];

  console.log('\n1. Sala y equipos');
  check(!(await host.locator('#btn-create').isDisabled()), 'el anfitrión (computador) puede crear sala');
  check(await teams[0].locator('#btn-create').isDisabled(), 'en un teléfono el botón de crear sala está deshabilitado');
  check(!(await host.locator('#mode-badge').isVisible()), 'la app corre en modo Supabase (sin aviso de modo local)');
  await host.click('#btn-create');
  await visible(host, '#screen-host-lobby');
  const code = await text(host, '#host-code');
  check(/^ECO-[2-9A-HJKMNP-Z]{3}$/.test(code), 'código de sala generado: ' + code);

  for (let i = 0; i < 3; i++) {
    const p = teams[i];
    await p.click('#btn-join');
    await p.fill('#join-code', code.toLowerCase());
    await p.fill('#join-name', names[i]);
    await p.click('#join-submit');
    await visible(p, '#screen-team-lobby');
  }
  await host.waitForFunction(() => document.querySelectorAll('#host-teams .team-name').length === 3);
  const hostNames = await host.locator('#host-teams .team-name').allInnerTexts();
  check(names.every((n) => hostNames.join('|').includes(n)), 'el anfitrión ve los 3 equipos en tiempo real');
  for (const p of teams) await p.waitForFunction(() => document.querySelectorAll('#tl-teams .team-name').length === 3);
  check(allEqual(await Promise.all(teams.map((p) => p.locator('#tl-teams .team-name').allInnerTexts()))), 'los equipos ven la misma lista de equipos en la sala de espera');
  check((await text(A, '#tl-team')) === 'Eco Team', 'cada equipo ve su propio nombre');
  await host.waitForFunction(() => document.querySelectorAll('#host-teams .dot.on').length === 3);
  check(true, 'presencia: los 3 equipos aparecen conectados');

  // Un dispositivo nuevo no puede entrar duplicando nombre
  const dup = await newPage('team');
  await dup.click('#btn-join'); await dup.fill('#join-code', code); await dup.fill('#join-name', 'ECO TEAM'); await dup.click('#join-submit');
  await dup.waitForSelector('#join-error:not(.hidden)');
  check(/Ya existe/.test(await text(dup, '#join-error')), 'nombre duplicado rechazado');

  console.log('\n2. Inicio de partida');
  check(await A.locator('#btn-start').count() === 1 && !(await A.locator('#btn-start').isVisible()), 'el equipo no ve el botón de iniciar');
  await host.click('#btn-start');
  await everyone((p) => visible(p, '#screen-game'));
  check(true, 'todos pasan a la pantalla de juego');
  check((await Promise.all(teams.map((p) => p.locator('#host-actions').isHidden()))).every(Boolean), 'los equipos no ven controles de anfitrión');
  await dup.click('#join-submit'); await dup.waitForSelector('#join-error:not(.hidden)');
  await dup.fill('#join-name', 'Tarde'); await dup.click('#join-submit');
  await dup.waitForFunction(() => /ya comenzó/.test(document.querySelector('#join-error').textContent));
  check(true, 'no se admiten equipos nuevos con la partida iniciada');

  async function playRound(n, plan) {
    console.log('\n' + (n === 1 ? '3' : '5') + '. Ronda ' + n);
    await host.click('[data-action="spin"]');
    await everyone((p) => visible(p, '#category-reveal'));
    const cats = await everyone((p) => text(p, '#category-reveal .cat-name'));
    check(allEqual(cats), 'todos ven la misma categoría: ' + cats[0]);
    const rot = await everyone((p) => p.locator('#wheel-rotor').evaluate((e) => e.style.transform));
    check(allEqual(rot), 'todos ven el mismo giro de ruleta (' + rot[0] + ')');
    check((await Promise.all(teams.map((p) => p.locator('[data-action]').count()))).every((c) => c === 0), 'los equipos no tienen botones de acción durante la ruleta');

    await host.click('[data-action="show"]');
    await everyone((p) => visible(p, '#stage-question .q-text'));
    const qs = await everyone((p) => text(p, '.q-text'));
    const opts = await everyone((p) => p.locator('.option .opt-text').allInnerTexts());
    check(allEqual(qs) && allEqual(opts), 'todos reciben exactamente la misma pregunta y opciones');
    const cats2 = await everyone((p) => text(p, '.cat-badge'));
    const row = await roomRow(code);
    const qCat = (await bridge.db.admin.query('select category from public.questions where id=$1', [row.question.id])).rows[0].category;
    check(allEqual(cats2) && qCat === row.current_category && !['ROTTERDAM', 'MONTREAL'].includes(qCat),
      'la pregunta pertenece a la categoría del giro (' + qCat + ') y la categoría está habilitada');
    const startedAt = Date.parse(row.question_started_at);
    check(Date.parse(row.question_deadline) - startedAt === 20000, 'el servidor fijó 20 segundos de ventana');
    const timers = (await everyone((p) => text(p, '#timer-num'))).map(Number);
    check(Math.max(...timers) - Math.min(...timers) <= 1 && timers[0] >= 18, 'todos tienen el mismo cronómetro: ' + timers.join(', '));
    const html = await teams[0].content();
    check(!/correct_answer|correctAnswer/.test(html), 'la respuesta correcta no está en el HTML del equipo');
    check(await teams[0].evaluate(() => !window.Ruleta.QUESTIONS), 'el teléfono del equipo nunca descarga el banco de preguntas con respuestas');

    const ok = await correctIndex(code);
    const wrong = (ok + 1) % opts[0].length;
    // Eco Team responde con mouse; los demás equipos con pantalla táctil
    const pick = (page, i) => {
      const opt = page.locator('button.option[data-index="' + i + '"]');
      return page === A ? opt.click() : opt.tap();
    };
    const waitUntil = async (ms) => { const d = startedAt + ms - Date.now(); if (d > 0) await sleep(d); };

    for (const step of plan.answers) {   // [{page, at(ms desde inicio), option:'ok'|'wrong'}]
      await waitUntil(step.at);
      await pick(step.page, step.option === 'ok' ? ok : wrong);
    }
    await A.locator('.answer-status.ok, .answer-status').first().waitFor();
    if (plan.checkLocks) {
      check(await host.locator('#stage-question button.option').count() === 0 && await host.locator('#stage-question .option.readonly').count() > 0,
        'en el computador del anfitrión las opciones son de solo lectura (los equipos responden)');
      check(/RESPUESTA REGISTRADA/.test(await text(A, '.answer-status')), 'el equipo ve "✓ RESPUESTA REGISTRADA"');
      check(await A.locator('.option:not([disabled])').count() === 0, 'tras responder, las opciones quedan bloqueadas');
      await A.locator('.option').nth(wrong === 0 ? 1 : 0).click({ force: true, timeout: 1000 }).catch(() => {});
      const ans = (await bridge.db.admin.query('select count(*)::int n from public.answers where room_code=$1 and round=$2', [code, n])).rows[0].n;
      check(ans === plan.answers.length, 'solo hay una respuesta por equipo en la base (' + ans + ')');
      check(await B.locator('#answer-count').count() === 0 && !/pts|puntos|respondi/i.test(await text(B, '.answer-status')), 'un equipo no ve quién respondió ni puntos durante la pregunta');
      await host.waitForFunction((n) => /Respuestas recibidas: \d \/ 3/.test(document.querySelector('#answer-count').textContent), n);
      check(true, 'el anfitrión ve el conteo de respuestas: ' + (await text(host, '#answer-count')));
    }
    if (plan.reloadB) {
      const before = (await bridge.db.admin.query('select id from public.teams where name=$1', ['Los Verdes'])).rows[0].id;
      await B.reload();
      await visible(B, '#stage-question');
      await B.waitForSelector('.answer-status.ok');
      const after = (await bridge.db.admin.query('select id from public.teams where room_code=$1 and name=$2', [code, 'Los Verdes'])).rows;
      check(after.length === 1 && after[0].id === before, 'recarga accidental: el equipo recupera su sesión sin duplicarse');
      check(await B.locator('.option:not([disabled])').count() === 0, 'tras recargar, su respuesta sigue bloqueada');
    }
    if (plan.manualClose) {
      await host.click('[data-action="close"]');
    }
    await everyone((p) => visible(p, '#stage-results', 40000));
    const rows = await everyone((p) => rowsOf(p, '#stage-results .rank-row'));
    check(allEqual(rows), 'todos reciben los mismos resultados');
    if (!allEqual(rows)) console.log('     rows:', JSON.stringify(rows));
    const correctBox = await everyone((p) => text(p, '.correct-text'));
    check(allEqual(correctBox), 'todos ven la misma respuesta correcta: ' + correctBox[0]);

    const res = (await roomRow(code)).results;
    for (const r of res.rows) {
      const exp = expectedPoints(r.responseTime, r.correct);
      check(r.points === exp, `${r.name}: ${r.correct ? 'correcta' : r.answerIndex === null ? 'sin respuesta' : 'incorrecta'}` +
        `${r.responseTime != null ? ' a ' + r.responseTime + ' s' : ''} → ${r.points} pts (tabla: ${exp})`);
    }
    return res;
  }

  const r1 = await playRound(1, {
    checkLocks: true, reloadB: true, manualClose: false,
    answers: [{ page: A, at: 100, option: 'ok' }, { page: B, at: 600, option: 'wrong' }]   // C no responde → se cierra solo a los 20 s
  });
  const by1 = Object.fromEntries(r1.rows.map((r) => [r.name, r]));
  check(by1['Eco Team'].points === 100, 'ronda 1: respuesta correcta rápida (≤2 s) = 100');
  check(by1['Los Verdes'].points === 0, 'ronda 1: incorrecta y rápida = 0');
  check(by1['Guardianes'].points === 0 && by1['Guardianes'].answerIndex === null, 'ronda 1: sin respuesta = 0');
  check(/\+100/.test(await text(A, '.my-result.good')) && await B.locator('.my-result.bad').count() === 1 && await C.locator('.my-result.none').count() === 1,
    'cada equipo ve su propio resultado (correcto / incorrecto / sin respuesta)');

  await host.click('[data-action="board"]');
  await everyone((p) => visible(p, '#stage-leaderboard'));
  // Cada fila expone sus datos (posición|equipo|puntos de ronda|total): el diseño cambia entre móvil y computador
  const boardOf = (p) => p.locator('#stage-leaderboard .board tbody tr').evaluateAll((trs) => trs.map((tr) => tr.dataset.row));
  const boards = await everyone(boardOf);
  check(allEqual(boards) && boards[0][0] === '1|Eco Team|+100|100', 'todos ven el mismo marcador (Eco Team lidera con 100)');

  await host.reload();
  await visible(host, '#stage-leaderboard');
  check((await text(host, '#g-right')).includes(code) && await host.locator('[data-action="next"]').count() === 1, 'el anfitrión recarga la página y recupera la partida en curso');

  await host.click('[data-action="next"]');
  await everyone((p) => visible(p, '#stage-wheel'));
  const rounds = await everyone((p) => text(p, '#g-round'));
  check(rounds.every((r) => r === '2 / 2'), 'todos pasan a la ronda 2 / 2');

  const r2 = await playRound(2, {
    checkLocks: false, reloadB: false, manualClose: true,
    answers: [{ page: A, at: 400, option: 'wrong' }, { page: B, at: 3000, option: 'ok' }, { page: C, at: 5000, option: 'ok' }]
  });
  const by2 = Object.fromEntries(r2.rows.map((r) => [r.name, r]));
  check(by2['Los Verdes'].points === 90, 'ronda 2: correcta a ~3 s = 90');
  check(by2['Guardianes'].points === 80, 'ronda 2: correcta a ~5 s = 80');
  check(by2['Eco Team'].points === 0, 'ronda 2: incorrecta rápida = 0');

  await host.click('[data-action="board"]');
  await everyone((p) => visible(p, '#stage-leaderboard'));
  const boards2 = await everyone(boardOf);
  check(allEqual(boards2), 'marcador acumulado idéntico en todos los dispositivos: ' + boards2[0].join(' · '));
  check(/FINALIZAR/.test(await text(host, '[data-action="next"]')), 'tras la última ronda el anfitrión ve "FINALIZAR PARTIDA"');
  await host.click('[data-action="next"]');

  console.log('\n6. Final');
  await everyone((p) => visible(p, '#stage-gameover'));
  const winners = await everyone((p) => text(p, '.winner-name'));
  check(allEqual(winners) && /ECO TEAM/i.test(winners[0]), 'todos ven el mismo ganador: ' + winners[0].replace(/\n/g, ' '));
  const scoreTxt = await everyone((p) => text(p, '.winner-score'));
  check(allEqual(scoreTxt) && /100/.test(scoreTxt[0]), 'puntuación final del ganador: ' + scoreTxt[0]);
  const finals = await everyone((p) => rowsOf(p, '#stage-gameover .rank-row'));
  check(allEqual(finals) && finals[0].length === 3, 'clasificación completa idéntica para todos (3 equipos)');
  if (!allEqual(finals)) console.log('     finals:', JSON.stringify(finals));
  const dbScores = (await bridge.db.admin.query('select name, score from public.teams where room_code=$1 order by score desc', [code])).rows;
  check(JSON.stringify(dbScores.map((r) => r.score)) === JSON.stringify([100, 90, 80]), 'puntos guardados en la base: ' + dbScores.map((r) => r.name + ' ' + r.score).join(', '));

  check(errors.length === 0, 'sin errores de JavaScript en ningún dispositivo' + (errors.length ? ': ' + errors.join(' | ') : ''));

  console.log(`\n${checks - failures}/${checks} comprobaciones correctas${failures ? ' — HAY ' + failures + ' FALLOS' : ''}`);
  await browser.close();
  await bridge.stop();
  process.exit(failures ? 1 : 0);
})().catch(async (e) => { console.error('ERROR EN LA PRUEBA:', e.message); try { const r = await globalThis.__bridge.db.admin.query('select code, phase, answered_count, question_deadline, now() n from public.rooms'); console.log('estado en la base:', JSON.stringify(r.rows)); } catch (x) {} process.exit(2); });
