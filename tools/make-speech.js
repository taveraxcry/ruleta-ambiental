/* Genera speech/Ruleta-Ambiental-Guion.pdf: guion de presentación + todas las preguntas con sus respuestas,
   en el mismo orden de los segmentos de la ruleta. Las preguntas salen de js/questions.js y el orden de
   R.buildWheel, así el PDF siempre coincide con el juego.
   Uso: node tools/make-speech.js   (requiere tests/node_modules con playwright-core y Google Chrome) */
const fs = require('fs');
const path = require('path');
const { chromium } = require(path.join(__dirname, '../tests/node_modules/playwright-core'));

const ROOT = path.join(__dirname, '..');
global.window = {};
eval(fs.readFileSync(path.join(ROOT, 'js/config.js'), 'utf8'));
eval(fs.readFileSync(path.join(ROOT, 'js/questions.js'), 'utf8'));
const R = window.Ruleta;
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = path.join(ROOT, 'speech', 'Ruleta-Ambiental-Guion.pdf');

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const cat = (id) => (id === 'BONUS' ? R.BONUS : R.CATEGORIES.find((c) => c.id === id));
const TYPE = R.QUESTION_TYPES;
const tag = (q, i) => (q.type === 'true_false' ? (i === 0 ? 'V' : 'F') : 'ABCD'[i]);

