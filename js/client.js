/* Cliente de un equipo: solo envía intenciones y pinta el último estado recibido del anfitrión. */
(function (R) {
  'use strict';

  const CFG = R.CONFIG;

  class ClientGame {
    constructor(transport, room, teamId, name) {
      this.transport = transport;
      this.room = room;
      this.teamId = teamId;
      this.name = name;
      this.state = null;
      this.clockOffset = 0;   // reloj del anfitrión - reloj local
      this.myAnswer = null;   // { round, index }
      this.listeners = [];
      this.onNotice = function () {};
      this.joinResolver = null;
      transport.on(this.handleMessage.bind(this));
    }

    subscribe(fn) { this.listeners.push(fn); }

    /* Hora estimada del anfitrión: el temporizador se calcula con ella, no con el reloj local a secas. */
    hostNow() { return Date.now() + this.clockOffset; }

    join() {
      const self = this;
      return new Promise(function (resolve) {
        const timeout = setTimeout(function () {
          self.joinResolver = null;
          resolve({ ok: false, error: 'No se encontró la sala. Revisa el código y que el anfitrión siga conectado.' });
        }, CFG.JOIN_TIMEOUT_MS);
        self.joinResolver = function (res) { clearTimeout(timeout); self.joinResolver = null; resolve(res); };
        self.transport.send({ type: 'JOIN', room: self.room, teamId: self.teamId, name: self.name });
      });
    }

    startHeartbeat() {
      const self = this;
      setInterval(function () {
        self.transport.send({ type: 'HEARTBEAT', room: self.room, teamId: self.teamId });
      }, CFG.HEARTBEAT_MS);
    }

    submitAnswer(index) {
      if (!this.state || this.myAnswer) return;
      this.myAnswer = { round: this.state.currentRound, index: index }; // se bloquea de inmediato (optimista)
      this.transport.send({ type: 'ANSWER', room: this.room, teamId: this.teamId, index: index });
      this.emit();
    }

    emit() {
      const st = this.state;
      this.listeners.forEach(function (fn) { fn(st); });
    }

    handleMessage(msg) {
      if (!msg || msg.room !== this.room) return;
      if (msg.type === 'STATE') {
        this.clockOffset = msg.state.serverNow - Date.now();
        this.state = msg.state;
        if (this.myAnswer && this.myAnswer.round !== this.state.currentRound) this.myAnswer = null;
        this.emit();
      } else if (msg.to !== this.teamId) {
        return;
      } else if (msg.type === 'JOIN_RESULT') {
        if (msg.ok && msg.myAnswer) this.myAnswer = msg.myAnswer;
        if (this.joinResolver) this.joinResolver(msg);
      } else if (msg.type === 'ANSWER_REJECT') {
        this.myAnswer = null;
        this.onNotice(msg.error);
        this.emit();
      }
    }
  }

  R.ClientGame = ClientGame;
})(window.Ruleta = window.Ruleta || {});
