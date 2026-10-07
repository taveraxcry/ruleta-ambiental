/* SOLO PARA PRUEBAS. Servidor que imita lo que hace Supabase para la app:
   - sirve los archivos del proyecto (con config de prueba),
   - ejecuta RPC y consultas COMO el usuario que llama (rol authenticated + RLS reales),
   - emite eventos tipo Realtime (cambios de rooms/teams y presencia) por Server-Sent Events. */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { startDb } = require('./pgtest');

const ROOT = path.join(__dirname, '..');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const IDENT = /^[a-z_][a-z0-9_]*$/;

async function startBridge({ dbPort, httpPort, rounds }) {
  const db = await startDb(dbPort);
  const subs = new Set();
  const presence = {}; // room -> { key: [{}] }

  const send = (s, msg) => { try { s.res.write('data: ' + JSON.stringify(msg) + '\n\n'); } catch (e) { /* cerrado */ } };
  const later = (fn) => setTimeout(fn, 30);   // latencia de red simulada

  async function notify(code) {
    for (const s of Array.from(subs)) {
      if (s.room !== code) continue;
      let row = null;
      try { row = (await db.asUser(s.user, 'select * from public.rooms where code = $1', [code])).rows[0]; } catch (e) { /* noop */ }
      later(() => { send(s, row ? { k: 'rooms', new: row } : { k: 'rooms-delete' }); send(s, { k: 'teams' }); });
    }
  }
  function broadcastPresence(room) {
    subs.forEach((s) => { if (s.room === room) later(() => send(s, { k: 'presence', state: presence[room] || {} })); });
  }

  const readBody = (req) => new Promise((resolve) => {
    let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => resolve(b ? JSON.parse(b) : {}));
  });
  const json = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (req.method === 'POST' && url.pathname === '/__auth') return json(res, 200, { id: crypto.randomUUID() });

      if (req.method === 'POST' && url.pathname.startsWith('/__rpc/')) {
        const fn = url.pathname.slice(7);
        if (!IDENT.test(fn)) return json(res, 400, { error: { message: 'función inválida' } });
        const args = await readBody(req);
        const keys = Object.keys(args).filter((k) => IDENT.test(k));
        const sql = `select public.${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')}) as r`;
        try {
          const r = await db.asUser(req.headers['x-user'], sql, keys.map((k) => args[k]));
          const code = args.p_code ? String(args.p_code).toUpperCase().trim() : (r.rows[0].r && r.rows[0].r.code) || null;
          json(res, 200, { data: r.rows[0].r });
          if (fn === 'create_room') return;
          if (code) notify(code);
        } catch (e) { json(res, 200, { error: { message: e.message } }); }
        return;
      }

      if (req.method === 'POST' && url.pathname === '/__select') {
        const b = await readBody(req);
        if (!['rooms', 'teams'].includes(b.table) && !IDENT.test(b.table)) return json(res, 400, { error: { message: 'tabla' } });
        if (!/^[a-z_,*\s]+$/i.test(b.cols)) return json(res, 400, { error: { message: 'columnas' } });
        const params = []; const where = (b.filters || []).map(([c, v]) => { if (!IDENT.test(c)) throw new Error('col'); params.push(v); return `${c} = $${params.length}`; });
        let sql = `select ${b.cols} from public.${b.table}` + (where.length ? ' where ' + where.join(' and ') : '');
        if (b.order && IDENT.test(b.order[0])) sql += ` order by ${b.order[0]} ${b.order[1] ? 'asc' : 'desc'}`;
        try {
          const r = await db.asUser(req.headers['x-user'], sql, params);
          return json(res, 200, { data: b.single ? (r.rows[0] || null) : r.rows });
        } catch (e) { return json(res, 200, { error: { message: e.message } }); }
      }

      if (url.pathname === '/__events') {
        const s = { res, user: url.searchParams.get('user'), room: url.searchParams.get('room'), key: url.searchParams.get('key') };
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
        res.write(': ok\n\n');
        subs.add(s);
        (presence[s.room] = presence[s.room] || {})[s.key] = [{}];
        broadcastPresence(s.room);
        req.on('close', () => { subs.delete(s); if (presence[s.room]) delete presence[s.room][s.key]; broadcastPresence(s.room); });
        return;
      }

      // Archivos estáticos (con configuración de prueba)
      let rel = url.pathname === '/' ? '/index.html' : url.pathname;
      if (rel === '/js/supabase-config.js') {
        res.writeHead(200, { 'content-type': TYPES['.js'] });
        return res.end("window.Ruleta=window.Ruleta||{};window.Ruleta.SUPABASE={url:'http://localhost',anonKey:'test'};");
      }
      if (rel === '/__shim.js') rel = '/tests/supabase-shim.js';
      const file = path.join(ROOT, rel);
      if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('no'); }
      let body = fs.readFileSync(file);
      if (rel === '/js/config.js') body = Buffer.from(String(body).replace(/TOTAL_ROUNDS: \d+/, 'TOTAL_ROUNDS: ' + (rounds || 2)));
      res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
      res.end(body);
    } catch (e) { json(res, 500, { error: { message: String(e.message) } }); }
  });

  await new Promise((r) => server.listen(httpPort, r));
  return {
    db, url: 'http://localhost:' + httpPort,
    async stop() { subs.forEach((s) => s.res.end()); server.closeAllConnections(); await new Promise((r) => server.close(r)); await db.stop(); }
  };
}

module.exports = { startBridge };
