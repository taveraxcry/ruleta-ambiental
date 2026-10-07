/* Capa de transporte. Hoy: BroadcastChannel (pestañas del mismo navegador) o localStorage como respaldo.
   Mañana: sustituir por Supabase Realtime implementando la misma interfaz { send(msg), on(handler) }. */
(function (R) {
  'use strict';

  function LocalTransport(channelName) {
    const handlers = [];
    const emit = function (msg) { handlers.forEach(function (h) { h(msg); }); };

    if (typeof BroadcastChannel !== 'undefined') {
      const ch = new BroadcastChannel(channelName);
      ch.onmessage = function (e) { emit(e.data); };
      this.send = function (msg) { ch.postMessage(msg); };
    } else {
      const key = channelName + ':msg';
      window.addEventListener('storage', function (e) {
        if (e.key === key && e.newValue) {
          try { emit(JSON.parse(e.newValue).msg); } catch (err) { /* mensaje corrupto */ }
        }
      });
      this.send = function (msg) {
        try { localStorage.setItem(key, JSON.stringify({ n: Math.random(), msg: msg })); } catch (err) { /* sin almacenamiento */ }
      };
    }
    this.on = function (h) { handlers.push(h); };
  }

  R.LocalTransport = LocalTransport;
})(window.Ruleta = window.Ruleta || {});