async function wheelImage(browser) {
  const ctx = await browser.newContext({ viewport: { width: 900, height: 900 }, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  await p.goto('file:///' + path.join(ROOT, 'index.html').replace(/\\/g, '/').replace(/ /g, '%20') + '?demo=1');
  await p.waitForSelector('[data-action="spin"]');
  await p.evaluate(() => document.fonts.ready);
  await p.addStyleTag({ content: 'html,body{background:transparent!important} .wheel-aura,.bg-canvas,.bg-glow,.game-header,#host-actions,.wheel-side,#preview-badge{display:none!important} .wheel-rotor{box-shadow:none!important} .wheel-wrap{--wheel:640px!important;margin:80px 40px 40px!important}' });
  await p.waitForTimeout(900);
  const bb = await p.locator('#wheel-wrap').boundingBox();
  const pad = 0.1 * bb.width;   // incluye la aguja, que sobresale por arriba
  const buf = await p.screenshot({ omitBackground: true, clip: { x: bb.x - 6, y: bb.y - pad, width: bb.width + 12, height: bb.height + pad + 6 } });
  await ctx.close();
  return 'data:image/png;base64,' + buf.toString('base64');
}

function questionsHtml() {
  const wheel = R.buildWheel(R.QUESTIONS);
  return wheel.map((seg, i) => {
    const c = cat(seg.c);
    const n = String(i + 1).padStart(2, '0');
    if (seg.c === 'BONUS') {
      return `<article class="q bonus"><div class="q-head"><span class="seg">${n}</span><span class="chip" style="--c:${c.color}">★ BONUS</span></div>
        <p class="q-text">Se salta la pregunta: <b>todos los equipos suman ${R.CONFIG.BONUS_POINTS} puntos</b>. El segmento desaparece de la ruleta.</p></article>`;
    }
    const q = R.QUESTIONS.find((x) => x.id === seg.q);
    const opts = q.options.map((o, k) => `<li class="${k === q.correctAnswer ? 'ok' : ''}"><span class="l">${tag(q, k)}</span><span>${esc(o)}</span>${k === q.correctAnswer ? '<span class="mark">✓ Correcta</span>' : ''}</li>`).join('');
    return `<article class="q"><div class="q-head"><span class="seg">${n}</span><span class="chip" style="--c:${c.color}">${esc(c.name)}</span>
      <span class="type">${esc(TYPE[q.type])} · Pregunta ${q.id}</span></div>
      <p class="q-text">${esc(q.question)}</p><ul class="opts">${opts}</ul></article>`;
  }).join('');
}

function html(wheelSrc) {
  const wheel = R.buildWheel(R.QUESTIONS);
  const cats = R.CATEGORIES.filter((c) => c.enabled);
  const legend = cats.map((c) => {
    const k = wheel.filter((s) => s.c === c.id).length;
    return `<li><span class="dot" style="background:${c.color}"></span><b>${esc(c.name)}</b><span>${esc(c.topic)}</span><em>${k} ${k === 1 ? 'pregunta' : 'preguntas'}</em></li>`;
  }).join('') + `<li><span class="dot" style="background:${R.BONUS.color}"></span><b>BONUS</b><span>+${R.CONFIG.BONUS_POINTS} puntos para todos, se salta la pregunta</span><em>3 segmentos</em></li>`;
  const scoreRows = R.SCORE_TABLE.map((b, i) => `<tr><td>${i === 0 ? '0' : R.SCORE_TABLE[i - 1].maxSeconds + 1}–${b.maxSeconds} s</td><td>${b.points}</td></tr>`).join('');

  return `<!doctype html><html lang="es"><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
<style>
  @page { size: A4; margin: 18mm 17mm 18mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: Montserrat, sans-serif; color: #1d2b29; font-size: 10.6pt; line-height: 1.55; background: #fff; }
  h1, h2, h3 { margin: 0; line-height: 1.15; }
  .cover { height: 257mm; display: flex; flex-direction: column; justify-content: center; page-break-after: always; position: relative; }
  .cover .band { position: absolute; left: 0; right: 0; top: 0; height: 8px; border-radius: 6px; background: linear-gradient(90deg, #5ef0bd, #2fd4c0, #47c8f5); }
  .kicker { font-size: 9pt; letter-spacing: .28em; font-weight: 700; color: #129e88; text-transform: uppercase; }
  .cover h1 { font-size: 46pt; font-weight: 900; letter-spacing: -.01em; margin: 10px 0 6px; }
  .cover h1 span { color: #12a58c; }
  .cover .sub { font-size: 15pt; font-weight: 500; color: #46605c; }
  .cover .meta { margin-top: 34px; display: flex; gap: 12px; flex-wrap: wrap; }
  .pill { border: 1px solid #cfe7e1; background: #f2faf8; border-radius: 999px; padding: 7px 14px; font-size: 9pt; font-weight: 600; color: #2b4945; }
  .cover .wheel { margin: 34px auto 0; width: 108mm; display: block; filter: drop-shadow(0 10px 18px rgba(0,0,0,.18)); }
  .cover .foot { position: absolute; bottom: 0; font-size: 8.5pt; color: #7a908c; }
  h2.section { font-size: 19pt; font-weight: 800; margin: 0 0 4px; }
  .lead { color: #4c6662; margin: 0 0 18px; }
  .block { break-inside: avoid; margin: 0 0 12px; padding: 12px 16px 10px; border-radius: 12px; border: 1px solid #e3efec; background: #fbfdfc; }
  .block h3 { font-size: 12pt; font-weight: 800; display: flex; align-items: baseline; gap: 10px; }
  .block h3 .n { color: #12a58c; }
  .block h3 .t { margin-left: auto; font-size: 8.5pt; font-weight: 700; color: #129e88; letter-spacing: .1em; }
  .say { margin: 6px 0 6px; padding: 8px 13px; border-left: 3px solid #2fd4c0; background: #eefaf7; border-radius: 0 8px 8px 0; font-style: italic; color: #24403c; }
  .block ul { margin: 6px 0 0; padding-left: 18px; }
  .block li { margin: 2px 0; }
  .tip { font-size: 9pt; color: #5d7672; }
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
  table.score { width: 100%; border-collapse: collapse; font-size: 9.5pt; }
  table.score td { padding: 2px 8px; border-bottom: 1px solid #e3efec; }
  table.score td:last-child { text-align: right; font-weight: 800; color: #0f8f7a; }
  table.score tr.zero td:last-child { color: #b5483a; }
  .legend { list-style: none; padding: 0; margin: 0; display: grid; gap: 6px; }
  .legend li { display: grid; grid-template-columns: 12px 1fr auto; column-gap: 8px; align-items: center; font-size: 9pt; }
  .legend li > span:nth-child(3) { grid-column: 2 / 3; font-size: 8pt; color: #6c8480; line-height: 1.3; }
  .legend li > em { grid-row: 1; grid-column: 3; }
  .legend em { font-style: normal; color: #6c8480; font-size: 8.5pt; }
  .dot { width: 12px; height: 12px; border-radius: 50%; display: inline-block; }
  .page-break { page-break-before: always; }
  .wheel-row { display: grid; grid-template-columns: 64mm 1fr; gap: 18px; align-items: center; margin-bottom: 14px; }
  .wheel-row img { width: 64mm; filter: drop-shadow(0 6px 12px rgba(0,0,0,.15)); }
  .q { break-inside: avoid; margin: 0 0 10px; padding: 11px 14px; border: 1px solid #e3efec; border-radius: 12px; }
  .q.bonus { background: #fff8e6; border-color: #f1d58a; }
  .q-head { display: flex; align-items: center; gap: 10px; margin-bottom: 5px; }
  .seg { font-size: 8.5pt; font-weight: 800; color: #fff; background: #1d2b29; border-radius: 6px; padding: 2px 7px; }
  .chip { font-size: 8.5pt; font-weight: 800; letter-spacing: .06em; padding: 2px 9px 2px 8px; border-radius: 999px; color: #1d2b29; background: color-mix(in srgb, var(--c) 18%, white); border: 1px solid color-mix(in srgb, var(--c) 55%, white); }
  .type { margin-left: auto; font-size: 8pt; color: #6c8480; font-weight: 600; }
  .q-text { margin: 2px 0 6px; font-weight: 600; }
  .opts { list-style: none; padding: 0; margin: 0; display: grid; gap: 3px; font-size: 9.6pt; }
  .opts li { display: flex; gap: 8px; align-items: baseline; padding: 3px 8px; border-radius: 7px; }
  .opts li.ok { background: #e3f8ef; font-weight: 700; color: #0d6b52; }
  .opts .l { font-weight: 800; width: 14px; flex: 0 0 auto; color: #5d7672; }
  .opts li.ok .l { color: #0d6b52; }
  .opts .mark { margin-left: auto; font-size: 8pt; font-weight: 800; white-space: nowrap; }
  .key { columns: 2; font-size: 9pt; margin: 0; padding: 0; list-style: none; }
  .key li { break-inside: avoid; padding: 2px 0; border-bottom: 1px dotted #dbe8e5; }
  .key b { display: inline-block; width: 26px; }
</style></head><body>

<section class="cover">
  <div class="band"></div>
  <span class="kicker">🌎 Guion de presentación</span>
  <h1>RULETA <span>AMBIENTAL</span></h1>
  <div class="sub">Gestión Ambiental y Logística Reversa</div>
  <div class="meta"><span class="pill">⏱ 8 a 10 minutos</span><span class="pill">10 rondas · 20 s por pregunta</span><span class="pill">20 preguntas + 3 BONUS</span><span class="pill">Un equipo = un teléfono</span></div>
  <img class="wheel" src="${wheelSrc}" alt="La ruleta">
  <div class="foot">taveraxcry.github.io/ruleta-ambiental</div>
</section>

<h2 class="section">El guion</h2>
<p class="lead">Lo que va entre comillas es una sugerencia para decirlo en voz alta. Debajo, lo que conviene mostrar en pantalla.</p>

<div class="block"><h3><span class="n">1</span> Qué es Ruleta Ambiental <span class="t">1 MIN</span></h3>
<p class="say">“Ruleta Ambiental es un concurso en tiempo real sobre los acuerdos y las herramientas de la gestión ambiental. Cada equipo juega desde un teléfono, la ruleta decide la pregunta, y gana quien responde bien y más rápido.”</p>
<ul><li>Repasa Kioto, París, Basilea, CITES, Ramsar, Escazú, Gotemburgo, Ginebra 1979, Brundtland, el EPI e integración entre ellos.</li>
<li>Todos ven lo mismo al mismo tiempo: la misma ruleta, la misma pregunta y el mismo reloj.</li></ul></div>

<div class="block"><h3><span class="n">2</span> Cómo se entra <span class="t">1,5 MIN</span></h3>
<p class="say">“El docente crea la sala desde el computador. Ustedes escanean el código QR con la cámara del teléfono, escriben el nombre de su equipo y listo: ya están en la sala.”</p>
<ul><li>Computador del docente: <b>Crear sala</b> → aparece el código (por ejemplo ECO-7K4) y el QR.</li>
<li>Teléfonos: escanear el QR, o abrir la página y pulsar <b>Unirse a una sala</b>. El nombre del equipo es libre.</li>
<li>Un equipo = un teléfono. Si alguien recarga la página por error, vuelve a su equipo sin perder nada.</li></ul></div>

<div class="block"><h3><span class="n">3</span> Cómo es una ronda <span class="t">2 MIN</span></h3>
<p class="say">“Giramos la ruleta. Donde se detenga la aguja, esa es la pregunta. Tienen 20 segundos y una sola oportunidad: cuando tocan una respuesta, queda bloqueada. Al cerrar, volvemos directo a la ruleta.”</p>
<ul><li><b>Girar</b> → la aguja marca un segmento: un tema (con su color) o un <b>BONUS</b>.</li>
<li><b>Pregunta</b> → aparece en todos los teléfonos a la vez, con un reloj de 20 segundos.</li>
<li><b>Responder</b> → un toque. Sale “Respuesta registrada” y ya no se puede cambiar.</li>
<li><b>Cierre</b> → a los 20 s (o cuando el docente cierra) se vuelve a la ruleta. Nadie ve quién respondió primero.</li></ul></div>

<div class="block"><h3><span class="n">4</span> Cómo se gana <span class="t">1,5 MIN</span></h3>
<p class="say">“No basta con acertar: también cuenta la velocidad. Una respuesta correcta en los primeros 2 segundos vale 100 puntos; al final del tiempo vale 20. Si se equivocan o no responden, 0. Y los puntos no se muestran hasta el final: la sorpresa queda para el cierre.”</p>
<div class="grid2"><table class="score">${scoreRows}<tr class="zero"><td>Incorrecta</td><td>0</td></tr><tr class="zero"><td>Sin respuesta</td><td>0</td></tr></table>
<div><ul style="margin:0"><li><b>BONUS:</b> se salta la pregunta y <b>todos</b> suman ${R.CONFIG.BONUS_POINTS} puntos.</li>
<li>El tiempo lo mide el servidor, no el teléfono: nadie gana por tener un reloj adelantado.</li>
<li>Al final se revela la clasificación: puntos y aciertos de cada equipo.</li></ul></div></div></div>

<div class="block"><h3><span class="n">5</span> La ruleta <span class="t">1 MIN</span></h3>
<p class="say">“Cada segmento es una pregunta, y cada pregunta que sale desaparece. La ruleta no se achica: va teniendo menos opciones. Empieza con 23 segmentos: 20 preguntas y 3 BONUS.”</p>
<ul><li>Los colores identifican el tema. Los BONUS son dorados.</li>
<li>Ninguna pregunta se repite en la misma partida.</li></ul></div>

<div class="block"><h3><span class="n">6</span> Lo que no se ve <span class="t">1 MIN</span></h3>
<p class="say">“Todo lo decide un servidor en la nube, una sola vez y para todos. Por eso todos ven el mismo giro, la misma pregunta y el mismo reloj, y nadie puede ver las respuestas ni cambiar sus puntos.”</p>
<ul><li>Las respuestas correctas nunca llegan a los teléfonos.</li>
<li>Cada equipo responde una sola vez; el servidor rechaza las repetidas.</li></ul></div>

<div class="block"><h3><span class="n">7</span> Cierre <span class="t">30 S</span></h3>
<p class="say">“Después de la ronda 10 aparece el podio con los puntos y los aciertos de cada equipo. ¡A jugar!”</p></div>

<div class="page-break"></div>
<h2 class="section">La ruleta y sus segmentos</h2>
<p class="lead">Orden de los segmentos al empezar la partida, en el sentido de las agujas del reloj desde la aguja.</p>
<div class="wheel-row"><img src="${wheelSrc}" alt="Ruleta"><ul class="legend">${legend}</ul></div>
<div class="block"><h3>Clave rápida de respuestas</h3>
<ul class="key">${wheel.map((s, i) => {
    if (s.c === 'BONUS') return `<li><b>${String(i + 1).padStart(2, '0')}</b>BONUS · +${R.CONFIG.BONUS_POINTS} a todos</li>`;
    const q = R.QUESTIONS.find((x) => x.id === s.q);
    return `<li><b>${String(i + 1).padStart(2, '0')}</b>${esc(cat(s.c).name)} · P${q.id} → <b style="width:auto">${tag(q, q.correctAnswer)}</b></li>`;
  }).join('')}</ul></div>

<div class="page-break"></div>
<h2 class="section">Todas las preguntas, segmento por segmento</h2>
<p class="lead">La respuesta correcta está resaltada en verde.</p>
${questionsHtml()}
</body></html>`;
}

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME });
  const src = await wheelImage(browser);
  const page = await (await browser.newContext()).newPage();
  await page.setContent(html(src), { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  const montserrat = await page.evaluate(() => document.fonts.check('700 12px Montserrat'));
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  await page.pdf({ path: OUT, format: 'A4', printBackground: true, margin: { top: '18mm', bottom: '18mm', left: '17mm', right: '17mm' },
    displayHeaderFooter: true, headerTemplate: '<span></span>',
    footerTemplate: '<div style="width:100%;font:8px Montserrat,sans-serif;color:#8aa09c;text-align:center">Ruleta Ambiental · <span class="pageNumber"></span>/<span class="totalPages"></span></div>' });
  await browser.close();
  console.log('PDF:', OUT, '| Montserrat cargada:', montserrat);
})().catch((e) => { console.error(e); process.exit(1); });
