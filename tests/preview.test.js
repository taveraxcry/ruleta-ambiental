/* PREVIEW / DEMO + interacción de respuestas (mouse y táctil), sonido, temporizador y modo local.
   Se ejecuta con Supabase "configurado" (puente de pruebas) para demostrar que el Preview no lo toca. */
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
  const desktop = await newPage({ viewport: { width: 1440, height: 900 } });
  desktop.on('request', (r) => { if (/\/__(rpc|select|auth|events)/.test(r.url())) backendCalls.push(r.url()); });
  const P = desktop;

  const R = (fn, arg) => P.evaluate(fn, arg);
  const forceQuestion = (id) => R((i) => { window.Ruleta.DEBUG_FORCE_QUESTION = i; }, id);
  const questionOf = () => R(() => {
    const t = document.querySelector('.q-text').textContent;
    return window.Ruleta.QUESTIONS.find((q) => q.question === t);
  });
  async function spinAndShow(qid) {
    if (qid) await forceQuestion(qid);
    await P.click('[data-action="spin"]');
    await P.waitForSelector('#category-reveal:not(.hidden)', { timeout: 12000 });
    const cat = await P.locator('#category-reveal .cat-name').innerText();
    await P.click('[data-action="show"]');
    await P.waitForSelector('#stage-question:not(.hidden) .q-text');
    return cat;
  }
  async function toNextRound() {
    await P.waitForSelector('[data-action="board"]', { timeout: 30000 }); await P.click('[data-action="board"]');
    await P.waitForSelector('[data-action="next"]'); await P.click('[data-action="next"]');
  }

  console.log('\n1. Entrar a Preview');
  check(await R(() => window.Ruleta.Sound.state()) === 'none', 'no se crea audio ni suena nada al cargar la página');
  check(await R(() => !window.Ruleta.QUESTIONS), 'el banco de preguntas no se descarga en la página de inicio');
  await P.click('#btn-preview');
  await P.waitForSelector('#stage-wheel:not(.hidden)');
  check(await P.locator('#preview-badge').isVisible() && /PREVIEW \/ DEMO — DATOS SIMULADOS/.test(await P.locator('#preview-badge').innerText()),
    'indicador "PREVIEW / DEMO — DATOS SIMULADOS" visible');
  check(await P.locator('[data-action="spin"]').isVisible(), 'entra directo a la ruleta, sin código ni sala');

  console.log('\n2-5. Ruleta, sonido y categoría');
  await forceQuestion(7);   // CITES, selección múltiple, correcta = B
  await P.click('[data-action="spin"]');
  await P.waitForTimeout(600);
  const midAngle = await R(() => document.getElementById('wheel-rotor').style.transform);
  await P.waitForTimeout(600);
  const midAngle2 = await R(() => document.getElementById('wheel-rotor').style.transform);
  check(midAngle !== midAngle2 && await P.locator('#wheel-wrap.spinning').count() === 1, 'la ruleta gira con animación (' + midAngle + ' → ' + midAngle2 + ')');
  check(await R(() => window.Ruleta.Sound.state()) === 'running', 'el audio se activa con el clic en GIRAR RULETA');
  await P.waitForSelector('#category-reveal:not(.hidden)', { timeout: 12000 });
  const snd = await R(() => window.Ruleta.Sound.stats);
  check(snd.ticks >= 40, 'suena un "tick" al pasar por los segmentos (' + snd.ticks + ' ticks)');
  check(snd.selects === 1, 'suena la selección al detenerse');
  const cat1 = await P.locator('#category-reveal .cat-name').innerText();
  check(cat1 === 'CITES', 'aparece una categoría válida: ' + cat1);
  const under = await R(() => {   // ¿el segmento bajo el puntero es la categoría anunciada?
    const m = /rotate\(([-\d.]+)deg\)/.exec(document.getElementById('wheel-rotor').style.transform);
    const n = window.Ruleta.CATEGORIES.length;
    const a = ((360 - (parseFloat(m[1]) % 360)) % 360);
    return window.Ruleta.CATEGORIES[Math.floor(a / (360 / n))].name;
  });
  check(under === cat1, 'el puntero señala exactamente esa categoría en la ruleta');

  console.log('\n6. Pregunta A/B/C/D clicable (mouse)');
  await P.click('[data-action="show"]');
  await P.waitForSelector('#stage-question:not(.hidden) .q-text');
  const q1 = await questionOf();
  check(q1 && q1.category === 'CITES', 'la pregunta es de la categoría seleccionada');
  check(await P.locator('button.option.is-live:not([disabled])').count() === 4, 'las 4 opciones son botones activos');
  const box = await P.locator('button.option[data-index="0"]').boundingBox();
  const hit = await R((b) => { const el = document.elementFromPoint(b.x + b.width - 12, b.y + b.height - 8); return !!el && !!el.closest('button.option'); }, box);
  check(hit, 'toda el área de la opción responde al clic (incluidas las esquinas)');
  await P.hover('button.option[data-index="2"]');
  await P.waitForTimeout(350);
  const lifted = await R(() => getComputedStyle(document.querySelector('button.option[data-index="2"]')).transform);
  check(lifted !== 'none', 'el hover eleva la opción');
  const t0 = Number(await P.locator('#timer-num').innerText());
  await P.click('button.option[data-index="1"]');
  await P.waitForSelector('.answer-status.ok');
  check(/RESPUESTA REGISTRADA/.test(await P.locator('.answer-status.ok').innerText()), 'aparece "RESPUESTA REGISTRADA"');
  check(await P.locator('button.option.is-selected[data-index="1"][aria-pressed="true"]').count() === 1, 'la opción elegida queda destacada');
  check(await P.locator('button.option:not([disabled])').count() === 0 && await P.locator('button.option.is-dimmed').count() === 3, 'las demás opciones quedan bloqueadas y atenuadas');
  await P.locator('button.option[data-index="3"]').click({ force: true, timeout: 1500 }).catch(() => {});
  check(await P.locator('button.option.is-selected').count() === 1 && await P.locator('button.option.is-selected[data-index="1"]').count() === 1, 'no se puede cambiar ni enviar una segunda respuesta');
  check(await R(() => window.Ruleta.Sound.stats.confirms) === 1, 'sonido suave de confirmación');
  check(!/correcta|incorrecta/i.test(await P.locator('#stage-question').innerText()), 'no se revela la respuesta correcta mientras se responde');

  console.log('\n9. Temporizador');
  check(t0 >= 18 && t0 <= 20, 'arranca en 20 s (' + t0 + ')');
  const dash1 = await R(() => document.getElementById('timer-ring').style.strokeDashoffset);
  await P.waitForTimeout(1600);
  const t1 = Number(await P.locator('#timer-num').innerText());
  const dash2 = await R(() => document.getElementById('timer-ring').style.strokeDashoffset);
  check(t1 < t0 && dash1 !== dash2, 'cuenta hacia atrás con anillo progresivo (' + t0 + ' → ' + t1 + ')');

  console.log('\n10-12. Resultado, puntos y ranking');
  await P.click('[data-action="close"]');
  await P.waitForSelector('#stage-results:not(.hidden)', { timeout: 8000 });
  const mine = await P.locator('.my-result').innerText();
  check(/Correcto/.test(mine) && /\+100/.test(mine), 'resultado: correcta y rápida = +100 (' + mine.replace(/\s+/g, ' ') + ')');
  check(/B\.\s*Apéndice III/.test(await P.locator('.correct-text').innerText()), 'se muestra la respuesta correcta tras cerrar');
  check(await P.locator('#stage-results .rank-row').count() === 5, 'puntos de la ronda para los 5 equipos');
  await P.click('[data-action="board"]');
  await P.waitForSelector('#stage-leaderboard:not(.hidden)');
  const board = await P.locator('#stage-leaderboard tbody tr').allInnerTexts();
  check(board.length === 5 && /Tu equipo/.test(board[0]) && /100/.test(board[0]), 'ranking acumulado con "Tu equipo" primero (100)');

  console.log('\n7 y 13. Verdadero/Falso y siguiente ronda');
  await P.click('[data-action="next"]');
  await P.waitForSelector('#stage-wheel:not(.hidden)');
  check(/2 \/ 5/.test(await P.locator('#g-round').innerText()), 'avanza a la ronda 2');
  await spinAndShow(10);   // RAMSAR, V/F, correcta = Falso
  check(await P.locator('button.option.tf.is-live').count() === 2 && /Verdadero/.test(await P.locator('button.option[data-index="0"]').innerText()) && /Falso/.test(await P.locator('button.option[data-index="1"]').innerText()),
    'Verdadero y Falso son botones activos');
  await P.click('button.option[data-index="0"]');   // incorrecta
  await P.waitForSelector('.answer-status.ok');
  check(await P.locator('button.option.tf:not([disabled])').count() === 0, 'tras elegir Verdadero/Falso queda bloqueado');
  await P.click('[data-action="close"]');
  await P.waitForSelector('#stage-results:not(.hidden)', { timeout: 8000 });
  check(/incorrecta/i.test(await P.locator('.my-result').innerText()) && /0 pts/.test(await P.locator('.my-result').innerText()), 'respuesta incorrecta = 0 pts');
  check(/F\.\s*Falso/.test(await P.locator('.correct-text').innerText()), 'respuesta correcta: F. Falso');
  await toNextRound();

  console.log('\nTiempo agotado sin responder');
  await spinAndShow(null);
  const q3 = await questionOf();
  const cat3 = await P.locator('.cat-badge').innerText();
  check(q3 && cat3 === window_catName(q3.category), 'ronda 3: categoría aleatoria válida y pregunta de esa categoría (' + cat3 + ')');
  await P.waitForSelector('#stage-results:not(.hidden)', { timeout: 30000 });
  check(/Sin respuesta · 0 pts/.test(await P.locator('.my-result').innerText()), 'al acabar los 20 s sin responder: "Sin respuesta · 0 pts"');
  await toNextRound();

  console.log('\n14. Pantalla final');
  for (let r = 4; r <= 5; r++) {
    await spinAndShow(null);
    await P.click('[data-action="close"]');
    await P.waitForSelector('[data-action="board"]', { timeout: 8000 }); await P.click('[data-action="board"]');
    await P.waitForSelector('[data-action="next"]');
    if (r === 5) check(/FINALIZAR/.test(await P.locator('[data-action="next"]').innerText()), 'tras la última ronda: "FINALIZAR PARTIDA"');
    await P.click('[data-action="next"]');
  }
  await P.waitForSelector('#stage-gameover:not(.hidden)');
  check(await P.locator('.winner-name').innerText() !== '' && /PUNTOS/.test(await P.locator('.winner-score').innerText()), 'ganador y puntuación final: ' + (await P.locator('.winner-name').innerText()) + ' — ' + (await P.locator('.winner-score').innerText()));
  check(await P.locator('#stage-gameover .rank-row').count() === 5, 'clasificación final completa (5 equipos)');
  check(await P.locator('[data-action="restart"]').isVisible(), 'botón para salir del Preview');

  console.log('\n16. Preview no toca Supabase');
  check(backendCalls.length === 0, 'cero llamadas a Supabase durante el Preview (' + backendCalls.length + ')');
  const rooms = (await bridge.db.admin.query('select count(*)::int n from public.rooms')).rows[0].n;
  check(rooms === 0, 'no se creó ninguna sala real en la base (' + rooms + ')');

  console.log('\nPantalla táctil (teléfono en Preview)');
  const phone = await newPage({ viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await phone.tap('#btn-preview');
  await phone.waitForSelector('[data-action="spin"]');
  await phone.evaluate(() => { window.Ruleta.DEBUG_FORCE_QUESTION = 20; });   // la pregunta más larga
  await phone.tap('[data-action="spin"]');
  await phone.waitForSelector('[data-action="show"]', { timeout: 12000 });
  await phone.tap('[data-action="show"]');
  await phone.waitForSelector('button.option.is-live');
  check(!(await phone.locator('#g-timer').isVisible()), 'con el reloj de la tarjeta a la vista, el encabezado muestra la ronda');
  await phone.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await phone.waitForSelector('#g-timer', { state: 'visible', timeout: 3000 }).catch(() => {});
  check(await phone.locator('#g-timer').isVisible(), 'al bajar en el teléfono, el tiempo restante queda fijo arriba: ' + (await phone.locator('#g-timer').innerText()));
  await phone.tap('button.option[data-index="0"]');
  await phone.waitForSelector('.answer-status.ok');
  check(await phone.locator('button.option.is-selected[data-index="0"]').count() === 1, 'tocar una opción la registra (táctil)');
  const overflow = await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(overflow <= 0, 'sin desbordamiento horizontal en el teléfono');
  const tapH = await phone.locator('button.option[data-index="0"]').boundingBox();
  check(tapH.height >= 56, 'objetivos táctiles grandes (' + Math.round(tapH.height) + ' px de alto)');

  console.log('\nModo local (sin Supabase): anfitrión + equipo en dos pestañas');
  const lctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await lctx.route(/fonts|jsdelivr/, (r) => r.abort());
  const lh = await lctx.newPage(); await lh.goto(LOCAL_URL);
  const lt = await lctx.newPage(); await lt.goto(LOCAL_URL);
  await lh.click('#btn-create');
  const lcode = await lh.locator('#host-code').innerText();
  await lt.click('#btn-join'); await lt.fill('#join-code', lcode); await lt.fill('#join-name', 'Pestaña'); await lt.click('#join-submit');
  await lt.waitForSelector('#screen-team-lobby:not(.hidden)');
  await lh.click('#btn-start'); await lh.click('[data-action="spin"]');
  await lh.waitForSelector('[data-action="show"]', { timeout: 12000 }); await lh.click('[data-action="show"]');
  await lt.waitForSelector('button.option.is-live');
  await lt.click('button.option[data-index="1"]');
  await lt.waitForSelector('.answer-status.ok');
  await lh.waitForFunction(() => /1 \/ 1/.test(document.querySelector('#answer-count').textContent));
  check(true, 'modo local: el equipo responde y el anfitrión lo recibe');

  check(errors.length === 0, 'sin errores de JavaScript' + (errors.length ? ': ' + errors.join(' | ') : ''));
  console.log(`\n${checks - failures}/${checks} comprobaciones correctas${failures ? ' — HAY ' + failures + ' FALLOS' : ''}`);
  await browser.close();
  await bridge.stop();
  process.exit(failures ? 1 : 0);

  function window_catName(id) {
    const cats = { KYOTO: 'KYOTO', ESCAZU: 'ESCAZÚ', BASILEA: 'BASILEA', CITES: 'CITES', RAMSAR: 'RAMSAR', PARIS: 'PARÍS', GINEBRA: 'GINEBRA', GOTHENBURG: 'GOTHENBURG', BRUNDTLAND: 'BRUNDTLAND', EPI: 'EPI', INTEGRADORA: 'INTEGRADORA' };
    return cats[id];
  }
})().catch((e) => { console.error('ERROR EN LA PRUEBA:', e.message); process.exit(2); });
