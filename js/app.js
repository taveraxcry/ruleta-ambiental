/* Interfaz y flujo de la aplicación. Pinta el estado público; nunca decide reglas del juego.
   Roles: 'host' (anfitrión), 'team' (equipo) y 'preview' (un solo computador: controla y responde
   con datos simulados, sin Supabase ni salas reales). */
(function (R) {
  'use strict';

  const P = R.PHASES;
  const CFG = R.CONFIG;
  const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];
  const AVATAR_COLORS = ['#7ed957', '#a5d65a', '#f1c68a', '#b49cff', '#8be07a', '#ff9f8a', '#c8ec7a', '#ffd66b'];
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
  const catById = function (id) { return R.CATEGORIES.find(function (c) { return c.id === id; }) || { id: id, name: id, color: '#4caf50', topic: '' }; };

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

  /* ---------- Pantalla de carga (caja que circula por el circuito de retorno) ---------- */
  let loaderTimer = null;
  function showLoader(text) {
    clearTimeout(loaderTimer);
    $('loader-text').textContent = text;
    loaderTimer = setTimeout(function () { $('loader').hidden = false; }, 120);   // no aparece en cargas instantáneas
  }
  function hideLoader() { clearTimeout(loaderTimer); $('loader').hidden = true; }

  /* Reduce la letra hasta que el texto quepa completo en su caja (nombres largos como GOTHENBURG). */
  function fitText(el) {
    if (!el || !el.clientWidth) return;
    el.style.fontSize = '';
    let size = parseFloat(getComputedStyle(el).fontSize);
    while (el.scrollWidth > el.clientWidth + 1 && size > 14) { size -= 1; el.style.fontSize = size + 'px'; }
  }

  /* ---------- Teléfono ---------- */
  function vibrate(pattern) { try { if (navigator.vibrate) navigator.vibrate(pattern); } catch (e) { /* no soportado */ } }

  /* Pantalla siempre encendida durante la partida: si el teléfono se bloquea, se corta la conexión en vivo. */
  let wakeLock = null;
  function keepAwake() {
    if (!('wakeLock' in navigator) || wakeLock || document.hidden) return;
    navigator.wakeLock.request('screen').then(function (l) {
      wakeLock = l;
      l.addEventListener('release', function () { wakeLock = null; });
    }).catch(function () { /* sin permiso o no soportado */ });
  }

  function loadScript(src, globalName) {
    if (window[globalName]) return Promise.resolve();
    return new Promise(function (resolve, reject) {
      const s = document.createElement('script');
      s.src = src;
      s.onload = function () { window[globalName] ? resolve() : reject(new Error('No se pudo cargar ' + src)); };
      s.onerror = function () { reject(new Error('No se pudo cargar ' + src)); };
      document.head.appendChild(s);
    });
  }

  /* Enlace directo a la sala (el QR lo usa): abre la app con el código ya escrito. */
  function joinLink(code) { return location.origin + location.pathname + '?sala=' + encodeURIComponent(code); }
  let qrFor = null;
  function renderQr(code) {
    if (qrFor === code || !/^https?:/.test(location.protocol)) return;
    qrFor = code;
    loadScript('https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.min.js', 'qrcode').then(function () {
      const qr = window.qrcode(0, 'M');
      qr.addData(joinLink(code));
      qr.make();
      $('host-qr-img').innerHTML = qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
      $('host-qr').classList.remove('hidden');
    }).catch(function () { /* sin QR: el código sigue visible */ });
  }

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
    });   // (no usa loadScript: R.QUESTIONS vive dentro de window.Ruleta)
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
    renderQr(s.roomCode);
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
  const STAGES = ['stage-wheel', 'stage-question', 'stage-gameover'];

  function stageForPhase(phase) {
    switch (phase) {
      case P.QUESTION_ACTIVE: case P.ANSWER_LOCKED: return 'stage-question';
      case P.GAME_OVER: return 'stage-gameover';
      default: return 'stage-wheel';
    }
  }

  function renderGame(s) {
    const over = s.phase === P.GAME_OVER;
    $('g-round-label').textContent = over ? 'PARTIDA' : 'RONDA';
    $('g-round').textContent = over ? 'Finalizada' : s.currentRound + ' / ' + s.totalRounds;
    $('wheel-round').textContent = 'RONDA ' + s.currentRound + ' DE ' + s.totalRounds + (s.wheel && s.wheel.length ? ' · ' + s.wheel.length + ' OPCIONES' : '');
    const done = over ? 1 : (s.currentRound - 1) / s.totalRounds;
    $('g-progress').style.width = Math.round(done * 100) + '%';
    if (canAnswer()) {
      const me = s.teams.find(function (t) { return t.id === myTeamId(); });
      $('g-right').innerHTML = '<span class="score-pill"><span class="sp-name">' + esc(me ? me.name : '') + '</span>' + (over ? '<b>' + (me ? me.score : 0) + ' pts</b>' : '') + '</span>';
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
      $('stage-wheel').classList.remove('has-reveal');
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
      $('stage-wheel').classList.add('has-reveal');
      fitText(reveal.querySelector('.cat-name'));
      // En pantallas bajas, asegura que la categoría quede a la vista
      setTimeout(function () {
        if (reveal.getBoundingClientRect().bottom > window.innerHeight) reveal.scrollIntoView({ behavior: 'smooth', block: 'end' });
      }, 120);
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
        if (locked) status += '<div class="answer-status">Respuestas cerradas · los puntos se revelan al final</div>';
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
          '<h2 class="q-text' + (q.question.length > 160 ? ' long' : '') + '">' + esc(q.question) + '</h2>' +
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

  function sortedByScore(teams, scoreOf) {
    return teams.slice().sort(function (a, b) { return scoreOf(b) - scoreOf(a); });
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
        '<span class="rname">' + esc(x.row.name) + '<small>' + (x.row.correct || 0) + ' acierto' + (x.row.correct === 1 ? '' : 's') + '</small></span>' +
        '<span class="rpts">' + x.row.score + '<small>PTS</small></span></li>';
    }).join('');
    const stage = $('stage-gameover');
    const winnerText = winners.map(function (w) { return esc(w.name); }).join(' · ');
    const eyebrow = winners.length > 1 ? 'EMPATE EN EL PRIMER LUGAR' : 'GANADOR';
    // Los puntajes finales pueden llegar un instante después del cambio de fase: se actualizan
    // los datos sin volver a lanzar la animación del confeti.
    if (stage.dataset.rendered === 'yes') {
      const sig = list + '|' + winnerText + '|' + top;
      if (stage.dataset.sig === sig) return;
      stage.dataset.sig = sig;
      stage.querySelector('.winner-card .eyebrow').textContent = eyebrow;
      stage.querySelector('.winner-name').innerHTML = winnerText;
      stage.querySelector('.winner-score').textContent = top + ' PUNTOS';
      stage.querySelector('.rank-list').innerHTML = list;
      return;
    }
    stage.dataset.rendered = 'yes';
    stage.dataset.sig = list + '|' + winnerText + '|' + top;
    let confetti = '';
    const colors = ['#7ed957', '#a5d65a', '#ffd66b', '#8be07a', '#f1c68a'];
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
        case P.ANSWER_LOCKED:
          html = '<button class="btn btn-ghost btn-xl" disabled>' + (s.currentRound >= s.totalRounds ? 'CALCULANDO PUNTAJE FINAL…' : 'VOLVIENDO A LA RULETA…') + '</button>';
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
    const inQuestion = !!s && (s.phase === P.QUESTION_ACTIVE || s.phase === P.ANSWER_LOCKED) && !!num && !!ring;
    if (!inQuestion) { document.body.classList.remove('timer-off'); return; }
    let remaining = 0;
    if (s.phase === P.QUESTION_ACTIVE && s.questionDeadline) remaining = Math.max(0, (s.questionDeadline - nowMs()) / 1000);
    const total = s.questionStartedAt && s.questionDeadline ? (s.questionDeadline - s.questionStartedAt) / 1000 : CFG.QUESTION_TIME;
    const frac = Math.max(0, Math.min(1, remaining / total));
    const warnAt = total / 2, dangerAt = Math.max(2, total / 4);
    const shown = Math.ceil(remaining);
    if (shown !== lastTimerNum) { num.textContent = shown; lastTimerNum = shown; }
    ring.style.strokeDasharray = RING_LEN;
    ring.style.strokeDashoffset = RING_LEN * (1 - frac);
    const prog = $('q-progress');
    if (prog) {
      prog.style.transform = 'scaleX(' + frac + ')';
      prog.classList.toggle('warn', remaining <= warnAt && remaining > dangerAt);
      prog.classList.toggle('danger', remaining <= dangerAt);
    }
    const timer = $('timer');
    timer.classList.toggle('warn', remaining <= warnAt && remaining > dangerAt);
    timer.classList.toggle('danger', remaining <= dangerAt && remaining > 0);
    // Si el teléfono hizo scroll y el reloj de la tarjeta no se ve, se muestra en el encabezado
    const off = s.phase === P.QUESTION_ACTIVE && timer.getBoundingClientRect().bottom < $('screen-game').querySelector('.game-header').getBoundingClientRect().bottom;
    document.body.classList.toggle('timer-off', off);
    if (off) {
      $('g-timer-num').textContent = shown + ' s';
      $('g-timer').classList.toggle('warn', remaining <= warnAt && remaining > dangerAt);
      $('g-timer').classList.toggle('danger', remaining <= dangerAt);
    }
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
    showLoader('Creando la sala…');
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
      hideLoader();
      app.role = null; app.host = null;
      showToast(e.message || 'No se pudo crear la sala.');
      btn.disabled = false;
      return;
    }
    app.host.subscribe(onState);
    if (!app.sb) app.host.publish();
    hideLoader();
    keepAwake();
  }

  async function resumeHost() {
    const host = new R.SbHost(CFG.TOTAL_ROUNDS);
    wireBackend(host);
    if (R.SbHost.savedRoom()) showLoader('Recuperando la partida…');
    try {
      if (await host.resume()) { app.role = 'host'; app.host = host; host.subscribe(onState); hideLoader(); return true; }
    } catch (e) { /* sin conexión: se queda en el inicio */ }
    hideLoader();
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
    keepAwake();
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
    showLoader(silent ? 'Volviendo a tu sala…' : 'Entrando a la sala…');
    const res = await client.join();
    hideLoader();
    if (!res.ok) { if (!silent) showJoinError(res.error); return false; }
    app.role = 'team';
    app.client = client;
    client.subscribe(onState);
    client.startHeartbeat();
    session.save({ room: code, teamId: client.teamId, name: client.name });
    if (location.search) history.replaceState(null, '', location.pathname);   // quita ?sala= de la URL
    keepAwake();
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
    $('btn-join').addEventListener('click', function () { showJoinError(''); show('screen-join'); $('join-code').focus(); });
    $('btn-join-back').addEventListener('click', function () { show('screen-home'); });
    $('btn-sound').addEventListener('click', function () { R.Sound.setEnabled(!R.Sound.isEnabled()); updateSoundButton(); });
    $('join-code').addEventListener('keydown', function (e) {   // "Siguiente" en el teclado del teléfono: pasa al nombre
      if (e.key === 'Enter') { e.preventDefault(); $('join-name').focus(); }
    });

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
      vibrate(18);
    });
  }

  /* Indicadores de modo y restricción de anfitrión a computador. */
  function setupHome() {
    const mode = $('mode-badge');
    if (!app.sb) {
      mode.classList.remove('hidden');
      mode.textContent = R.SUPABASE && R.SUPABASE.url
        ? '⚠ No se pudo cargar Supabase. Modo local de prueba.'
        : 'Modo local (sin Supabase): las salas solo funcionan entre pestañas de este navegador.';
    } else {
      $('btn-demo').classList.add('hidden');
    }
    if (window.matchMedia && window.matchMedia('(hover: none) and (pointer: coarse)').matches) {
      $('btn-create').disabled = true;
      $('btn-create').querySelector('small').textContent = 'Disponible solo en computador';
    }
  }

  R.debugState = function () { return app.state; };   // solo para las pruebas automáticas

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

    // Al volver a la app (pantalla desbloqueada, pestaña activa) se pide de nuevo mantenerla encendida
    document.addEventListener('visibilitychange', function () { if (!document.hidden && app.role) keepAwake(); });
    window.addEventListener('resize', function () { fitText(document.querySelector('#category-reveal:not(.hidden) .cat-name')); });

    // Recuperación de sesión tras recargar la página (anfitrión o equipo)
    (async function () {
      if (new URLSearchParams(location.search).has('demo')) { history.replaceState(null, '', location.pathname); return startPreview(); }
      if (app.sb && await resumeHost()) return;
      const saved = session.load();
      const linkCode = new URLSearchParams(location.search).get('sala');
      if (saved && saved.room && saved.name && (!linkCode || normalizeCode(linkCode) === saved.room)) {
        const ok = await joinRoom(saved.room, saved.name, saved.teamId, true);
        if (ok) return;
        session.clear();
      }
      if (linkCode) {   // llegó por el QR / enlace: código ya escrito, solo falta el nombre
        show('screen-join');
        $('join-code').value = normalizeCode(linkCode);
        $('join-name').focus();
      }
    })();
  }

  document.addEventListener('DOMContentLoaded', init);
})(window.Ruleta = window.Ruleta || {});
