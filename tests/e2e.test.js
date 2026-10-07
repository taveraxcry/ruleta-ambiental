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
      : kind === 'small'   // teléfono pequeño (iPhone SE)
        ? { viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }
        : { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    contexts.push(ctx);
    // supabase-js se sustituye por el simulador; la librería del QR se descarga de verdad
    await ctx.route('https://cdn.jsdelivr.net/**', (r) => (/qrcode-generator/.test(r.request().url())
      ? r.continue() : r.fulfill({ status: 200, contentType: 'application/javascript', body: SHIM })));
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
  const teams = [await newPage('team'), await newPage('team'), await newPage('small')];
  const [A, B, C] = teams;
  const names = ['Eco Team', 'Los Verdes', 'Guardianes'];

  console.log('\n1. Sala y equipos');
  check(!(await host.locator('#btn-create').isDisabled()), 'el anfitrión (computador) puede crear sala');
  check(!(await teams[0].locator('#btn-create').isVisible()) && await teams[0].locator('#btn-join').isVisible(), 'en un teléfono solo aparece "Unirse a una sala" (crear sala es solo para computador)');
  check(!(await host.locator('#mode-badge').isVisible()), 'la app corre en modo Supabase (sin aviso de modo local)');
  await host.click('#btn-create');
  await visible(host, '#screen-host-lobby');
  const code = await text(host, '#host-code');
  check(/^ECO-[2-9A-HJKMNP-Z]{3}$/.test(code), 'código de sala generado: ' + code);

  await host.waitForSelector('#host-qr:not(.hidden) .qr-img svg', { timeout: 15000 });
  check(true, 'la sala del anfitrión muestra un código QR para entrar');

  // Eco Team entra por el enlace del QR: el código ya viene escrito, solo pone el nombre
  await A.goto(bridge.url + '/?sala=' + code);
  await visible(A, '#screen-join');
  check(await A.inputValue('#join-code') === code && await A.evaluate(() => document.activeElement.id) === 'join-name',
    'el enlace del QR abre "Unirse" con el código escrito y el cursor en el nombre');
  await A.fill('#join-name', names[0]);
  await A.locator('#join-submit').tap();
  await visible(A, '#screen-team-lobby');
  check(await A.evaluate(() => location.search) === '', 'tras entrar, el enlace se limpia (recargar no vuelve al formulario)');
  for (let i = 1; i < 3; i++) {
    const p = teams[i];
    await p.locator('#btn-join').tap();
    await p.fill('#join-code', code.toLowerCase());
    await p.fill('#join-name', names[i]);
    await p.locator('#join-submit').tap();
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

  const dbScores = async () => Object.fromEntries((await bridge.db.admin.query('select name, score, correct_count from public.teams where room_code=$1', [code])).rows.map((r) => [r.name, r]));
  const wheelCounts = () => everyone((p) => p.evaluate(() => window.Ruleta.debugState().wheel.length));

  async function spinAll(label) {
    await host.click('[data-action="spin"]');
    await everyone((p) => visible(p, '#category-reveal', 20000));
    const cats = await everyone((p) => text(p, '#category-reveal .cat-name'));
    check(allEqual(cats), 'todos ven el mismo resultado de la ruleta: ' + cats[0].replace(/\n/g, ' '));
    const rot = await everyone((p) => p.locator('#wheel-rotor').evaluate((e) => e.style.transform));
    check(allEqual(rot), 'todos ven el mismo giro de ruleta (' + rot[0] + ')');
    check((await Promise.all(teams.map((p) => p.locator('[data-action]').count()))).every((c) => c === 0), 'los equipos no tienen botones de acción durante la ruleta');
    return cats[0];
  }

  async function playQuestionRound(n, plan) {
    console.log('\n' + (n + 2) + '. Ronda ' + n + ' (pregunta)');
    const segBefore = (await roomRow(code)).wheel.map((x) => x.c);
    await spinAll();
    const landedIdx = (await roomRow(code)).spin.categoryIndex;
    await host.click('[data-action="show"]');
    await everyone((p) => visible(p, '#stage-question .q-text'));
    const qs = await everyone((p) => text(p, '.q-text'));
    const opts = await everyone((p) => p.locator('.option .opt-text').allInnerTexts());
    check(allEqual(qs) && allEqual(opts), 'todos reciben exactamente la misma pregunta y opciones');
    const cats2 = await everyone((p) => text(p, '.cat-badge'));
    const row = await roomRow(code);
    const qCat = (await bridge.db.admin.query('select category from public.questions where id=$1', [row.question.id])).rows[0].category;
    check(allEqual(cats2) && qCat === row.current_category, 'la pregunta pertenece a la categoría del segmento (' + qCat + ')');
    const startedAt = Date.parse(row.question_started_at);
    check(Date.parse(row.question_deadline) - startedAt === 15000, 'el servidor fijó 15 segundos de ventana');
    const timers = (await everyone((p) => text(p, '#timer-num'))).map(Number);
    check(Math.max(...timers) - Math.min(...timers) <= 1 && timers[0] >= 13 && timers[0] <= 15, 'todos tienen el mismo cronómetro: ' + timers.join(', '));
    check(!/correct_answer|correctAnswer/.test(await teams[0].content()), 'la respuesta correcta no está en el HTML del equipo');
    check(await teams[0].evaluate(() => !window.Ruleta.QUESTIONS), 'el teléfono del equipo nunca descarga el banco de preguntas con respuestas');

    const ok = await correctIndex(code);
    const wrong = (ok + 1) % opts[0].length;
    const pick = (page, i) => {   // Eco Team responde con mouse; los demás con pantalla táctil
      const opt = page.locator('button.option[data-index="' + i + '"]');
      return page === A ? opt.click() : opt.tap();
    };
    const waitUntil = async (ms) => { const d = startedAt + ms - Date.now(); if (d > 0) await sleep(d); };
    for (const step of plan.answers) {
      await waitUntil(step.at);
      await pick(step.page, step.option === 'ok' ? ok : wrong);
    }
    // Espera a que las respuestas lleguen al servidor
    for (let i = 0; i < 30; i++) {
      const c = (await bridge.db.admin.query('select count(*)::int n from public.answers where room_code=$1 and round=$2', [code, n])).rows[0].n;
      if (c >= plan.answers.length) break;
      await sleep(150);
    }
    if (plan.checkLocks) {
      check(await host.locator('#stage-question button.option').count() === 0 && await host.locator('#stage-question .option.readonly').count() > 0,
        'en el computador del anfitrión las opciones son de solo lectura (los equipos responden)');
      const aStatus = await A.locator('#stage-question').innerText();
      check(/RESPUESTA REGISTRADA/.test(aStatus), 'el equipo ve "✓ RESPUESTA REGISTRADA"' + (/RESPUESTA REGISTRADA/.test(aStatus) ? '' : ' — ve: ' + aStatus.replace(/s+/g, ' ').slice(-160)));
      check(await A.locator('.option:not([disabled])').count() === 0, 'tras responder, las opciones quedan bloqueadas');
      await A.locator('.option').nth(wrong === 0 ? 1 : 0).click({ force: true, timeout: 1000 }).catch(() => {});
      const ans = (await bridge.db.admin.query('select count(*)::int n from public.answers where room_code=$1 and round=$2', [code, n])).rows[0].n;
      check(ans === plan.answers.length, 'solo hay una respuesta por equipo en la base (' + ans + ')');
      check(await B.locator('#answer-count').count() === 0 && !/pts|puntos|respondi/i.test(await text(B, '.answer-status')), 'un equipo no ve quién respondió ni puntos durante la pregunta');
      await host.waitForFunction(() => /Respuestas recibidas: \d \/ 3/.test(document.querySelector('#answer-count').textContent));
      check(true, 'el anfitrión ve el conteo de respuestas: ' + (await text(host, '#answer-count')));
      const scrollable = await C.evaluate(() => document.documentElement.scrollHeight > innerHeight + 40);
      if (scrollable) {
        await C.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        await C.waitForSelector('#g-timer', { state: 'visible', timeout: 3000 }).catch(() => {});
        check(await C.locator('#g-timer').isVisible() && /\d+ s/.test(await text(C, '#g-timer')), 'al hacer scroll en el teléfono, el tiempo sigue visible arriba');
        await C.evaluate(() => window.scrollTo(0, 0));
      } else {
        check(true, 'en el teléfono pequeño la pregunta cabe entera sin scroll');
      }
      const last = await C.locator('button.option').last().boundingBox();
      check(last && last.y + last.height <= 667, 'en un iPhone SE se ven todas las opciones sin scroll');
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
    const wheelBefore = (await wheelCounts())[0];
    if (plan.manualClose) await host.click('[data-action="close"]');
    const last = n === (await roomRow(code)).total_rounds;
    await Promise.all(teams.map((p) => p.waitForSelector('.answer-status:has-text("los puntos se revelan al final")', { timeout: 40000 })));
    await host.waitForSelector('#host-actions button:has-text("' + (last ? 'CALCULANDO PUNTAJE FINAL' : 'VOLVIENDO A LA RULETA') + '")', { timeout: 5000 });
    check(true, 'al cerrar, los equipos ven "Respuestas cerradas · los puntos se revelan al final" y el anfitrión "' + (last ? 'Calculando puntaje final' : 'Volviendo a la ruleta') + '"');
    if (last) return;   // tras la última ronda se pasa a la pantalla final
    await everyone((p) => visible(p, '#stage-wheel', 15000));
    check(true, 'y vuelven DIRECTO a la ruleta, sin pantalla de resultados ni marcador');
    const wc = await wheelCounts();
    check(allEqual(wc) && wc[0] === wheelBefore - 1, 'el segmento usado desaparece de la ruleta en todos los dispositivos (' + wheelBefore + ' → ' + wc[0] + ')');
    const segAfter = await everyone((p) => p.evaluate(() => window.Ruleta.debugState().wheel.map((x) => x.c)));
    check(allEqual(segAfter) && JSON.stringify(segAfter[0]) === JSON.stringify(segBefore.filter((_, i) => i !== landedIdx)),
      'desaparece exactamente el segmento que salió (' + segBefore[landedIdx] + '); el resto queda igual y en el mismo orden');
    check((await Promise.all(teams.map((p) => text(p, '#g-right')))).every((t) => !/pts/.test(t)), 'los equipos no ven su puntaje durante la partida');
    check((await Promise.all(all().map((p) => p.locator('.my-result, .board, #stage-results').count()))).every((c) => c === 0), 'no hay resultados ni marcador entre rondas');
  }
  const all = () => [host, ...teams];

  await bridge.db.admin.query('update public.rooms set total_rounds = 3 where code=$1', [code]);
  await playQuestionRound(1, {
    checkLocks: true, reloadB: true, manualClose: false,
    answers: [{ page: A, at: 100, option: 'ok' }, { page: B, at: 600, option: 'wrong' }]   // C no responde → se cierra solo a los 15 s
  });
  let sc = await dbScores();
  check(sc['Eco Team'].score === 100 && sc['Los Verdes'].score === 0 && sc['Guardianes'].score === 0,
    'puntos guardados en segundo plano: correcta rápida 100, incorrecta 0, sin respuesta 0');

  await host.reload();
  await visible(host, '#stage-wheel');
  check((await text(host, '#g-right')).includes(code) && await host.locator('[data-action="spin"]').count() === 1, 'el anfitrión recarga la página y recupera la partida en curso');
  const rounds = await everyone((p) => text(p, '#g-round'));
  check(rounds.every((r) => r === '2 / 3'), 'todos están en la ronda 2 / 3');

  await playQuestionRound(2, {
    checkLocks: false, reloadB: false, manualClose: true,
    answers: [{ page: A, at: 400, option: 'wrong' }, { page: B, at: 3000, option: 'ok' }, { page: C, at: 5000, option: 'ok' }]
  });
  sc = await dbScores();
  check(sc['Los Verdes'].score === 90, 'correcta a ~3 s = 90');
  check(sc['Guardianes'].score === 80, 'correcta a ~5 s = 80');
  check(sc['Eco Team'].score === 100, 'incorrecta rápida = 0 (Eco Team sigue en 100)');

  await playQuestionRound(3, {
    checkLocks: false, reloadB: false, manualClose: true,
    answers: [{ page: C, at: 500, option: 'ok' }]
  });

  console.log('\n6. Final');
  await everyone((p) => visible(p, '#stage-gameover'));
  sc = await dbScores();
  check(sc['Eco Team'].score === 100 && sc['Los Verdes'].score === 90 && sc['Guardianes'].score === 180, 'puntos finales: Guardianes 180 (80 + 100), Eco Team 100, Los Verdes 90');
  check(sc['Eco Team'].correct_count === 1 && sc['Los Verdes'].correct_count === 1 && sc['Guardianes'].correct_count === 2, 'aciertos guardados: 1 / 1 / 2');
  const winners = await everyone((p) => text(p, '.winner-name'));
  check(allEqual(winners) && /GUARDIANES/i.test(winners[0]), 'todos ven el mismo ganador: ' + winners[0].replace(/\n/g, ' '));
  const scoreTxt = await everyone((p) => text(p, '.winner-score'));
  check(allEqual(scoreTxt) && /180/.test(scoreTxt[0]), 'puntuación final del ganador: ' + scoreTxt[0]);
  const finals = await everyone((p) => rowsOf(p, '#stage-gameover .rank-row'));
  check(allEqual(finals) && finals[0].length === 3 && /acierto/.test(finals[0][0]), 'clasificación final idéntica para todos, con puntos y aciertos');
  check(/100 pts/.test(await text(A, '#g-right')), 'al final cada equipo ya ve su puntaje');

  check(errors.length === 0, 'sin errores de JavaScript en ningún dispositivo' + (errors.length ? ': ' + errors.join(' | ') : ''));

  console.log(`\n${checks - failures}/${checks} comprobaciones correctas${failures ? ' — HAY ' + failures + ' FALLOS' : ''}`);
  await browser.close();
  await bridge.stop();
  process.exit(failures ? 1 : 0);
})().catch(async (e) => { console.error('ERROR EN LA PRUEBA:', e && e.stack ? e.stack.split(/\n/).slice(0, 3).join(' | ') : e); try { const r = await globalThis.__bridge.db.admin.query('select code, phase, answered_count, question_deadline, now() n from public.rooms'); console.log('estado en la base:', JSON.stringify(r.rows)); } catch (x) {} try { await globalThis.__bridge.stop(); } catch (x) {} process.exit(2); });
