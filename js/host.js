/* Motor del anfitrión: dueño del estado autoritativo.
   Los equipos solo envían intenciones (JOIN, ANSWER); el anfitrión valida, puntúa y publica el estado.
   Al migrar a Supabase, esta lógica pasaría a una función de servidor / RPC con la misma forma. */
(function (R) {
  'use strict';

  const P = R.PHASES;
  const CFG = R.CONFIG;
  const CODE_CHARS = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'; // sin 0/O/1/I para dictar el código en voz alta

  function generateRoomCode() {
    let s = '';
    for (let i = 0; i < 3; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    return 'ECO-' + s;
  }

  function normalizeName(name) {
    return String(name || '').replace(/\s+/g, ' ').trim();
  }

  function nameKey(name) {
    return normalizeName(name).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  }

  /* Devuelve un mensaje de error o null si el nombre es válido. */
  function validateTeamName(name, existingTeams, ownId) {
    const n = normalizeName(name);
    if (!n) return 'Escribe un nombre para tu equipo.';
    if (n.length < CFG.MIN_TEAM_NAME) return 'El nombre es demasiado corto.';
    if (n.length > CFG.MAX_TEAM_NAME) return 'El nombre es demasiado largo (máximo ' + CFG.MAX_TEAM_NAME + ' caracteres).';
    const key = nameKey(n);
    const dup = existingTeams.some(function (t) { return t.id !== ownId && nameKey(t.name) === key; });
    return dup ? 'Ya existe un equipo con ese nombre en la sala.' : null;
  }

  class HostGame {
    constructor(transport, totalRounds) {
      this.transport = transport;
      this.state = R.createInitialState(generateRoomCode(), totalRounds || CFG.TOTAL_ROUNDS);
      this.state.wheel = R.buildWheel(R.QUESTIONS || []);
      this.listeners = [];
      this.timers = [];
      transport.on(this.handleMessage.bind(this));
      setInterval(this.checkPresence.bind(this), 3000);
    }

    subscribe(fn) { this.listeners.push(fn); }

    hostNow() { return Date.now(); }

    publish() {
      const pub = R.toPublicState(this.state, Date.now());
      this.listeners.forEach(function (fn) { fn(pub); });
      this.transport.send({ type: 'STATE', room: this.state.roomCode, state: pub });
    }

    sendTo(teamId, msg) {
      msg.room = this.state.roomCode;
      msg.to = teamId;
      this.transport.send(msg);
    }

    later(fn, ms) {
      const id = setTimeout(fn, ms);
      this.timers.push(id);
      return id;
    }

    clearTimers() {
      this.timers.forEach(clearTimeout);
      this.timers = [];
    }

    go(phase) {
      if (!R.canTransition(this.state.phase, phase)) return false;
      this.state.phase = phase;
      return true;
    }

    /* ---------- Mensajes de los equipos ---------- */
    handleMessage(msg) {
      if (!msg || msg.room !== this.state.roomCode) return;
      if (msg.type === 'JOIN') {
        const res = this.addTeam(msg.teamId, msg.name, false);
        this.sendTo(msg.teamId, {
          type: 'JOIN_RESULT', ok: res.ok, error: res.error || null,
          myAnswer: res.ok ? this.answerOf(msg.teamId) : null
        });
        if (res.ok) this.publish();
      } else if (msg.type === 'LEAVE') {
        const t = this.findTeam(msg.teamId);
        if (!t) return;
        if (this.state.phase === P.LOBBY) this.state.teams = this.state.teams.filter(function (x) { return x !== t; });
        else t.connected = false;
        this.publish();
      } else if (msg.type === 'HEARTBEAT') {
        const t = this.findTeam(msg.teamId);
        if (t) {
          t.lastSeen = Date.now();
          if (!t.connected) { t.connected = true; this.publish(); }
        }
      } else if (msg.type === 'ANSWER') {
        const res = this.submitAnswer(msg.teamId, msg.index);
        if (res.ok) this.sendTo(msg.teamId, { type: 'ANSWER_ACK', round: this.state.currentRound, index: msg.index });
        else this.sendTo(msg.teamId, { type: 'ANSWER_REJECT', error: res.error });
      }
    }

    findTeam(id) {
      return this.state.teams.find(function (t) { return t.id === id; });
    }

    answerOf(teamId) {
      const a = this.state.answers[teamId];
      return a ? { round: this.state.currentRound, index: a.index } : null;
    }

    checkPresence() {
      const now = Date.now();
      let changed = false;
      this.state.teams.forEach(function (t) {
        if (t.isBot) return;
        const online = now - t.lastSeen < CFG.OFFLINE_AFTER_MS;
        if (online !== t.connected) { t.connected = online; changed = true; }
      });
      if (changed) this.publish();
    }

    /* ---------- Equipos ---------- */
    addTeam(id, name, isBot) {
      const s = this.state;
      const existing = this.findTeam(id);
      if (existing) { // reconexión del mismo dispositivo
        existing.lastSeen = Date.now();
        existing.connected = true;
        return { ok: true, team: existing };
      }
      if (s.phase !== P.LOBBY) return { ok: false, error: 'La partida ya comenzó. No se pueden unir más equipos.' };
      const err = validateTeamName(name, s.teams, id);
      if (err) return { ok: false, error: err };
      const team = {
        id: id, name: normalizeName(name), score: 0, correct: 0,
        isBot: !!isBot, lastSeen: Date.now(), connected: true
      };
      s.teams.push(team);
      return { ok: true, team: team };
    }

    addDemoTeams() {
      if (this.state.phase !== P.LOBBY) return;
      const self = this;
      CFG.DEMO_TEAMS.forEach(function (n, i) { self.addTeam('bot-' + i, n, true); });
      this.publish();
    }

    /* ---------- Flujo de la partida (acciones del anfitrión) ---------- */
    startGame() {
      if (this.state.teams.length < 1 || !this.go(P.WAITING)) return;
      this.publish();
    }

    /* El segmento (y con él la categoría y la pregunta) se decide AQUÍ, una sola vez, en el estado autoritativo. */
    spin() {
      const s = this.state;
      if (s.phase !== P.WAITING) return;
      if (!s.wheel.length) s.wheel = R.buildWheel(R.QUESTIONS);   // ruleta agotada: se vuelve a armar
      const n = s.wheel.length;
      let index = Math.floor(Math.random() * n);
      // Solo pruebas: forzar un segmento concreto
      const forced = R.DEBUG_FORCE_QUESTION ? s.wheel.findIndex(function (x) { return x.q === R.DEBUG_FORCE_QUESTION; }) : -1;
      if (forced >= 0) index = forced;
      R.DEBUG_FORCE_QUESTION = null;

      const seg = s.wheel[index];
      const segDeg = 360 / n;
      // La aguja se detiene a un lado del centro (nunca encima del nombre), siempre dentro del segmento
      const jitter = (Math.random() < 0.5 ? -1 : 1) * segDeg * (0.22 + Math.random() * 0.16);
      const landing = (360 - (index * segDeg + segDeg / 2 + jitter) + 360) % 360;
      const extraTurns = 7 + Math.floor(Math.random() * 3);   // giro rápido: 7 a 9 vueltas
      const rotation = Math.floor(s.wheelRotation / 360) * 360 + extraTurns * 360 + landing;

      s.currentCategory = seg.c;
      s.currentQuestion = R.QUESTIONS.find(function (q) { return q.id === seg.q; });
      s.spin = { id: Date.now(), categoryIndex: index, rotation: rotation, durationMs: CFG.SPIN_DURATION_MS };
      s.wheelRotation = rotation;
      this.go(P.SPINNING);
      this.publish();

      const self = this;
      this.later(function () {
        if (self.go(P.CATEGORY_SELECTED)) self.publish();
      }, CFG.SPIN_DURATION_MS + 400);
    }

    showQuestion() {
      const s = this.state;
      if (s.phase !== P.CATEGORY_SELECTED || !this.go(P.QUESTION_ACTIVE)) return;
      s.questionStartedAt = Date.now();
      s.questionDeadline = s.questionStartedAt + CFG.QUESTION_TIME * 1000;
      s.answers = {};
      this.publish();
      this.later(this.closeAnswers.bind(this), CFG.QUESTION_TIME * 1000);
      this.scheduleBots();
    }

    closeAnswers() {
      if (this.state.phase !== P.QUESTION_ACTIVE || !this.go(P.ANSWER_LOCKED)) return;
      this.clearTimers();
      this.publish();
      this.later(this.finishRound.bind(this), CFG.RESULTS_DELAY_MS);
    }

    /* ---------- Respuestas ---------- */
    submitAnswer(teamId, index) {
      const s = this.state;
      const team = this.findTeam(teamId);
      if (!team) return { ok: false, error: 'Equipo no registrado.' };
      if (s.phase !== P.QUESTION_ACTIVE) return { ok: false, error: 'Las respuestas están cerradas.' };
      const now = Date.now(); // <-- reloj del anfitrión/servidor, no el del dispositivo del equipo
      if (now > s.questionDeadline) return { ok: false, error: 'Se acabó el tiempo.' };
      if (s.answers[teamId]) return { ok: false, error: 'Tu equipo ya respondió.' };
      const n = s.currentQuestion.options.length;
      if (!Number.isInteger(index) || index < 0 || index >= n) return { ok: false, error: 'Opción inválida.' };
      s.answers[teamId] = { index: index, receivedAt: now, responseTime: (now - s.questionStartedAt) / 1000 };
      this.publish();
      return { ok: true };
    }

    scheduleBots() {
      const self = this;
      const q = this.state.currentQuestion;
      this.state.teams.filter(function (t) { return t.isBot; }).forEach(function (bot) {
        if (Math.random() < 0.1) return; // a veces no responde
        const correct = Math.random() < 0.7;
        let idx = q.correctAnswer;
        if (!correct) {
          const wrong = q.options.map(function (_, i) { return i; }).filter(function (i) { return i !== q.correctAnswer; });
          idx = wrong[Math.floor(Math.random() * wrong.length)];
        }
        self.later(function () { self.submitAnswer(bot.id, idx); }, 1200 + Math.random() * 15000);
      });
    }

    /* ---------- Puntos (se guardan en segundo plano; solo se muestran al final) ---------- */
    finishRound() {
      const s = this.state;
      if (s.phase !== P.ANSWER_LOCKED) return;
      const q = s.currentQuestion;
      s.teams.forEach(function (t) {
        const a = s.answers[t.id];
        const isCorrect = !!a && a.index === q.correctAnswer;
        t.score += R.calculateScore(a ? a.responseTime : null, isCorrect);
        if (isCorrect) t.correct += 1;
      });
      this.advance();
    }

    /* Quita de la ruleta el segmento usado y pasa a la siguiente ronda (o termina la partida). */
    advance() {
      const s = this.state;
      if (s.spin) s.wheel.splice(s.spin.categoryIndex, 1);
      if (s.currentRound >= s.totalRounds) {
        this.go(P.GAME_OVER);
      } else {
        this.go(P.NEXT_ROUND);
        s.currentRound += 1;
        s.currentCategory = null;
        s.currentQuestion = null;
        s.spin = null;
        s.answers = {};
        s.questionStartedAt = s.questionDeadline = null;
        this.go(P.WAITING);
      }
      this.publish();
    }
  }

  R.HostGame = HostGame;
  R.validateTeamName = validateTeamName;
  R.normalizeName = normalizeName;
})(window.Ruleta = window.Ruleta || {});
