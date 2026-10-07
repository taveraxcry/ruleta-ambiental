/* Backend multijugador real sobre Supabase.
   Expone SbHost y SbClient con la misma interfaz que HostGame/ClientGame de la Fase 1, de modo que la
   interfaz no cambia. El estado AUTORITATIVO vive en Postgres (supabase/schema.sql); aquí solo se
   llaman RPC, se escuchan cambios por Realtime y se convierte la fila de la sala en el estado público. */
(function (R) {
  'use strict';

  const CFG = R.CONFIG;
  const HOST_KEY = 'ruleta-sb-host-room';
  const noop = function () {};

  R.sbEnabled = function () {
    return !!(R.SUPABASE && R.SUPABASE.url && R.SUPABASE.anonKey && window.supabase && window.supabase.createClient);
  };

  let sbClient = null;
  function db() {
    if (!sbClient) {
      sbClient = window.supabase.createClient(R.SUPABASE.url, R.SUPABASE.anonKey, {
        auth: { persistSession: true, autoRefreshToken: true, storageKey: 'ruleta-ambiental-auth' },
        realtime: { params: { eventsPerSecond: 20 } }
      });
    }
    return sbClient;
  }

  function friendly(err) {
    const m = (err && err.message) || String(err || '');
    if (/failed to fetch|networkerror|load failed/i.test(m)) return 'Sin conexión con el servidor. Reintenta.';
    if (/anonymous sign-ins are disabled/i.test(m)) return 'Falta activar "Allow anonymous sign-ins" en Supabase (Authentication → Providers).';
    return m;
  }

  function store(fn) { try { return fn(); } catch (e) { return null; } }

  /* Sesión anónima persistente: el mismo dispositivo conserva su identidad (y por tanto su equipo) al recargar. */
  async function ensureSession() {
    const c = db();
    const cur = await c.auth.getSession();
    if (cur.data && cur.data.session) return cur.data.session.user;
    const res = await c.auth.signInAnonymously();
    if (res.error) throw new Error(friendly(res.error));
    return res.data.user;
  }

  /* ---------- Sincronización de una sala (compartida por anfitrión y equipos) ---------- */
  class RoomSync {
    constructor(code, presenceKey) {
      this.code = code;
      this.presenceKey = presenceKey;
      this.room = null;
      this.teams = [];
      this.presence = {};
      this.offset = 0;          // reloj del servidor - reloj local
      this.onChange = noop;
      this.onStatus = noop;
      this.onClosed = noop;
      this.onReconnect = noop;
      this.timers = [];
      this.busy = false;
      this.again = false;
      this.closed = false;
    }

    hostNow() { return Date.now() + this.offset; }

    async syncClock() {
      let best = null;
      for (let i = 0; i < 3; i++) {
        const t0 = Date.now();
        const res = await db().rpc('server_time');
        const t1 = Date.now();
        if (res.error) continue;
        const rtt = t1 - t0;
        if (!best || rtt < best.rtt) best = { rtt: rtt, offset: Number(res.data) - (t0 + t1) / 2 };
      }
      if (best) this.offset = best.offset;
    }

    async start() {
      await this.syncClock();
      const self = this;
      const c = db();
      const ch = c.channel('room:' + this.code, { config: { presence: { key: this.presenceKey } } });
      ch.on('postgres_changes', { event: '*', schema: 'public', table: 'rooms', filter: 'code=eq.' + this.code }, function (p) {
        if (p.eventType === 'DELETE') return self.markClosed();
        if (p.new) { self.room = p.new; self.emit(); }
      });
      ch.on('postgres_changes', { event: '*', schema: 'public', table: 'teams', filter: 'room_code=eq.' + this.code }, function () { self.refresh(); });
      ch.on('presence', { event: 'sync' }, function () { self.presence = ch.presenceState(); self.emit(); });
      ch.subscribe(function (status) {
        if (status === 'SUBSCRIBED') {
          ch.track({ at: Date.now() });
          self.onStatus('online');
          self.refresh();
          self.onReconnect();
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          self.onStatus('offline');
        }
      });
      this.channel = ch;

      // Red de seguridad: sondeo periódico, y al volver la conexión / la pestaña.
      this.timers.push(setInterval(function () { self.refresh(); }, 5000));
      this.timers.push(setInterval(function () { self.syncClock(); }, 60000));
      this.onVisible = function () { if (!document.hidden) { self.refresh(); self.syncClock(); } };
      document.addEventListener('visibilitychange', this.onVisible);
      window.addEventListener('online', this.onVisible);

      await this.refresh();
    }

    async refresh() {
      if (this.closed) return;
      if (this.busy) { this.again = true; return; }
      this.busy = true;
      try {
        const c = db();
        const rr = await c.from('rooms').select('*').eq('code', this.code).maybeSingle();
        const tt = await c.from('teams').select('id,name,score,correct_count,created_at').eq('room_code', this.code).order('created_at', { ascending: true });
        if (rr.error) throw rr.error;
        if (tt.error) throw tt.error;
        if (!rr.data) { this.markClosed(); return; }
        this.room = rr.data;
        this.teams = tt.data || [];
        this.onStatus('online');
        this.emit();
      } catch (e) {
        this.onStatus('offline');
      } finally {
        this.busy = false;
        if (this.again) { this.again = false; this.refresh(); }
      }
    }

    markClosed() {
      if (this.closed) return;
      this.closed = true;
      this.stop();
      this.onClosed();
    }

    stop() {
      this.timers.forEach(clearInterval);
      this.timers = [];
      if (this.onVisible) {
        document.removeEventListener('visibilitychange', this.onVisible);
        window.removeEventListener('online', this.onVisible);
      }
      if (this.channel) db().removeChannel(this.channel);
    }

    /* Convierte la fila de la sala en el mismo estado público que usaba la Fase 1. */
    build() {
      const r = this.room;
      if (!r) return null;
      const present = Object.keys(this.presence || {});
      return {
        serverNow: this.hostNow(),
        roomCode: r.code,
        phase: r.phase,
        currentRound: r.current_round,
        totalRounds: r.total_rounds,
        teams: this.teams.map(function (t) {
          return { id: t.id, name: t.name, score: t.score, correct: t.correct_count, isBot: false, connected: present.indexOf(t.id) !== -1 };
        }),
        wheel: r.wheel || [],
        wheelRotation: r.wheel_rotation,
        spin: r.spin,
        currentCategory: r.current_category,
        question: r.question,
        questionStartedAt: r.question_started_at ? Date.parse(r.question_started_at) : null,
        questionDeadline: r.question_deadline ? Date.parse(r.question_deadline) : null,
        answeredCount: r.answered_count,
        results: r.results
      };
    }

    emit() { this.onChange(this.build()); }
  }

  /* ---------- Anfitrión ---------- */
  class SbHost {
    constructor(totalRounds) {
      this.totalRounds = totalRounds;
      this.listeners = [];
      this.state = null;
      this.onNotice = noop;
      this.onStatus = noop;
      this.onClosed = noop;
      this.driverKey = '';
      this.timers = [];
      this.pending = false;
    }

    static savedRoom() { return store(function () { return localStorage.getItem(HOST_KEY); }); }

    /* Recupera la sala del anfitrión tras recargar la página. Devuelve true si la reanudó. */
    async resume() {
      const code = SbHost.savedRoom();
      if (!code) return false;
      const user = await ensureSession();
      const res = await db().from('rooms').select('code,host_id').eq('code', code).maybeSingle();
      if (res.error || !res.data || res.data.host_id !== user.id) {
        store(function () { localStorage.removeItem(HOST_KEY); });
        return false;
      }
      await this.attach(code);
      return true;
    }

    async create() {
      await ensureSession();
      const res = await db().rpc('create_room', { p_total_rounds: this.totalRounds, p_question_seconds: CFG.QUESTION_TIME });
      if (res.error) throw new Error(friendly(res.error));
      store(function () { localStorage.setItem(HOST_KEY, res.data); });
      await this.attach(res.data);
    }

    async attach(code) {
      const self = this;
      this.code = code;
      this.sync = new RoomSync(code, 'host-' + Math.random().toString(36).slice(2, 8));
      this.sync.onStatus = function (s) { self.onStatus(s); };
      this.sync.onClosed = function () { self.onClosed(); };
      this.sync.onChange = function (st) { self.state = st; self.listeners.forEach(function (fn) { if (st) fn(st); }); if (st) self.drive(st); };
      await this.sync.start();
    }

    subscribe(fn) { this.listeners.push(fn); if (this.state) fn(this.state); }
    publish() { if (this.state) this.listeners.forEach(function (fn) { fn(this.state); }, this); }
    hostNow() { return this.sync ? this.sync.hostNow() : Date.now(); }
    addDemoTeams() { /* solo existe en el modo local */ }

    async call(fn) {
      if (this.pending) return false;
      this.pending = true;
      try {
        const res = await db().rpc(fn, { p_code: this.code });
        if (res.error) { this.onNotice(friendly(res.error)); return false; }
        return true;
      } catch (e) {
        this.onNotice(friendly(e));
        return false;
      } finally {
        this.pending = false;
      }
    }

    startGame() { return this.call('start_game'); }
    spin() { return this.call('spin'); }
    showQuestion() { return this.call('show_question'); }
    closeAnswers() { return this.call('close_answers'); }

    async close() {
      store(function () { localStorage.removeItem(HOST_KEY); });
      this.onClosed = noop;
      if (this.sync) { this.sync.onClosed = noop; this.sync.markClosed(); }
      if (this.code) await db().rpc('close_room', { p_code: this.code });
    }

    /* Acciones automáticas del anfitrión: son las únicas que dependen del tiempo. Se re-evalúan al
       reanudar, así que si el anfitrión recarga la página la partida sigue donde estaba. */
    drive(s) {
      const key = [s.phase, s.currentRound].join('|');
      if (key === this.driverKey) return;
      this.driverKey = key;
      this.timers.forEach(clearTimeout);
      this.timers = [];
      const now = this.hostNow();
      if (s.phase === 'SPINNING' && s.spin) {
        this.later('reveal_category', s.spin.id + s.spin.durationMs + 400 - now);
      } else if (s.phase === 'QUESTION_ACTIVE' && s.questionDeadline) {
        this.later('close_answers', s.questionDeadline - now + 600);   // 600 ms: cubre el margen de red del servidor
      } else if (s.phase === 'ANSWER_LOCKED') {
        this.later('finish_round', CFG.RESULTS_DELAY_MS);   // puntos en segundo plano y de vuelta a la ruleta
      }
    }

    later(fn, ms) {
      const self = this;
      const attempt = function (n) {
        db().rpc(fn, { p_code: self.code }).then(function (res) {
          // Un error de "fase" significa que otro paso ya avanzó la sala: no hay nada que reintentar.
          if (res.error && !/fase/i.test(res.error.message) && n < 5) self.timers.push(setTimeout(function () { attempt(n + 1); }, 1000));
        });
      };
      this.timers.push(setTimeout(function () { attempt(0); }, Math.max(0, ms)));
    }
  }

  /* ---------- Equipo ---------- */
  class SbClient {
    constructor(room, name) {
      this.room = room;
      this.name = name;
      this.teamId = null;
      this.state = null;
      this.myAnswer = null;      // { round, index }
      this.listeners = [];
      this.onNotice = noop;
      this.onStatus = noop;
      this.onClosed = noop;
    }

    async join() {
      try {
        await ensureSession();
        const res = await db().rpc('join_room', { p_code: this.room, p_name: this.name });
        if (res.error) return { ok: false, error: friendly(res.error) };
        this.applyJoin(res.data);
        const self = this;
        this.sync = new RoomSync(this.room, this.teamId);
        this.sync.onStatus = function (s) { self.onStatus(s); };
        this.sync.onClosed = function () { self.onClosed(); };
        this.sync.onChange = function (st) { self.setState(st); };
        // Tras una reconexión se vuelve a pedir el equipo para recuperar el estado de la respuesta.
        this.sync.onReconnect = function () {
          db().rpc('join_room', { p_code: self.room, p_name: self.name }).then(function (r) { if (!r.error) self.applyJoin(r.data); });
        };
        await this.sync.start();
        return { ok: true };
      } catch (e) {
        return { ok: false, error: friendly(e) };
      }
    }

    applyJoin(d) {
      this.teamId = d.teamId;
      this.name = d.name;
      if (d.myAnswer) this.myAnswer = d.myAnswer;
    }

    setState(st) {
      if (!st) return;
      if (this.myAnswer && this.myAnswer.round !== st.currentRound) this.myAnswer = null;
      this.state = st;
      this.emit();
    }

    subscribe(fn) { this.listeners.push(fn); if (this.state) fn(this.state); }
    emit() { const st = this.state; this.listeners.forEach(function (fn) { if (st) fn(st); }); }
    startHeartbeat() { /* la presencia de Realtime hace de latido */ }
    hostNow() { return this.sync ? this.sync.hostNow() : Date.now(); }

    async submitAnswer(index) {
      if (!this.state || this.myAnswer) return;
      const round = this.state.currentRound;
      this.myAnswer = { round: round, index: index };   // se bloquea de inmediato; el servidor decide
      this.emit();
      const res = await db().rpc('submit_answer', { p_code: this.room, p_index: index });
      if (res.error) {
        if (/ya respondió/i.test(res.error.message)) return;
        this.myAnswer = null;
        this.onNotice(friendly(res.error));
        this.emit();
      }
    }

    async leave() {
      if (this.sync) { this.sync.onClosed = noop; this.sync.markClosed(); }
      await db().rpc('leave_room', { p_code: this.room });
    }
  }

  R.SbHost = SbHost;
  R.SbClient = SbClient;
})(window.Ruleta = window.Ruleta || {});
