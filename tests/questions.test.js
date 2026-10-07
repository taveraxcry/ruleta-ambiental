/* Verifica las 20 preguntas definitivas contra la lista entregada por el equipo docente y las juega todas
   en el motor real del juego: la opción correcta suma puntos y cuenta como acierto; cualquier otra da 0. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

global.window = {};
for (const f of ['config', 'scoring', 'questions', 'state', 'host']) eval(fs.readFileSync(path.join(__dirname, '../js/' + f + '.js'), 'utf8'));
const R = window.Ruleta;
R.CONFIG.SPIN_DURATION_MS = 5;   // giro instantáneo para la prueba
R.CONFIG.RESULTS_DELAY_MS = 5;

// Lista oficial (Fase 3): id → [categoría, tipo, respuesta correcta]
const OFFICIAL = {
  1: ['BRUNDTLAND', 'multiple_choice', 'D'], 2: ['BRUNDTLAND', 'true_false', 'V'],
  3: ['KYOTO', 'multiple_choice', 'C'], 4: ['KYOTO', 'multiple_choice', 'A'],
  5: ['PARIS', 'multiple_choice', 'D'], 6: ['PARIS', 'true_false', 'V'],
  7: ['CITES', 'multiple_choice', 'B'], 8: ['CITES', 'error_identification', 'C'],
  9: ['RAMSAR', 'multiple_choice', 'A'], 10: ['RAMSAR', 'true_false', 'F'],
  11: ['BASILEA', 'multiple_choice', 'D'], 12: ['BASILEA', 'error_identification', 'C'],
  13: ['GINEBRA', 'true_false', 'V'],
  14: ['GOTHENBURG', 'multiple_choice', 'C'], 15: ['GOTHENBURG', 'true_false', 'F'],
  16: ['ESCAZU', 'multiple_choice', 'D'],
  17: ['EPI', 'multiple_choice', 'B'], 18: ['EPI', 'true_false', 'V'],
  19: ['INTEGRADORA', 'multiple_choice', 'A'], 20: ['INTEGRADORA', 'error_identification', 'D']
};
const letterIndex = (q, l) => (q.type === 'true_false' ? (l === 'V' ? 0 : 1) : 'ABCD'.indexOf(l));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let ok = 0, bad = 0;
const check = (c, m) => { if (c) { ok++; } else { bad++; console.log('  ✗', m); } };

(async () => {
  console.log('\nContenido de las 20 preguntas');
  check(R.QUESTIONS.length === 20, 'hay 20 preguntas');
  check(new Set(R.QUESTIONS.map((q) => q.id)).size === 20, 'ids únicos');
  for (const q of R.QUESTIONS) {
    const [cat, type, letter] = OFFICIAL[q.id];
    check(q.category === cat, q.id + ': categoría ' + q.category + ' ≠ ' + cat);
    check(q.type === type, q.id + ': tipo ' + q.type + ' ≠ ' + type);
    check(q.correctAnswer === letterIndex(q, letter), q.id + ': respuesta ' + q.correctAnswer + ' ≠ ' + letter);
    check(q.type === 'true_false' ? q.options.join() === 'Verdadero,Falso' : q.options.length === 4, q.id + ': opciones');
    check(q.options.every((o) => o.trim().length > 0) && q.question.trim().length > 10, q.id + ': textos vacíos');
    const cfg = R.CATEGORIES.find((c) => c.id === q.category);
    check(cfg && cfg.enabled, q.id + ': su categoría está en la ruleta');
  }
  console.log('  ' + ok + ' comprobaciones de contenido' + (bad ? ' — ' + bad + ' FALLOS' : ' correctas'));

  console.log('\nLas 20 preguntas jugadas en el motor del juego');
  const host = new R.HostGame({ send() {}, on() {} }, 40);
  host.addTeam('ok', 'Equipo Correcto', false);
  host.addTeam('no', 'Equipo Incorrecto', false);
  host.addTeam('nada', 'Equipo Sin Respuesta', false);
  host.startGame();
  const wheel0 = host.state.wheel.length;
  check(wheel0 === 23, 'la ruleta empieza con 23 segmentos (20 preguntas + 3 BONUS)');
  const lines = [];
  for (const q of R.QUESTIONS.slice().sort((a, b) => a.id - b.id)) {
    const before = { ok: host.findTeam('ok').score, no: host.findTeam('no').score, nada: host.findTeam('nada').score };
    R.DEBUG_FORCE_QUESTION = q.id;
    host.spin();
    await sleep(450);   // el motor espera la animación + 400 ms
    check(host.state.phase === 'CATEGORY_SELECTED' && host.state.currentQuestion.id === q.id, q.id + ': la ruleta selecciona la pregunta');
    check(host.state.currentCategory === q.category, q.id + ': la categoría anunciada es la de la pregunta');
    host.showQuestion();
    const r1 = host.submitAnswer('ok', q.correctAnswer);
    const r2 = host.submitAnswer('no', (q.correctAnswer + 1) % q.options.length);
    const r3 = host.submitAnswer('ok', (q.correctAnswer + 1) % q.options.length);
    check(r1.ok && r2.ok && !r3.ok, q.id + ': una respuesta por equipo');
    host.closeAnswers();
    await sleep(30);
    const d = { ok: host.findTeam('ok').score - before.ok, no: host.findTeam('no').score - before.no, nada: host.findTeam('nada').score - before.nada };
    check(d.ok === 100 && d.no === 0 && d.nada === 0, q.id + ': puntos ' + JSON.stringify(d));
    check(!host.state.wheel.some((s) => s.q === q.id), q.id + ': su segmento desaparece de la ruleta');
    const fine = d.ok === 100 && d.no === 0 && d.nada === 0;
    lines.push((fine ? '✓ ' : '✗ ') + String(q.id).padStart(2) + ' ' + q.category.padEnd(11) + ' ' + OFFICIAL[q.id][2] + ' → correcta +' + d.ok + ', incorrecta +' + d.no + ', sin responder +' + d.nada);
  }
  console.log(lines.map((l) => '  ✓ ' + l).join('\n'));
  check(host.findTeam('ok').correct === 20 && host.findTeam('no').correct === 0, 'aciertos: 20 y 0');
  check(host.state.wheel.length === 3 && host.state.wheel.every((s) => s.c === 'BONUS'), 'tras las 20 preguntas solo quedan los 3 BONUS');

  console.log('\nBONUS');
  for (let i = 0; i < 3; i++) {
    const before = host.findTeam('nada').score;
    host.spin(); await sleep(450);
    check(host.state.currentCategory === 'BONUS', 'sale BONUS');
    host.showQuestion();
    check(host.state.phase === 'CATEGORY_SELECTED', 'un BONUS no muestra pregunta');
    host.applyBonus();
    check(host.findTeam('nada').score - before === 5, 'BONUS suma 5 a todos');
  }
  check(host.state.wheel.length === 0, 'cada BONUS sale una sola vez');
  if (host.state.wheel.length === 0) console.log('  ✓ los 3 BONUS: sin pregunta, +5 a todos los equipos, cada uno desaparece al usarse');

  console.log(`\n${ok}/${ok + bad} comprobaciones correctas${bad ? ' — HAY FALLOS' : ''}`);
  process.exit(bad ? 1 : 0);
})();
