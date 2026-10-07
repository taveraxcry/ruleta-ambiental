/* Interacción con mouse y táctil, ruleta (giro, sonido, segmentos que desaparecen), temporizador,
   puntaje oculto hasta el final y modo local. Usa el modo PREVIEW (oculto, ?demo=1) con Supabase
   "configurado" (puente de pruebas) para demostrar además que el Preview no toca Supabase. */
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright-core');
const { startBridge } = require('./bridge');

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const SHIM = fs.readFileSync(path.join(__dirname, 'supabase-shim.js'), 'utf8');
const LOCAL_URL = 'file:///' + path.join(__dirname, '..', 'index.html').replace(/\\/g, '/').replace(/ /g, '%20');

let failures = 0, checks = 0;
function check(cond, msg) { checks++; if (cond) console.log('  ✓', msg); else { failures++; console.log('  ✗', msg); } }

(async () => {
  const bridge = await startBridge({ dbPort: 54333, httpPort: 8101, rounds: 10 });
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const errors = [];

  async function newPage(opts, url) {
    const ctx = await browser.newContext(opts);
    await ctx.route('https://cdn.jsdelivr.net/**', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: SHIM }));
    await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    const page = await ctx.newPage();
    page.setDefaultTimeout(30000);
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(url || bridge.url);
    return page;
  }
  const backendCalls = [];
  const P = await newPage({ viewport: { width: 1440, height: 900 } });
  P.on('request', (r) => { if (/\/__(rpc|select|auth|events)/.test(r.url())) backendCalls.push(r.url()); });

  const R = (fn, arg) => P.evaluate(fn, arg);
  const st = () => R(() => { const s = window.Ruleta.debugState(); return { phase: s.phase, round: s.currentRound, n: s.wheel.length, cat: s.currentCategory, teams: s.teams.map((t) => ({ name: t.name, score: t.score, correct: t.correct })) }; });
  const questionOf = () => R(() => {
    const t = document.querySelector('.q-text').textContent;
    return window.Ruleta.QUESTIONS.find((q) => q.question === t);
  });
  async function spin(force) {
    if (force) await R((f) => { window.Ruleta.DEBUG_FORCE_QUESTION = f; }, force);
    await P.click('[data-action="spin"]');
    await P.waitForSelector('[data-action="show"]', { timeout: 15000 });
    return P.locator('#category-reveal .cat-name').innerText();
  }
  const backToWheel = () => P.waitForSelector('[data-action="spin"], #stage-gameover:not(.hidden)', { timeout: 30000 });

  console.log('\n1. Inicio');
  check(await R(() => window.Ruleta.Sound.state()) === 'none', 'no se crea audio ni suena nada al cargar la página');
  check(await R(() => !window.Ruleta.QUESTIONS), 'el banco de preguntas no se descarga en la página de inicio');
  check(await P.locator('#btn-preview').count() === 0, 'el botón PREVIEW / DEMO ya no aparece en el inicio');
  await P.goto(bridge.url + '/?demo=1');
  await P.waitForSelector('[data-action="spin"]');
  check(await P.locator('#preview-badge').isVisible(), 'el modo de revisión sigue disponible con ?demo=1, marcado como DATOS SIMULADOS');
  let s = await st();
  check(s.n === 20, 'la ruleta empieza con 20 segmentos, uno por pregunta (sin BONUS)');

  console.log('\n2. Giro: animación, sonido y categoría');
  await R(() => { window.Ruleta.DEBUG_FORCE_QUESTION = 7; });   // CITES, selección múltiple, correcta = B
  await P.click('[data-action="spin"]');
  const a0 = await R(() => document.getElementById('wheel-rotor').style.transform);
  await P.waitForTimeout(250);
  const a1 = await R(() => document.getElementById('wheel-rotor').style.transform);
  await P.waitForTimeout(900);
  const a2 = await R(() => document.getElementById('wheel-rotor').style.transform);
  const deg = (t) => parseFloat(/rotate\(([-\d.]+)deg\)/.exec(t)[1]);
  check(deg(a1) - deg(a0) < deg(a2) - deg(a1), 'arranque suave: la ruleta acelera al empezar (' + Math.round(deg(a1) - deg(a0)) + '° → ' + Math.round(deg(a2) - deg(a1)) + '°)');
  check(await R(() => window.Ruleta.Sound.state()) === 'running', 'el audio se activa con el clic en GIRAR RULETA');
  const t0 = Date.now();
  await P.waitForSelector('[data-action="show"]', { timeout: 15000 });
  const spinMs = Date.now() - t0 + 1150;
  check(spinMs >= 6500 && spinMs <= 9000, 'giro largo y realista (~' + (spinMs / 1000).toFixed(1) + ' s)');
  const snd = await R(() => window.Ruleta.Sound.stats);
  check(snd.ticks >= 40, 'suena un "tick" en cada perno (' + snd.ticks + ' ticks)');
  check(snd.selects === 1, 'suena la selección al detenerse');
  const cat1 = await P.locator('#category-reveal .cat-name').innerText();
  check(cat1 === 'CITES', 'aparece la categoría del segmento: ' + cat1);
  const under = await R(() => {   // ¿el segmento bajo la aguja es el anunciado?
    const m = /rotate\(([-\d.]+)deg\)/.exec(document.getElementById('wheel-rotor').style.transform);
    const w = window.Ruleta.debugState().wheel;
    const a = ((360 - (parseFloat(m[1]) % 360)) % 360);
    return w[Math.floor(a / (360 / w.length))].c;
  });
  check(under === 'CITES', 'la aguja señala exactamente ese segmento');

  console.log('\n3. Pregunta A/B/C/D (mouse)');
  await P.click('[data-action="show"]');
  await P.waitForSelector('#stage-question:not(.hidden) .q-text');
  const q1 = await questionOf();
  check(q1 && q1.id === 7 && q1.category === 'CITES', 'la pregunta es la del segmento (CITES)');
  check(await P.locator('button.option.is-live:not([disabled])').count() === 4, 'las 4 opciones son botones activos');
  const box = await P.locator('button.option[data-index="0"]').boundingBox();
  check(await R((b) => { const el = document.elementFromPoint(b.x + b.width - 12, b.y + b.height - 8); return !!el && !!el.closest('button.option'); }, box), 'toda el área de la opción responde al clic');
  await P.hover('button.option[data-index="2"]'); await P.waitForTimeout(350);
  check(await R(() => getComputedStyle(document.querySelector('button.option[data-index="2"]')).transform) !== 'none', 'el hover eleva la opción');
  const tA = Number(await P.locator('#timer-num').innerText());
  await P.click('button.option[data-index="1"]');
  await P.waitForSelector('.answer-status.ok');
  check(/RESPUESTA REGISTRADA/.test(await P.locator('.answer-status.ok').innerText()), 'aparece "RESPUESTA REGISTRADA"');
  check(await P.locator('button.option.is-selected[data-index="1"][aria-pressed="true"]').count() === 1, 'la opción elegida queda destacada');
  check(await P.locator('button.option:not([disabled])').count() === 0 && await P.locator('button.option.is-dimmed').count() === 3, 'las demás quedan bloqueadas y atenuadas');
  await P.locator('button.option[data-index="3"]').click({ force: true, timeout: 1500 }).catch(() => {});
  check(await P.locator('button.option.is-selected').count() === 1, 'no se puede cambiar ni enviar otra respuesta');
  check(!/correcta|incorrecta/i.test(await P.locator('#stage-question').innerText()), 'no se revela la respuesta correcta');
  check(tA >= 8 && tA <= 10, 'el temporizador arranca en 10 s (' + tA + ')');
  const d1 = await R(() => document.getElementById('timer-ring').style.strokeDashoffset);
  await P.waitForTimeout(1600);
  check(Number(await P.locator('#timer-num').innerText()) < tA && d1 !== await R(() => document.getElementById('timer-ring').style.strokeDashoffset), 'cuenta hacia atrás con anillo progresivo');

  console.log('\n4. Cierre: puntos en segundo plano y vuelta directa a la ruleta');
  await P.click('[data-action="close"]');
  await P.waitForSelector('.answer-status:has-text("los puntos se revelan al final")');
  check(true, 'al cerrar: "Respuestas cerradas · los puntos se revelan al final"');
  await backToWheel();
  s = await st();
  check(s.round === 2 && s.phase === 'WAITING', 'vuelve directo a la ruleta (ronda 2), sin pantalla de resultados');
  check(await P.locator('.my-result, .board, #stage-results, #stage-leaderboard').count() === 0, 'no existe marcador entre rondas');
  check(!/pts/.test(await P.locator('#g-right').innerText()), 'el puntaje no se muestra durante la partida');
  check(s.teams[0].score === 100 && s.teams[0].correct === 1, 'pero se guardó: correcta y rápida = 100 pts, 1 acierto');
  check(s.n === 19, 'el segmento usado desapareció (20 → 19)');

  console.log('\n5. Verdadero/Falso y tiempo agotado');
  await spin(10);   // RAMSAR, V/F, correcta = Falso
  await P.click('[data-action="show"]');
  await P.waitForSelector('button.option.tf.is-live');
  check(await P.locator('button.option.tf.is-live').count() === 2 && /Verdadero/.test(await P.locator('button.option[data-index="0"]').innerText()), 'Verdadero y Falso son botones activos');
  await P.click('button.option[data-index="0"]');   // incorrecta
  await P.waitForSelector('.answer-status.ok');
  check(await P.locator('button.option.tf:not([disabled])').count() === 0, 'tras elegir, queda bloqueado');
  await P.click('[data-action="close"]');
  await backToWheel();
  s = await st();
  check(s.teams[0].score === 100 && s.teams[0].correct === 1 && s.n === 18 && s.round === 3, 'respuesta incorrecta = 0 puntos (sigue en 100); quedan 18 segmentos');
  await spin(null);
  await P.click('[data-action="show"]');
  const q3 = await questionOf();
  check(q3 && q3.category === (await st()).cat, 'ronda 3: pregunta al azar, de la categoría del segmento (' + q3.category + ')');
  const sc0 = (await st()).teams[0].score;
  await P.waitForSelector('.answer-status.late', { timeout: 30000 });
  check(/Tiempo agotado · sin respuesta/.test(await P.locator('.answer-status.late').innerText()), 'al acabar los 10 s sin responder: "Tiempo agotado · sin respuesta"');
  await backToWheel();
  check((await st()).teams[0].score === sc0, 'sin respuesta = 0 puntos');

  console.log('\n6. Final (puntaje revelado)');
  for (let r = 4; r <= 5; r++) {
    await spin(null);
    await P.click('[data-action="show"]'); await P.click('[data-action="close"]');
    if (r < 5) await backToWheel();
  }
  await P.waitForSelector('#stage-gameover:not(.hidden)', { timeout: 30000 });
  check(/PUNTOS/.test(await P.locator('.winner-score').innerText()), 'ganador y puntuación final: ' + (await P.locator('.winner-name').innerText()) + ' — ' + (await P.locator('.winner-score').innerText()));
  check(await P.locator('#stage-gameover .rank-row').count() === 5 && /acierto/.test(await P.locator('#stage-gameover .rank-row').first().innerText()), 'clasificación completa con puntos y aciertos');
  check(/pts/.test(await P.locator('#g-right').innerText()), 'al final sí se muestra el puntaje del equipo');

  console.log('\n7. Preview no toca Supabase');
  check(backendCalls.length === 0, 'cero llamadas a Supabase (' + backendCalls.length + ')');
  check((await bridge.db.admin.query('select count(*)::int n from public.rooms')).rows[0].n === 0, 'no se creó ninguna sala real');

  console.log('\n8. Teléfono');
  const phone = await newPage({ viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  check(!(await phone.locator('#btn-create').isVisible()) && await phone.locator('#btn-join').isVisible(), 'en el teléfono solo aparece "Unirse a una sala"');
  check(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'sin desbordamiento horizontal en el inicio');
  await phone.goto(bridge.url + '/?demo=1');
  await phone.waitForSelector('[data-action="spin"]');
  await phone.evaluate(() => { window.Ruleta.DEBUG_FORCE_QUESTION = 20; });   // la pregunta más larga
  await phone.tap('[data-action="spin"]');
  await phone.waitForSelector('[data-action="show"]', { timeout: 15000 });
  check(await phone.evaluate(() => document.getElementById('category-reveal').getBoundingClientRect().bottom <= innerHeight), 'tras el giro, la categoría se ve sin bajar');
  await phone.tap('[data-action="show"]');
  await phone.waitForSelector('button.option.is-live');
  check(!(await phone.locator('#g-timer').isVisible()), 'con el reloj de la tarjeta a la vista, el encabezado muestra la ronda');
  await phone.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await phone.waitForTimeout(300);
  const hidden = await phone.evaluate(() => document.getElementById('timer').getBoundingClientRect().bottom < document.querySelector('.game-header').getBoundingClientRect().bottom);
  if (hidden) {
    await phone.waitForSelector('#g-timer', { state: 'visible', timeout: 3000 }).catch(() => {});
    check(await phone.locator('#g-timer').isVisible(), 'al bajar y perder de vista el reloj, el tiempo restante queda fijo arriba');
  } else {
    check(await phone.locator('#timer').isVisible(), 'aun al bajar, el reloj de la tarjeta sigue a la vista');
  }
  await phone.tap('button.option[data-index="0"]');
  await phone.waitForSelector('.answer-status.ok');
  check(await phone.locator('button.option.is-selected[data-index="0"]').count() === 1, 'tocar una opción la registra (táctil)');
  check(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'sin desbordamiento horizontal en la pregunta');
  const tapH = await phone.locator('button.option[data-index="0"]').boundingBox();
  check(tapH.height >= 50, 'objetivos táctiles grandes (' + Math.round(tapH.height) + ' px)');
  const vp = await phone.evaluate(() => document.querySelector('meta[name=viewport]').content);
  check(/minimum-scale=1/.test(vp), 'no se puede alejar el zoom por debajo del tamaño de la pantalla (sin franjas negras)');
  const bg = await phone.evaluate(() => { const r = document.getElementById('bg-canvas').getBoundingClientRect(); return r.width >= innerWidth && r.height >= innerHeight; });
  check(bg, 'el fondo animado cubre toda la pantalla');

  console.log('\nModo local (sin Supabase): anfitrión + equipo en dos pestañas');
  const lctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await lctx.route(/fonts|jsdelivr/, (r) => r.abort());
  const lh = await lctx.newPage(); await lh.goto(LOCAL_URL);
  const lt = await lctx.newPage(); await lt.goto(LOCAL_URL);
  await lh.click('#btn-create');
  const lcode = await lh.locator('#host-code').innerText();
  await lt.click('#btn-join'); await lt.fill('#join-code', lcode); await lt.fill('#join-name', 'Pestaña'); await lt.click('#join-submit');
  await lt.waitForSelector('#screen-team-lobby:not(.hidden)');
  await lh.click('#btn-start');
  await lh.evaluate(() => { window.Ruleta.DEBUG_FORCE_QUESTION = 3; });
  await lh.click('[data-action="spin"]');
  await lh.waitForSelector('[data-action="show"]', { timeout: 15000 }); await lh.click('[data-action="show"]');
  await lt.waitForSelector('button.option.is-live');
  await lt.click('button.option[data-index="2"]');
  await lt.waitForSelector('.answer-status.ok');
  await lh.waitForFunction(() => /1 \/ 1/.test(document.querySelector('#answer-count').textContent));
  check(true, 'modo local: el equipo responde y el anfitrión lo recibe');

  check(errors.length === 0, 'sin errores de JavaScript' + (errors.length ? ': ' + errors.join(' | ') : ''));
  console.log(`\n${checks - failures}/${checks} comprobaciones correctas${failures ? ' — HAY ' + failures + ' FALLOS' : ''}`);
  await browser.close();
  await bridge.stop();
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('ERROR EN LA PRUEBA:', e.message); process.exit(2); });
