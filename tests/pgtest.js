/* Postgres embebido con un "mini Supabase": roles anon/authenticated, auth.uid() y publicación realtime.
   Aplica el MISMO supabase/schema.sql y seed que se ejecutan en Supabase real. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Client, Pool } = require('pg');
const EmbeddedPostgres = require('embedded-postgres').default;

const ROOT = path.join(__dirname, '..');

async function startDb(port) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ruleta-pg-'));
  const pg = new EmbeddedPostgres({
    databaseDir: dir, user: 'postgres', password: 'postgres', port: port, persistent: false,
    initdbFlags: ['--encoding=UTF8', '--locale=C'], onLog: () => {}, onError: () => {}
  });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase('ruleta');

  const admin = new Client({ host: 'localhost', port, user: 'postgres', password: 'postgres', database: 'ruleta' });
  await admin.connect();
  await admin.query(`
    create role anon nologin; create role authenticated nologin;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create publication supabase_realtime;
    grant usage on schema public, auth to anon, authenticated;
    grant execute on function auth.uid() to anon, authenticated;
    -- Supabase concede por defecto privilegios amplios en public: se reproduce para probar el endurecimiento
    alter default privileges in schema public grant all on tables to anon, authenticated;
    alter default privileges in schema public grant all on functions to anon, authenticated;
  `);
  await admin.query(fs.readFileSync(path.join(ROOT, 'supabase/schema.sql'), 'utf8'));
  await admin.query(fs.readFileSync(path.join(ROOT, 'supabase/seed_questions.sql'), 'utf8'));

  // Cada consulta usa su propia conexión: las transacciones de distintos usuarios nunca se mezclan.
  const pool = new Pool({ host: 'localhost', port, user: 'postgres', password: 'postgres', database: 'ruleta', max: 12 });

  /* Ejecuta una consulta como un usuario autenticado (rol authenticated + auth.uid() = uid). */
  async function asUser(uid, sql, params) {
    const c = await pool.connect();
    try {
      await c.query('begin');
      await c.query('set local role authenticated');
      await c.query("select set_config('request.jwt.claim.sub', $1, true)", [uid]);
      const res = await c.query(sql, params || []);
      await c.query('commit');
      return res;
    } catch (e) {
      await c.query('rollback').catch(() => {});
      throw e;
    } finally {
      c.release();
    }
  }

  /* Conexión dedicada (para transacciones manuales, p. ej. rol anon). */
  async function withClient(fn) {
    const c = await pool.connect();
    try { return await fn(c); } finally { c.release(); }
  }

  async function stop() {
    await pool.end();
    await admin.end();
    await pg.stop();
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* noop */ }
  }

  // Consultas de administrador desde las pruebas (rol postgres, sin RLS), concurrentes con seguridad.
  const adminPool = { query: (...a) => pool.query(...a) };
  return { admin: adminPool, asUser, withClient, stop };
}

module.exports = { startDb };
