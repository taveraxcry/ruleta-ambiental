/* SOLO PARA PRUEBAS. Sustituye a @supabase/supabase-js dentro del navegador de pruebas y habla con
   tests/bridge.js (que ejecuta las mismas RPC y políticas RLS sobre un Postgres real).
   Implementa únicamente la parte de la API que usa js/supabase-backend.js. */
(function () {
  'use strict';
  const BASE = location.origin;
  const UID_KEY = 'shim-user';
  const uid = function () { return localStorage.getItem(UID_KEY) || ''; };

  function Query(table) { this.table = table; this.cols = '*'; this.filters = []; this.orderBy = null; this.single = false; }
  Query.prototype.select = function (c) { this.cols = c; return this; };
  Query.prototype.eq = function (c, v) { this.filters.push([c, v]); return this; };
  Query.prototype.order = function (c, o) { this.orderBy = [c, !(o && o.ascending === false)]; return this; };
  Query.prototype.maybeSingle = function () { this.single = true; return this; };
  Query.prototype.then = function (ok, fail) {
    const body = { table: this.table, cols: this.cols, filters: this.filters, order: this.orderBy, single: this.single };
    return fetch(BASE + '/__select', { method: 'POST', headers: { 'content-type': 'application/json', 'x-user': uid() }, body: JSON.stringify(body) })
      .then(function (r) { return r.json(); })
      .then(function (j) { return j.error ? { data: null, error: j.error } : { data: j.data, error: null }; })
      .then(ok, fail);
  };

  function Channel(name, opts) {
    this.name = name;
    this.key = opts && opts.config && opts.config.presence && opts.config.presence.key;
    this.handlers = { rooms: [], teams: [], presence: [] };
    this.state = {};
  }
  Channel.prototype.on = function (type, filter, cb) {
    if (type === 'postgres_changes') this.handlers[filter.table].push(cb);
    else this.handlers.presence.push(cb);
    return this;
  };
  Channel.prototype.subscribe = function (cb) {
    const self = this;
    const room = this.name.replace(/^room:/, '');
    this.es = new EventSource(BASE + '/__events?user=' + encodeURIComponent(uid()) + '&room=' + encodeURIComponent(room) + '&key=' + encodeURIComponent(this.key));
    this.es.onopen = function () { cb('SUBSCRIBED'); };
    this.es.onerror = function () { cb('CHANNEL_ERROR'); };
    this.es.onmessage = function (e) {
      const m = JSON.parse(e.data);
      if (m.k === 'rooms') self.handlers.rooms.forEach(function (h) { h({ eventType: 'UPDATE', new: m.new }); });
      else if (m.k === 'rooms-delete') self.handlers.rooms.forEach(function (h) { h({ eventType: 'DELETE', new: null }); });
      else if (m.k === 'teams') self.handlers.teams.forEach(function (h) { h({ eventType: 'UPDATE' }); });
      else if (m.k === 'presence') { self.state = m.state; self.handlers.presence.forEach(function (h) { h(); }); }
    };
    return this;
  };
  Channel.prototype.track = function () { return Promise.resolve('ok'); };
  Channel.prototype.presenceState = function () { return this.state; };
  Channel.prototype.close = function () { if (this.es) this.es.close(); };

  window.supabase = {
    createClient: function () {
      return {
        auth: {
          getSession: function () {
            const id = localStorage.getItem(UID_KEY);
            return Promise.resolve({ data: { session: id ? { user: { id: id } } : null } });
          },
          signInAnonymously: function () {
            return fetch(BASE + '/__auth', { method: 'POST' }).then(function (r) { return r.json(); }).then(function (j) {
              localStorage.setItem(UID_KEY, j.id);
              return { data: { user: { id: j.id } }, error: null };
            });
          }
        },
        rpc: function (fn, args) {
          return fetch(BASE + '/__rpc/' + fn, { method: 'POST', headers: { 'content-type': 'application/json', 'x-user': uid() }, body: JSON.stringify(args || {}) })
            .then(function (r) { return r.json(); })
            .then(function (j) { return j.error ? { data: null, error: j.error } : { data: j.data, error: null }; })
            .catch(function () { return { data: null, error: { message: 'Failed to fetch' } }; });
        },
        from: function (t) { return new Query(t); },
        channel: function (n, o) { return new Channel(n, o); },
        removeChannel: function (ch) { ch.close(); }
      };
    }
  };
})();
