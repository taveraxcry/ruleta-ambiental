/* Interfaz y flujo de la aplicación. Pinta el estado público; nunca decide reglas del juego.
   Roles: 'host' (anfitrión), 'team' (equipo) y 'preview' (un solo computador: controla y responde
   con datos simulados, sin Supabase ni salas reales). */
(function (R) {
  'use strict';

  const P = R.PHASES;
  const CFG = R.CONFIG;
  const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];
  const AVATAR_COLORS = ['#5ef0bd', '#47c8f5', '#f1c68a', '#b49cff', '#8be07a', '#ff9f8a', '#7fe3ff', '#ffd66b'];
  const SESSION_KEY = 'ruleta-team-session';
  const SB_SESSION_KEY = 'ruleta-sb-team';
  const PREVIEW_ID = 'preview-me';

  const $ = function (id) { return document.getElementById(id); };
  const esc = function (s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  const icon = function (id, cls) { return '<svg' + (cls ? ' class="' + cls + '"' : '') + ' aria-hidden="true"><use href="#' + id + '"/></svg>'; };
  const catById = function (id) { return R.CATEGORIES.find(function (c) { return c.id === id; }) || { id: id, name: id, color: '#2fd4c0', topic: '' }; };

  const transport = new R.LocalTransport(CFG.CHANNEL_NAME);
  const app = { role: null, host: null, client: null, state: null, wheel: null, questionKey: '', revealKey: '', lastStage: '', sb: false };

  /* ---------- Roles ---------- */
  const isHostView = function () { return app.role === 'host' || app.role === 'preview'; };
  const canAnswer = function () { return app.role === 'team' || app.role === 'preview'; };
  function myTeamId() {
    if (app.role === 'team') return app.client.teamId;
    if (app.role === 'preview') return PREVIEW_ID;
    return null;
  }
  function nowMs() { return (app.role === 'team' ? app.client : app.host).hostNow(); }
  function myAnswer() { return canAnswer() && app.client && app.client.myAnswer ? app.client.myAnswer.index : null; }

  /* ---------- Navegación ---------- */
  function show(id) {
    document.querySelectorAll('.screen').forEach(function (s) { s.classList.toggle('hidden', s.id !== id); });
  }

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

  /* El banco con respuestas solo se descarga en Preview o en modo local, nunca en una partida con Supabase. */
  function loadQuestions() {
    if (R.QUESTIONS) return Promise.resolve();
    return new Promise(function (resolve, reject) {
      const s = document.createElement('script');
      s.src = 'js/questions.js';
      s.onload = function () { R.QUESTIONS ? resolve() : reject(new Error('Banco de preguntas vacío')); };
      s.onerror = function () { reject(new Error('No se pudo cargar el banco de preguntas')); };
      document.head.appendChild(s);
    });
  }

  /* ---------- Enrutador por fase ---------- */
  function onState(s) {
    if (!s) return;
    app.state = s;
    if (app.role === 'preview' && app.client.myAnswer && app.client.myAnswer.round !== s.currentRound) app.client.myAnswer = null;
    if (s.phase === P.LOBBY) {
      if (app.role === 'host') { show('screen-host-lobby'); renderHostLobby(s); }
      else if (app.role === 'team') { show('screen-team-lobby'); renderTeamLobby(s); }
      return;
    }
    show('screen-game');
    renderGame(s);
  }

  /* ---------- Salas ---------- */
  function initials(name) {
    const w = String(name).trim().split(/\s+/);
    return ((w[0] || '')[0] + ((w[1] || '')[0] || '')).toUpperCase();
  }

  function teamsListHtml(s, withMe) {
    if (!s.teams.length) return '<li class="team-empty">Aún no hay equipos conectados…</li>';
    const me = myTeamId();
    return s.teams.map(function (t, i) {
      return '<li class="team-chip' + (withMe && t.id === me ? ' is-me' : '') + '">' +
        '<span class="team-avatar" style="background:' + AVATAR_COLORS[i % AVATAR_COLORS.length] + '">' + esc(initials(t.name)) + '</span>' +
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
    const over = s.phase === P.GAME_OVER;
    $('g-round-label').textContent = over ? 'PARTIDA' : 'RONDA';
    $('g-round').textContent = over ? 'Finalizada' : s.currentRound + ' / ' + s.totalRounds;
    $('wheel-round').textContent = 'RONDA ' + s.currentRound + ' DE ' + s.totalRounds;
    const done = over ? 1 : (s.currentRound - (s.phase === P.RESULTS || s.phase === P.LEADERBOARD ? 0 : 1)) / s.totalRounds;
    $('g-progress').style.width = Math.round(done * 100) + '%';
    if (canAnswer()) {
      const me = s.teams.find(function (t) { return t.id === myTeamId(); });
      $('g-right').innerHTML = '<span class="score-pill"><span class="sp-name">' + esc(me ? me.name : '') + '</span><b>' + (me ? me.score : 0) + ' pts</b></span>';
    } else {
      $('g-right').innerHTML = '<span class="score-pill">SALA <b>' + esc(s.roomCode) + '</b></span>';
    }

    const active = stageForPhase(s.phase);
    STAGES.forEach(function (id) { $(id).classList.toggle('hidden', id !== active); });
    if (active !== app.lastStage) {
      const el = $(active);
      el.classList.remove('stage-in'); void el.offsetWidth; el.classList.add('stage-in');
      app.lastStage = active;
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    if (active === 'stage-wheel') renderWheelStage(s);
    else if (active === 'stage-question') renderQuestionStage(s);
    else if (active === 'stage-results') renderResultsStage(s);
    else if (active === 'stage-leaderboard') renderLeaderboardStage(s);
    else renderGameOver(s);

    renderHostActions(s);
  }

  function renderWheelStage(s) {
    app.wheel.sync(s, nowMs);
    const status = $('wheel-status');
    const reveal = $('category-reveal');
    const landed = s.phase === P.CATEGORY_SELECTED && !app.wheel.anim;
    if (s.phase === P.WAITING) {
      status.innerHTML = isHostView() ? 'Pulsa <b>Girar ruleta</b> para elegir el tema de la ronda.' : 'Esperando a que el anfitrión gire la ruleta…';
    } else if (s.phase === P.SPINNING || (s.phase === P.CATEGORY_SELECTED && !landed)) {
      status.innerHTML = '<span class="spin-label">GIRANDO…</span>';
    } else {
      status.innerHTML = isHostView() ? 'Tema listo. Muestra la pregunta cuando todos estén atentos.' : 'Prepárate: la pregunta aparecerá en un momento.';
    }
    if (!landed) {
      reveal.classList.add('hidden');
      app.revealKey = '';
      return;
    }
    const cat = catById(s.currentCategory);
    const key = s.currentRound + '|' + cat.id;
    if (key !== app.revealKey) {
      app.revealKey = key;
      reveal.style.setProperty('--cat', cat.color);
      reveal.innerHTML = '<span class="eyebrow">CATEGORÍA SELECCIONADA</span>' +
        '<span class="cat-name">' + esc(cat.name) + '</span>' +
        '<span class="cat-topic">' + esc(cat.topic) + '</span>';
      reveal.classList.remove('hidden');
      if (window.innerWidth < 1100) setTimeout(function () { reveal.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, 120);
    }
    reveal.classList.remove('hidden');
  }

  function optionTag(q, i) {
    return q.type === 'true_false' ? (i === 0 ? 'V' : 'F') : LETTERS[i];
  }

  function renderQuestionStage(s) {
    const q = s.question;
    const cat = catById(s.currentCategory);
    const mine = myAnswer();
    const locked = s.phase === P.ANSWER_LOCKED;
    const tf = q.type === 'true_false';

    // Reconstruye solo cuando cambia algo relevante (evita parpadeos al llegar el estado de otros equipos)
    const key = [s.currentRound, s.phase, mine, app.role].join('|');
    if (key !== app.questionKey) {
      app.questionKey = key;
      const interactive = canAnswer() && mine === null && !locked;
      const longest = Math.max.apply(null, q.options.map(function (o) { return o.length; }));
      const gridCls = tf ? 'cols-2 tf-grid' : (longest <= 46 ? 'cols-2' : '');

      const options = q.options.map(function (opt, i) {
        const cls = ['option'];
        if (tf) cls.push('tf');
        if (interactive) cls.push('is-live');
        if (mine === i) cls.push('is-selected');
        else if (mine !== null || locked) cls.push('is-dimmed');
        const inner = '<span class="letter">' + optionTag(q, i) + '</span><span class="opt-text">' + esc(opt) + '</span>' +
          '<span class="opt-check">' + icon('i-check') + '</span>';
        if (!canAnswer()) return '<div class="' + cls.concat('readonly').join(' ') + '" data-index="' + i + '">' + inner + '</div>';
        return '<button type="button" class="' + cls.join(' ') + '" data-index="' + i + '"' +
          (interactive ? '' : ' disabled') + (mine === i ? ' aria-pressed="true"' : '') + '>' + inner + '</button>';
      }).join('');

      let status = '';
      if (canAnswer()) {
        if (mine !== null) status = '<div class="answer-status ok"><span class="as-pill">' + icon('i-check') + 'RESPUESTA REGISTRADA</span></div>';
        else if (locked) status = '<div class="answer-status late">' + icon('i-clock', 'inline') + 'Tiempo agotado · sin respuesta</div>';
        else status = '<div class="answer-status">Elige una opción · solo puedes responder una vez</div>';
      }
      if (isHostView()) {
        status += '<div class="answer-status host-count">' +
          (app.role === 'host' ? '<span class="host-note">' + icon('i-users') + 'Los equipos responden desde sus dispositivos</span>' : '') +
          '<span id="answer-count"></span><span class="hc-bar"><span id="answer-bar"></span></span></div>';
      }

      $('stage-question').innerHTML =
        '<div class="q-card glass" style="--cat:' + cat.color + '">' +
          '<div class="q-top">' +
            '<div class="q-meta"><span class="cat-badge">' + esc(cat.name) + '</span>' +
            '<span class="type-tag">' + esc(R.QUESTION_TYPES[q.type] || '') + '</span></div>' +
            '<div class="timer" id="timer"><svg viewBox="0 0 100 100" aria-hidden="true"><defs><linearGradient id="timer-grad" x1="0" y1="0" x2="1" y2="1">' +
              '<stop offset="0" style="stop-color:var(--tc1)"/><stop offset="1" style="stop-color:var(--tc2)"/></linearGradient></defs>' +
              '<circle class="bg" cx="50" cy="50" r="44"/><circle class="fg" id="timer-ring" cx="50" cy="50" r="44"/></svg>' +
              '<div class="t-num"><span id="timer-num" aria-live="off">' + CFG.QUESTION_TIME + '</span><span class="t-unit">SEG</span></div></div>' +
          '</div>' +
          (q.context ? '<p class="q-context">' + esc(q.context) + '</p>' : '') +
          '<h2 class="q-text">' + esc(q.question) + '</h2>' +
          '<div class="options ' + gridCls + '" role="group" aria-label="Opciones de respuesta">' + options + '</div>' + status +
          '<div class="q-progress" id="q-progress"></div>' +
        '</div>';
      lastTimerNum = null;
    }

    if (isHostView()) {
      const el = $('answer-count');
      if (el) el.textContent = locked ? 'Respuestas cerradas · ' + s.answeredCount + ' / ' + s.teams.length : 'Respuestas recibidas: ' + s.answeredCount + ' / ' + s.teams.length;
      const bar = $('answer-bar');
      if (bar) bar.style.width = (s.teams.length ? Math.round(100 * s.answeredCount / s.teams.length) : 0) + '%';
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

  /* Medalla de posición: oro/plata/bronce solo para quien sumó puntos; sin puntos, un guion. */
  function medalHtml(rank, value) {
    if (value <= 0) return '<span class="medal">–</span>';
    return '<span class="medal' + (rank <= 3 ? ' m' + rank : '') + '">' + rank + '</span>';
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
        if (mineRow.correct) banner = '<div class="my-result good">' + icon('i-check') + '<span>¡Correcto!</span><span class="mr-pts">+' + mineRow.points + '</span><span>pts</span></div>';
        else if (mineRow.answerIndex === null) banner = '<div class="my-result none">' + icon('i-clock') + '<span>Sin respuesta · 0 pts</span></div>';
        else banner = '<div class="my-result bad">' + icon('i-x') + '<span>Respuesta incorrecta (' + optionTag(q, mineRow.answerIndex) + ') · 0 pts</span></div>';
      }
    }

    const ranked = rankRows(res.rows, function (r) { return r.points; });
    const list = ranked.map(function (x, i) {
      const r = x.row;
      let detail;
      if (r.answerIndex === null) detail = 'Sin respuesta';
      else if (r.correct) detail = '<span class="ok">✓ ' + optionTag(q, r.answerIndex) + '</span>· ' + Number(r.responseTime).toFixed(1) + ' s';
      else detail = '<span class="no">✗ ' + optionTag(q, r.answerIndex) + '</span>· incorrecta';
      return '<li class="rank-row' + (r.teamId === me ? ' is-me' : '') + (r.correct ? ' correct' : '') + (r.points ? '' : ' zero') + '" style="--i:' + i + ';--w:' + r.points + '%">' +
        '<span class="bar"></span>' + medalHtml(x.rank, r.points) +
        '<span class="rname">' + esc(r.name) + '<small>' + detail + '</small></span>' +
        '<span class="rpts">' + r.points + '<small>PTS</small></span></li>';
    }).join('');

    $('stage-results').innerHTML =
      '<div class="results-head"><div><span class="eyebrow">Ronda ' + res.round + '</span><h2 class="section-title">RESULTADOS</h2></div></div>' + banner +
      '<div class="correct-box"><span class="cb-icon">' + icon('i-check') + '</span><div><span class="eyebrow">Respuesta correcta</span>' +
      '<span class="correct-text"><b>' + optionTag(q, res.correctAnswer) + '.</b> ' + esc(q.options[res.correctAnswer]) + '</span>' +
      (res.explanation ? '<span class="explain">' + esc(res.explanation) + '</span>' : '') + '</div></div>' +
      '<h3 class="sub-title">PUNTOS DE LA RONDA</h3><ol class="rank-list">' + list + '</ol>';
  }

  function sortedByScore(teams, scoreOf) {
    return teams.slice().sort(function (a, b) { return scoreOf(b) - scoreOf(a); });
  }

  function renderLeaderboardStage(s) {
    const me = myTeamId();
    const score = function (t) { return t.score; };
    const ranked = rankRows(sortedByScore(s.teams, score), score);
    // Posición antes de esta ronda, para mostrar subidas y bajadas
    const before = rankRows(sortedByScore(s.teams, function (t) { return t.score - t.roundPoints; }), function (t) { return t.score - t.roundPoints; });
    const prevRank = {};
    before.forEach(function (x) { prevRank[x.row.id] = x.rank; });
    const max = Math.max(1, ranked.length ? ranked[0].row.score : 1);

    const rows = ranked.map(function (x, i) {
      const t = x.row;
      const moved = s.currentRound > 1 ? prevRank[t.id] - x.rank : 0;
      const move = moved > 0 ? '<span class="move up">▲' + moved + '</span>' : moved < 0 ? '<span class="move down">▼' + (-moved) + '</span>' : '';
      const gain = t.roundPoints ? '+' + t.roundPoints : '';
      return '<tr class="' + (t.id === me ? 'is-me' : '') + '" style="--i:' + i + '" data-row="' + esc([x.rank, t.name, gain, t.score].join('|')) + '"><td class="pos">' + medalHtml(x.rank, t.score) + '</td>' +
        '<td><div class="tname"><span>' + esc(t.name) + move + (gain ? '<em class="gain-inline">' + gain + '</em>' : '') + '</span>' +
        '<span class="tbar"><i style="--w:' + Math.round(100 * t.score / max) + '%"></i></span></div></td>' +
        '<td class="gain r gain-col">' + (t.roundPoints ? '+' + t.roundPoints : '') + '</td>' +
        '<td class="pts r">' + t.score + '</td></tr>';
    }).join('');
    $('stage-leaderboard').innerHTML =
      '<div class="results-head"><div><span class="eyebrow">Tras la ronda ' + s.currentRound + ' de ' + s.totalRounds + '</span><h2 class="section-title">MARCADOR</h2></div></div>' +
      '<table class="board"><thead><tr><th>POS.</th><th>EQUIPO</th><th class="r gain-col">RONDA</th><th class="r">PUNTOS</th></tr></thead><tbody>' + rows + '</tbody></table>';
  }

  function renderGameOver(s) {
    const score = function (t) { return t.score; };
    const sorted = sortedByScore(s.teams, score);
    const top = sorted.length ? sorted[0].score : 0;
    const winners = sorted.filter(function (t) { return t.score === top; });
    const ranked = rankRows(sorted, score);
    const list = ranked.map(function (x, i) {
      return '<li class="rank-row' + (x.row.id === myTeamId() ? ' is-me' : '') + '" style="--i:' + i + ';--w:' + Math.round(100 * x.row.score / Math.max(1, top)) + '%">' +
        '<span class="bar"></span>' + medalHtml(x.rank, x.row.score) +
        '<span class="rname">' + esc(x.row.name) + '</span><span class="rpts">' + x.row.score + '<small>PTS</small></span></li>';
    }).join('');
    if ($('stage-gameover').dataset.rendered === 'yes') return;   // no reiniciar la animación final
    $('stage-gameover').dataset.rendered = 'yes';
    let confetti = '';
    const colors = ['#5ef0bd', '#47c8f5', '#ffd66b', '#8be07a', '#f1c68a'];
    for (let i = 0; i < 26; i++) {
      confetti += '<i style="left:' + Math.round(Math.random() * 100) + '%;background:' + colors[i % colors.length] +
        ';animation-duration:' + (2.4 + Math.random() * 2.2).toFixed(2) + 's;animation-delay:' + (Math.random() * 1.2).toFixed(2) + 's"></i>';
    }
    $('stage-gameover').innerHTML =
      '<div class="winner-card"><div class="confetti" aria-hidden="true">' + confetti + '</div><div class="trophy" aria-hidden="true">🏆</div>' +
      '<h2 class="section-title">¡PARTIDA TERMINADA!</h2>' +
      '<span class="eyebrow">' + (winners.length > 1 ? 'EMPATE EN EL PRIMER LUGAR' : 'GANADOR') + '</span>' +
      '<div class="winner-name">' + winners.map(function (w) { return esc(w.name); }).join(' · ') + '</div>' +
      '<div class="winner-score">' + top + ' PUNTOS</div></div>' +
      '<h3 class="sub-title">CLASIFICACIÓN FINAL</h3><ol class="rank-list">' + list + '</ol>';
  }

  /* ---------- Controles del anfitrión (solo los que corresponden a la fase) ---------- */
  function renderHostActions(s) {
    const bar = $('host-actions');
    let html = '';
    if (isHostView()) {
      switch (s.phase) {
        // Las fases automáticas muestran un botón inactivo: informa y evita que la pantalla "salte"
        case P.WAITING: html = '<button class="btn btn-primary btn-xl" data-action="spin">GIRAR RULETA</button>'; break;
        case P.SPINNING: html = '<button class="btn btn-ghost btn-xl" disabled>GIRANDO…</button>'; break;
        case P.CATEGORY_SELECTED:
          html = app.wheel.anim ? '<button class="btn btn-ghost btn-xl" disabled>GIRANDO…</button>'
            : '<button class="btn btn-primary btn-xl" data-action="show">MOSTRAR PREGUNTA</button>';
          break;
        case P.QUESTION_ACTIVE: html = '<button class="btn btn-warn btn-xl" data-action="close">CERRAR RESPUESTAS</button>'; break;
        case P.ANSWER_LOCKED: html = '<button class="btn btn-ghost btn-xl" disabled>CALCULANDO RESULTADOS…</button>'; break;
        case P.RESULTS: html = '<button class="btn btn-primary btn-xl" data-action="board">VER MARCADOR</button>'; break;
        case P.LEADERBOARD:
          html = '<button class="btn btn-primary btn-xl" data-action="next">' +
            (s.currentRound >= s.totalRounds ? 'FINALIZAR PARTIDA' : 'SIGUIENTE RONDA →') + '</button>';
          break;
        case P.GAME_OVER:
          html = '<button class="btn btn-ghost btn-xl" data-action="restart">' + (app.role === 'preview' ? 'SALIR DEL PREVIEW' : 'NUEVA PARTIDA') + '</button>';
          break;
      }
    } else if (s.phase === P.GAME_OVER) {
      html = '<button class="btn btn-ghost btn-xl" data-action="leave">Salir</button>';
    }
    if (bar.dataset.html !== html) { bar.dataset.html = html; bar.innerHTML = html; }
    bar.classList.toggle('hidden', !html);
  }

  /* ---------- Temporizador visual (fluido, a la frecuencia de pantalla) ---------- */
  const RING_LEN = 2 * Math.PI * 44;
  let lastTimerNum = null;
  function tick() {
    const s = app.state;
    const num = $('timer-num');
    const ring = $('timer-ring');
    if (!s || !num || !ring || (s.phase !== P.QUESTION_ACTIVE && s.phase !== P.ANSWER_LOCKED)) return;
    let remaining = 0;
    if (s.phase === P.QUESTION_ACTIVE && s.questionDeadline) remaining = Math.max(0, (s.questionDeadline - nowMs()) / 1000);
    const total = s.questionStartedAt && s.questionDeadline ? (s.questionDeadline - s.questionStartedAt) / 1000 : CFG.QUESTION_TIME;
    const frac = Math.max(0, Math.min(1, remaining / total));
    const shown = Math.ceil(remaining);
    if (shown !== lastTimerNum) { num.textContent = shown; lastTimerNum = shown; }
    ring.style.strokeDasharray = RING_LEN;
    ring.style.strokeDashoffset = RING_LEN * (1 - frac);
    const prog = $('q-progress');
    if (prog) {
      prog.style.transform = 'scaleX(' + frac + ')';
      prog.classList.toggle('warn', remaining <= 10 && remaining > 5);
      prog.classList.toggle('danger', remaining <= 5);
    }
    const timer = $('timer');
    timer.classList.toggle('warn', remaining <= 10 && remaining > 5);
    timer.classList.toggle('danger', remaining <= 5 && remaining > 0);
    if (s.phase === P.QUESTION_ACTIVE && remaining <= 0) {   // al llegar a 0 la pregunta se bloquea sin esperar al servidor
      document.querySelectorAll('#stage-question .option.is-live').forEach(function (b) { b.disabled = true; b.classList.remove('is-live'); b.classList.add('is-dimmed'); });
    }
  }
  function loop() { tick(); requestAnimationFrame(loop); }

  /* ---------- Conexión con los backends ---------- */
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
    R.Sound.unlock();
    const btn = $('btn-create');
    btn.disabled = true;
    app.role = 'host';
    try {
      if (app.sb) {
        app.host = new R.SbHost(CFG.TOTAL_ROUNDS);
        wireBackend(app.host);
        await app.host.create();
      } else {
        await loadQuestions();
        app.host = new R.HostGame(transport, CFG.TOTAL_ROUNDS);
      }
    } catch (e) {
      app.role = null; app.host = null;
      showToast(e.message || 'No se pudo crear la sala.');
      btn.disabled = false;
      return;
    }
    app.host.subscribe(onState);
    if (!app.sb) app.host.publish();
  }

  async function resumeHost() {
    const host = new R.SbHost(CFG.TOTAL_ROUNDS);
    wireBackend(host);
    try {
      if (await host.resume()) { app.role = 'host'; app.host = host; host.subscribe(onState); return true; }
    } catch (e) { /* sin conexión: se queda en el inicio */ }
    return false;
  }

  /* PREVIEW / DEMO: partida 100 % local en este navegador. No usa Supabase, no crea salas,
     no envía nada por la red. Usa el mismo motor y la misma interfaz que la partida real. */
  async function startPreview() {
    R.Sound.unlock();
    try { await loadQuestions(); } catch (e) { showToast(e.message); return; }
    app.role = 'preview';
    document.body.classList.add('is-preview');
    $('preview-badge').classList.remove('hidden');
    const host = new R.HostGame({ send: function () {}, on: function () {} }, CFG.PREVIEW_ROUNDS);
    host.state.roomCode = 'DEMO';
    host.addTeam(PREVIEW_ID, 'Tu equipo', false);
    setInterval(function () { const t = host.findTeam(PREVIEW_ID); if (t) t.lastSeen = Date.now(); }, 3000);
    app.host = host;
    app.client = {
      teamId: PREVIEW_ID, name: 'Tu equipo', myAnswer: null,
      hostNow: function () { return Date.now(); },
      submitAnswer: function (index) {
        if (this.myAnswer || !app.state) return;
        this.myAnswer = { round: app.state.currentRound, index: index };
        const res = host.submitAnswer(PREVIEW_ID, index);
        if (!res.ok) { this.myAnswer = null; showToast(res.error); onState(app.state); }
      }
    };
    host.subscribe(onState);
    host.addDemoTeams();
    host.startGame();
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

  function leave() {
    const done = function () { session.clear(); location.reload(); };
    if (app.sb && app.role === 'host') return app.host.close().then(done, done);
    if (app.sb && app.role === 'team') return app.client.leave().then(done, done);
    if (app.role === 'team') transport.send({ type: 'LEAVE', room: app.client.room, teamId: app.client.teamId });
    done();
  }

  function updateSoundButton() {
    const on = R.Sound.isEnabled();
    $('btn-sound').innerHTML = icon(on ? 'i-sound' : 'i-mute');
    $('btn-sound').setAttribute('aria-label', on ? 'Silenciar sonido' : 'Activar sonido');
    $('btn-sound').setAttribute('aria-pressed', on ? 'false' : 'true');
  }

  function bindEvents() {
    $('btn-create').addEventListener('click', createRoom);
    $('btn-preview').addEventListener('click', startPreview);
    $('btn-join').addEventListener('click', function () { showJoinError(''); show('screen-join'); $('join-code').focus(); });
    $('btn-join-back').addEventListener('click', function () { show('screen-home'); });
    $('btn-sound').addEventListener('click', function () { R.Sound.setEnabled(!R.Sound.isEnabled()); updateSoundButton(); });

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
        if (app.role === 'preview') return location.reload();
        const st = app.state;
        const inGame = st && st.phase !== P.LOBBY && st.phase !== P.GAME_OVER;
        if (inGame && !confirm(app.role === 'host' ? '¿Salir? Se perderá la partida en curso.' : '¿Salir de la partida? Tu equipo quedará fuera.')) return;
        leave();
      });
    });

    $('btn-demo').addEventListener('click', function () { app.host.addDemoTeams(); });
    $('btn-start').addEventListener('click', function () { R.Sound.unlock(); app.host.startGame(); });

    $('host-actions').addEventListener('click', function (e) {
      const b = e.target.closest('[data-action]');
      if (!b || b.disabled) return;
      const h = app.host;
      switch (b.dataset.action) {
        case 'spin': R.Sound.unlock(); b.disabled = true; h.spin(); break;   // el sonido nace del clic en GIRAR
        case 'show': b.disabled = true; h.showQuestion(); break;
        case 'close': b.disabled = true; h.closeAnswers(); break;
        case 'board': b.disabled = true; h.showLeaderboard(); break;
        case 'next': b.disabled = true; h.nextRound(); break;
        case 'restart':
          if (app.role === 'preview') location.reload(); else leave();
          break;
        case 'leave': leave(); break;
      }
      // Si la acción falla (p. ej. sin red), el botón vuelve a estar disponible
      setTimeout(function () { if (document.body.contains(b)) b.disabled = false; }, 2500);
    });

    // Respuestas: un único manejador para mouse, toque y teclado (todos generan "click" en un <button>)
    $('stage-question').addEventListener('click', function (e) {
      const b = e.target.closest('button.option[data-index]');
      if (!b || b.disabled || !canAnswer() || myAnswer() !== null) return;
      R.Sound.unlock();
      app.client.submitAnswer(parseInt(b.dataset.index, 10));
      R.Sound.confirm();
    });
  }

  /* Indicadores de modo y restricción de anfitrión a computador. */
  function setupHome() {
    const mode = $('mode-badge');
    if (!app.sb) {
      mode.classList.remove('hidden');
      mode.textContent = R.SUPABASE && R.SUPABASE.url
        ? '⚠ No se pudo cargar Supabase. Modo local de prueba.'
        : 'Modo local (sin Supabase): las salas solo funcionan entre pestañas de este navegador. Para revisar el juego usa PREVIEW / DEMO.';
    } else {
      $('btn-demo').classList.add('hidden');
    }
    if (window.matchMedia && window.matchMedia('(hover: none) and (pointer: coarse)').matches) {
      $('btn-create').disabled = true;
      $('btn-create').querySelector('small').textContent = 'Disponible solo en computador';
    }
  }

  function initWheel() {
    app.wheel = new R.Wheel({
      canvas: $('wheel-canvas'), rotor: $('wheel-rotor'), pointer: $('wheel-pointer'),
      wrap: $('wheel-wrap'), highlight: $('wheel-highlight-path')
    });
    app.wheel.onLand = function () { if (app.state) renderGame(app.state); };
  }

  function init() {
    if (R.startBackground) R.startBackground($('bg-canvas'));
    initWheel();
    bindEvents();
    updateSoundButton();
    requestAnimationFrame(loop);

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
