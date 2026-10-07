/* Interfaz y flujo de la aplicación. Pinta el estado público; nunca decide reglas del juego. */
(function (R) {
  'use strict';

  const P = R.PHASES;
  const CFG = R.CONFIG;
  const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];
  const TEAM_ICONS = ['🌱', '♻️', '🌎', '🌿', '💧', '🌳', '☀️', '🍃'];
  const SESSION_KEY = 'ruleta-team-session';

  const $ = function (id) { return document.getElementById(id); };
  const esc = function (s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  const catById = function (id) { return R.CATEGORIES.find(function (c) { return c.id === id; }); };

  const transport = new R.LocalTransport(CFG.CHANNEL_NAME);
  const app = { role: null, host: null, client: null, state: null, wheel: null, questionKey: '', sb: false };
  const SB_SESSION_KEY = 'ruleta-sb-team';

  /* ---------- Navegación ---------- */
  function show(id) {
    document.querySelectorAll('.screen').forEach(function (s) { s.classList.toggle('hidden', s.id !== id); });
  }

  function myTeamId() { return app.role === 'team' ? app.client.teamId : null; }
  function nowMs() { return (app.role === 'team' ? app.client : app.host).hostNow(); }

  function storage(fn) { try { return fn(); } catch (e) { return null; } }

  /* Sesión del equipo: en Supabase se guarda en localStorage (sobrevive al cierre del navegador del teléfono). */
  const session = {
    save: function (obj) {
      obj.ts = Date.now();
      storage(function () { (app.sb ? localStorage : sessionStorage).setItem(app.sb ? SB_SESSION_KEY : SESSION_KEY, JSON.stringify(obj)); });
    },
    load: function () {
      const v = storage(function () { return JSON.parse((app.sb ? localStorage : sessionStorage).getItem(app.sb ? SB_SESSION_KEY : SESSION_KEY)); });
      return v && Date.now() - (v.ts || 0) < 12 * 3600 * 1000 ? v : null;
    },
    clear: function () {
      storage(function () { localStorage.removeItem(SB_SESSION_KEY); sessionStorage.removeItem(SESSION_KEY); });
    }
  };

  /* ---------- Enrutador por fase ---------- */
  function onState(s) {
    if (!s) return;
    app.state = s;
    if (s.phase === P.LOBBY) {
      if (app.role === 'host') { show('screen-host-lobby'); renderHostLobby(s); }
      else { show('screen-team-lobby'); renderTeamLobby(s); }
      return;
    }
    show('screen-game');
    renderGame(s);
  }

  /* ---------- Salas ---------- */
  function teamsListHtml(s, withMe) {
    if (!s.teams.length) return '<li class="team-empty">Aún no hay equipos conectados…</li>';
    const me = myTeamId();
    return s.teams.map(function (t, i) {
      return '<li class="team-chip' + (withMe && t.id === me ? ' is-me' : '') + '">' +
        '<span class="team-icon">' + TEAM_ICONS[i % TEAM_ICONS.length] + '</span>' +
        '<span class="team-name">' + esc(t.name) + (t.isBot ? ' <small>(demo)</small>' : '') + '</span>' +
        '<span class="dot ' + (t.connected ? 'on' : 'off') + '" title="' + (t.connected ? 'Conectado' : 'Sin conexión') + '"></span></li>';
    }).join('');
  }

  function renderHostLobby(s) {
    $('host-code').textContent = s.roomCode;
    $('host-count').textContent = s.teams.length;
    $('host-teams').innerHTML = teamsListHtml(s, false);
    $('btn-start').disabled = s.teams.length < 1;
    $('btn-demo').disabled = s.teams.some(function (t) { return t.isBot; });
  }

  function renderTeamLobby(s) {
    const me = s.teams.find(function (t) { return t.id === myTeamId(); });
    $('tl-code').textContent = s.roomCode;
    $('tl-team').textContent = me ? me.name : app.client.name;
    $('tl-teams').innerHTML = teamsListHtml(s, true);
  }

  /* ---------- Pantalla de juego ---------- */
  const STAGES = ['stage-wheel', 'stage-question', 'stage-results', 'stage-leaderboard', 'stage-gameover'];

  function stageForPhase(phase) {
    switch (phase) {
      case P.QUESTION_ACTIVE: case P.ANSWER_LOCKED: return 'stage-question';
      case P.RESULTS: return 'stage-results';
      case P.LEADERBOARD: return 'stage-leaderboard';
      case P.GAME_OVER: return 'stage-gameover';
      default: return 'stage-wheel';
    }
  }

  function renderGame(s) {
    $('g-round').textContent = s.phase === P.GAME_OVER ? 'Final' : s.currentRound + ' / ' + s.totalRounds;
    if (app.role === 'team') {
      const me = s.teams.find(function (t) { return t.id === myTeamId(); });
      $('g-right').innerHTML = '<span class="score-pill">' + esc(me ? me.name : '') + ' · <b>' + (me ? me.score : 0) + ' pts</b></span>';
    } else {
      $('g-right').innerHTML = '<span class="score-pill">SALA <b>' + esc(s.roomCode) + '</b></span>';
    }

    const active = stageForPhase(s.phase);
    STAGES.forEach(function (id) { $(id).classList.toggle('hidden', id !== active); });

    if (active === 'stage-wheel') renderWheelStage(s);
    else if (active === 'stage-question') renderQuestionStage(s);
    else if (active === 'stage-results') renderResultsStage(s);
    else if (active === 'stage-leaderboard') renderLeaderboardStage(s);
    else renderGameOver(s);

    renderHostActions(s);
  }

  function renderWheelStage(s) {
    app.wheel.sync(s);
    const status = $('wheel-status');
    const reveal = $('category-reveal');
    reveal.classList.add('hidden');
    if (s.phase === P.WAITING) {
      status.textContent = app.role === 'host' ? 'Gira la ruleta para elegir el tema de la ronda.' : 'Esperando al anfitrión…';
    } else if (s.phase === P.SPINNING) {
      status.textContent = '🌎 RULETA GIRANDO...';
    } else if (s.phase === P.CATEGORY_SELECTED) {
      const cat = catById(s.currentCategory);
      status.textContent = '';
      reveal.classList.remove('hidden');
      reveal.style.setProperty('--cat', cat.color);
      reveal.innerHTML = '<span class="eyebrow">CATEGORÍA SELECCIONADA</span>' +
        '<span class="cat-name">' + cat.emoji + ' ' + esc(cat.name) + '</span>' +
        '<span class="cat-topic">' + esc(cat.topic) + '</span>';
    }
  }

  function renderQuestionStage(s) {
    const q = s.question;
    const cat = catById(s.currentCategory);
    const mine = app.role === 'team' && app.client.myAnswer ? app.client.myAnswer.index : null;
    const locked = s.phase === P.ANSWER_LOCKED;

    // Reconstruye solo cuando cambia algo relevante (evita parpadeos al llegar el estado de otros equipos)
    const key = [s.currentRound, s.phase, mine].join('|');
    if (key !== app.questionKey) {
      app.questionKey = key;
      const interactive = app.role === 'team' && mine === null && !locked;
      const options = q.options.map(function (opt, i) {
        return '<button type="button" class="option' + (mine === i ? ' is-selected' : '') + '" data-index="' + i + '"' +
          (interactive ? '' : ' disabled') + '><span class="letter">' + LETTERS[i] + '</span><span class="opt-text">' + esc(opt) + '</span></button>';
      }).join('');

      let status = '';
      if (app.role === 'team') {
        if (mine !== null) status = '<div class="answer-status ok">✓ RESPUESTA REGISTRADA</div>';
        else if (locked) status = '<div class="answer-status late">⏱ Tiempo agotado · sin respuesta</div>';
        else status = '<div class="answer-status">Elige una opción. Solo puedes responder una vez.</div>';
      } else {
        status = '<div class="answer-status" id="answer-count"></div>';
      }

      $('stage-question').innerHTML =
        '<div class="q-card" style="--cat:' + cat.color + '">' +
          '<div class="q-top">' +
            '<div><span class="cat-badge">' + cat.emoji + ' ' + esc(cat.name) + '</span>' +
            '<span class="type-tag">' + esc(R.QUESTION_TYPES[q.type] || '') + '</span></div>' +
            '<div class="timer" id="timer"><svg viewBox="0 0 44 44" aria-hidden="true"><circle class="bg" cx="22" cy="22" r="19"/>' +
            '<circle class="fg" id="timer-ring" cx="22" cy="22" r="19"/></svg><span id="timer-num" aria-live="off">20</span></div>' +
          '</div>' +
          (q.context ? '<p class="q-context">' + esc(q.context) + '</p>' : '') +
          '<h2 class="q-text">' + esc(q.question) + '</h2>' +
          '<div class="options">' + options + '</div>' + status +
        '</div>';
    }

    if (app.role === 'host') {
      const el = $('answer-count');
      if (el) el.textContent = locked ? 'Respuestas cerradas' : 'Respuestas recibidas: ' + s.answeredCount + ' / ' + s.teams.length;
    }
    tick();
  }

  function rankRows(rows, valueOf) {
    let prev = null, rank = 0;
    return rows.map(function (r, i) {
      const v = valueOf(r);
      if (prev === null || v !== prev) rank = i + 1;
      prev = v;
      return { row: r, rank: rank };
    });
  }

  function medal(rank, value) {
    if (value <= 0) return '·';
    return rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : '🌱';
  }

  function renderResultsStage(s) {
    const res = s.results;
    if (!res) return;
    const q = s.question;
    const me = myTeamId();
    let banner = '';
    if (me) {
      const mineRow = res.rows.find(function (r) { return r.teamId === me; });
      if (mineRow) {
        if (mineRow.correct) banner = '<div class="my-result good">✓ ¡Correcto! <b>+' + mineRow.points + ' pts</b></div>';
        else if (mineRow.answerIndex === null) banner = '<div class="my-result none">⏱ Sin respuesta · 0 pts</div>';
        else banner = '<div class="my-result bad">✗ Respuesta incorrecta · 0 pts</div>';
      }
    }

    const ranked = rankRows(res.rows, function (r) { return r.points; });
    const list = ranked.map(function (x) {
      const r = x.row;
      let detail;
      if (r.answerIndex === null) detail = 'Sin respuesta';
      else if (r.correct) detail = '✓ ' + LETTERS[r.answerIndex] + ' · ' + r.responseTime.toFixed(1) + ' s';
      else detail = '✗ ' + LETTERS[r.answerIndex];
      return '<li class="rank-row' + (r.teamId === me ? ' is-me' : '') + (r.correct ? ' correct' : '') + '">' +
        '<span class="medal">' + medal(x.rank, r.points) + '</span>' +
        '<span class="rname">' + esc(r.name) + '<small>' + detail + '</small></span>' +
        '<span class="rpts">' + r.points + ' pts</span></li>';
    }).join('');

    $('stage-results').innerHTML =
      '<h2 class="section-title">RESULTADOS</h2>' + banner +
      '<div class="correct-box"><span class="eyebrow">Respuesta correcta</span>' +
      '<span class="correct-text"><b>' + LETTERS[res.correctAnswer] + '.</b> ' + esc(q.options[res.correctAnswer]) + '</span>' +
      (res.explanation ? '<span class="explain">' + esc(res.explanation) + '</span>' : '') + '</div>' +
      '<h3 class="sub-title">PUNTOS DE LA RONDA</h3><ol class="rank-list">' + list + '</ol>';
  }

  function sortedByScore(s) {
    return s.teams.slice().sort(function (a, b) { return b.score - a.score; });
  }

  function renderLeaderboardStage(s) {
    const me = myTeamId();
    const ranked = rankRows(sortedByScore(s), function (t) { return t.score; });
    const rows = ranked.map(function (x) {
      const t = x.row;
      return '<tr class="' + (t.id === me ? 'is-me' : '') + '"><td class="pos">' + (x.rank <= 3 ? medal(x.rank, 1) : x.rank) + '</td>' +
        '<td>' + esc(t.name) + '</td><td class="gain">' + (t.roundPoints ? '+' + t.roundPoints : '') + '</td>' +
        '<td class="pts">' + t.score + '</td></tr>';
    }).join('');
    $('stage-leaderboard').innerHTML =
      '<h2 class="section-title">🏆 MARCADOR</h2>' +
      '<table class="board"><thead><tr><th>Pos.</th><th>Equipo</th><th>Ronda</th><th>Puntos</th></tr></thead><tbody>' + rows + '</tbody></table>';
  }

  function renderGameOver(s) {
    const sorted = sortedByScore(s);
    const top = sorted.length ? sorted[0].score : 0;
    const winners = sorted.filter(function (t) { return t.score === top; });
    const ranked = rankRows(sorted, function (t) { return t.score; });
    const list = ranked.map(function (x) {
      return '<li class="rank-row' + (x.row.id === myTeamId() ? ' is-me' : '') + '"><span class="medal">' + (x.rank <= 3 ? medal(x.rank, 1) : x.rank) + '</span>' +
        '<span class="rname">' + esc(x.row.name) + '</span><span class="rpts">' + x.row.score + '</span></li>';
    }).join('');
    $('stage-gameover').innerHTML =
      '<div class="winner-card"><div class="trophy">🏆</div><h2 class="section-title">¡PARTIDA TERMINADA!</h2>' +
      '<span class="eyebrow">' + (winners.length > 1 ? 'EMPATE EN EL PRIMER LUGAR' : 'GANADOR') + '</span>' +
      '<div class="winner-name">🥇 ' + winners.map(function (w) { return esc(w.name); }).join(' · ') + '</div>' +
      '<div class="winner-score">' + top + ' PUNTOS</div></div>' +
      '<h3 class="sub-title">CLASIFICACIÓN FINAL</h3><ol class="rank-list">' + list + '</ol>';
  }

  /* ---------- Controles del anfitrión (solo los que corresponden a la fase) ---------- */
  function renderHostActions(s) {
    const bar = $('host-actions');
    if (app.role === 'host') {
      let html = '';
      switch (s.phase) {
        case P.WAITING: html = '<button class="btn btn-primary btn-xl" data-action="spin">🎯 GIRAR RULETA</button>'; break;
        case P.CATEGORY_SELECTED: html = '<button class="btn btn-primary btn-xl" data-action="show">▶ MOSTRAR PREGUNTA</button>'; break;
        case P.QUESTION_ACTIVE: html = '<button class="btn btn-warn btn-xl" data-action="close">⏹ CERRAR RESPUESTAS</button>'; break;
        case P.RESULTS: html = '<button class="btn btn-primary btn-xl" data-action="board">🏆 VER MARCADOR</button>'; break;
        case P.LEADERBOARD:
          html = '<button class="btn btn-primary btn-xl" data-action="next">' +
            (s.currentRound >= s.totalRounds ? '🏁 FINALIZAR PARTIDA' : 'SIGUIENTE RONDA →') + '</button>';
          break;
        case P.GAME_OVER: html = '<button class="btn btn-ghost btn-xl" data-action="restart">NUEVA PARTIDA</button>'; break;
      }
      bar.innerHTML = html;
    } else {
      bar.innerHTML = s.phase === P.GAME_OVER ? '<button class="btn btn-ghost btn-xl" data-action="leave">Salir</button>' : '';
    }
    bar.classList.toggle('hidden', !bar.innerHTML);
  }

  /* ---------- Temporizador visual ---------- */
  const RING_LEN = 2 * Math.PI * 19;
  function tick() {
    const s = app.state;
    const num = $('timer-num');
    if (!s || !num || !$('timer-ring')) return;
    let remaining = 0;
    if (s.phase === P.QUESTION_ACTIVE && s.questionDeadline) {
      remaining = Math.max(0, (s.questionDeadline - nowMs()) / 1000);
    }
    num.textContent = Math.ceil(remaining);
    const ring = $('timer-ring');
    ring.style.strokeDasharray = RING_LEN;
    const total = s.questionStartedAt && s.questionDeadline ? (s.questionDeadline - s.questionStartedAt) / 1000 : CFG.QUESTION_TIME;
    ring.style.strokeDashoffset = RING_LEN * (1 - remaining / total);
    if (s.phase === P.QUESTION_ACTIVE && remaining <= 0) {   // al llegar a 0 la pregunta se bloquea sin esperar al servidor
      document.querySelectorAll('#stage-question .option').forEach(function (b) { b.disabled = true; });
    }
    const timer = $('timer');
    timer.classList.toggle('warn', remaining <= 10 && remaining > 5);
    timer.classList.toggle('danger', remaining <= 5);
  }

  /* ---------- Eventos ---------- */
  function wireBackend(b) {
    b.onNotice = showToast;
    b.onStatus = function (st) { $('conn-banner').classList.toggle('hidden', st === 'online'); };
    b.onClosed = function () {
      session.clear();
      storage(function () { localStorage.removeItem('ruleta-sb-host-room'); });
      alert('La sala fue cerrada.');
      location.reload();
    };
  }

  async function createRoom() {
    app.role = 'host';
    if (app.sb) {
      const btn = $('btn-create');
      btn.disabled = true;
      app.host = new R.SbHost(CFG.TOTAL_ROUNDS);
      wireBackend(app.host);
      try {
        await app.host.create();
      } catch (e) {
        app.role = null; app.host = null;
        showToast(e.message || 'No se pudo crear la sala.');
        btn.disabled = false;
        return;
      }
      app.host.subscribe(onState);
      return;
    }
    app.host = new R.HostGame(transport, CFG.TOTAL_ROUNDS);
    app.host.subscribe(onState);
    app.host.publish();
  }

  async function resumeHost() {
    const host = new R.SbHost(CFG.TOTAL_ROUNDS);
    wireBackend(host);
    try {
      if (await host.resume()) { app.role = 'host'; app.host = host; host.subscribe(onState); return true; }
    } catch (e) { /* sin conexión: se queda en el inicio */ }
    return false;
  }

  function normalizeCode(v) {
    let c = String(v).toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (c.indexOf('ECO') === 0) c = c.slice(3);
    return 'ECO-' + c;
  }

  function newTeamId() {
    return 't-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  async function joinRoom(code, name, teamId, silent) {
    const client = app.sb ? new R.SbClient(code, name) : new R.ClientGame(transport, code, teamId, name);
    client.onNotice = function (msg) { showToast(msg); };
    if (app.sb) wireBackend(client);
    const res = await client.join();
    if (!res.ok) { if (!silent) showJoinError(res.error); return false; }
    app.role = 'team';
    app.client = client;
    client.subscribe(onState);
    client.startHeartbeat();
    session.save({ room: code, teamId: client.teamId, name: client.name });
    if (!app.state) {
      show('screen-team-lobby');
      $('tl-code').textContent = code;
      $('tl-team').textContent = client.name;
    }
    return true;
  }

  function showJoinError(msg) {
    const el = $('join-error');
    el.textContent = msg || '';
    el.classList.toggle('hidden', !msg);
  }

  let toastTimer = null;
  function showToast(msg) {
    const el = $('toast');
    el.textContent = msg;
    el.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.add('hidden'); }, 3500);
  }

  function bindEvents() {
    $('btn-create').addEventListener('click', createRoom);
    $('btn-join').addEventListener('click', function () { showJoinError(''); show('screen-join'); $('join-code').focus(); });
    $('btn-join-back').addEventListener('click', function () { show('screen-home'); });

    $('join-form').addEventListener('submit', async function (e) {
      e.preventDefault();
      showJoinError('');
      const code = normalizeCode($('join-code').value);
      const name = R.normalizeName($('join-name').value);
      if (code.length !== 7) return showJoinError('El código tiene el formato ECO-XXX.');
      const err = R.validateTeamName(name, [], null);
      if (err) return showJoinError(err);
      const btn = $('join-submit');
      btn.disabled = true; btn.textContent = 'Conectando…';
      await joinRoom(code, name, newTeamId(), false);
      btn.disabled = false; btn.textContent = 'ENTRAR A LA SALA';
    });

    document.querySelectorAll('[data-exit]').forEach(function (b) {
      b.addEventListener('click', function () {
        const st = app.state;
        const inGame = st && st.phase !== P.LOBBY && st.phase !== P.GAME_OVER;
        if (inGame && !confirm(app.role === 'host' ? '¿Salir? Se perderá la partida en curso.' : '¿Salir de la partida? Tu equipo quedará fuera.')) return;
        const done = function () { session.clear(); location.reload(); };
        if (app.sb && app.role === 'host') return app.host.close().then(done, done);
        if (app.sb && app.role === 'team') return app.client.leave().then(done, done);
        if (app.role === 'team') transport.send({ type: 'LEAVE', room: app.client.room, teamId: app.client.teamId });
        done();
      });
    });

    $('btn-demo').addEventListener('click', function () { app.host.addDemoTeams(); });
    $('btn-start').addEventListener('click', function () { app.host.startGame(); });

    $('host-actions').addEventListener('click', function (e) {
      const b = e.target.closest('[data-action]');
      if (!b) return;
      const h = app.host;
      switch (b.dataset.action) {
        case 'spin': h.spin(); break;
        case 'show': h.showQuestion(); break;
        case 'close': h.closeAnswers(); break;
        case 'board': h.showLeaderboard(); break;
        case 'next': h.nextRound(); break;
        case 'restart':
        case 'leave': {
          const done = function () { session.clear(); location.reload(); };
          if (app.sb && app.role === 'host') app.host.close().then(done, done);
          else if (app.sb && app.role === 'team') app.client.leave().then(done, done);
          else done();
          break;
        }
      }
    });

    $('stage-question').addEventListener('click', function (e) {
      const b = e.target.closest('.option[data-index]');
      if (!b || b.disabled || app.role !== 'team') return;
      app.client.submitAnswer(parseInt(b.dataset.index, 10));
    });
  }

  function buildBackground() {
    const bg = $('bg');
    for (let i = 0; i < 16; i++) {
      const p = document.createElement('span');
      p.className = 'particle';
      p.style.left = (Math.random() * 100) + '%';
      p.style.width = p.style.height = (6 + Math.random() * 14) + 'px';
      p.style.animationDuration = (14 + Math.random() * 18) + 's';
      p.style.animationDelay = (-Math.random() * 30) + 's';
      bg.appendChild(p);
    }
  }

  /* Indicadores de modo y restricción de anfitrión a computador. */
  function setupHome() {
    const mode = $('mode-badge');
    if (!app.sb) {
      mode.classList.remove('hidden');
      mode.textContent = R.SUPABASE && R.SUPABASE.url
        ? '⚠ No se pudo cargar Supabase. Modo local de prueba.'
        : 'Modo local de prueba (sin Supabase): solo funciona entre pestañas de este navegador.';
    } else {
      $('btn-demo').classList.add('hidden');
    }
    if (window.matchMedia && window.matchMedia('(hover: none) and (pointer: coarse)').matches) {
      $('btn-create').disabled = true;
      $('btn-create').querySelector('small').textContent = 'Disponible solo en computador';
    }
  }

  function init() {
    buildBackground();
    app.wheel = new R.Wheel($('wheel-canvas'), $('wheel-rotor'));
    bindEvents();
    setInterval(tick, 100);

    app.sb = R.sbEnabled();
    setupHome();

    // Recuperación de sesión tras recargar la página (anfitrión o equipo)
    (async function () {
      if (app.sb && await resumeHost()) return;
      const saved = session.load();
      if (saved && saved.room && saved.name) {
        const ok = await joinRoom(saved.room, saved.name, saved.teamId, true);
        if (!ok) session.clear();
      }
    })();
  }

  document.addEventListener('DOMContentLoaded', init);
})(window.Ruleta = window.Ruleta || {});
