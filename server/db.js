'use strict';
// SQLite database (sql.js, pure WebAssembly, so the same code runs in Node and Electron
// on every platform without native builds). The whole database lives in memory and is
// written to disk shortly after each change, atomically via a temp file.
const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  pass_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  rev INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS auth_sessions(
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS auth_sessions_user ON auth_sessions(user_id);
CREATE TABLE IF NOT EXISTS topics(
  user_id INTEGER NOT NULL,
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  goal INTEGER NOT NULL,
  color TEXT NOT NULL,
  pos INTEGER NOT NULL,
  PRIMARY KEY(user_id, id)
);
CREATE TABLE IF NOT EXISTS study_sessions(
  user_id INTEGER NOT NULL,
  id TEXT NOT NULL,
  topic_id TEXT NOT NULL,
  start_ms INTEGER NOT NULL,
  end_ms INTEGER NOT NULL,
  PRIMARY KEY(user_id, id)
);
CREATE INDEX IF NOT EXISTS study_sessions_time ON study_sessions(user_id, start_ms);
CREATE TABLE IF NOT EXISTS todos(
  user_id INTEGER NOT NULL,
  id TEXT NOT NULL,
  text TEXT NOT NULL,
  quadrant INTEGER NOT NULL,
  done INTEGER NOT NULL,
  pos INTEGER NOT NULL,
  PRIMARY KEY(user_id, id)
);
CREATE TABLE IF NOT EXISTS user_prefs(
  user_id INTEGER PRIMARY KEY,
  data TEXT NOT NULL
);
PRAGMA user_version = 1;
`;

async function openDb(file) {
  const SQL = await initSqlJs({ wasmBinary: fs.readFileSync(require.resolve('sql.js/dist/sql-wasm.wasm')) });
  if (file) fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = file && fs.existsSync(file) ? new SQL.Database(fs.readFileSync(file)) : new SQL.Database();
  db.run(SCHEMA);

  let timer = null, dirty = false, closed = false;
  function flush() {
    clearTimeout(timer); timer = null;
    if (!dirty || !file) return;
    dirty = false;
    const data = Buffer.from(db.export());
    const tmp = file + '.tmp';
    try { fs.writeFileSync(tmp, data); fs.renameSync(tmp, file); }
    catch (e) { fs.writeFileSync(file, data); }
  }
  function changed() { dirty = true; if (!timer && !closed) timer = setTimeout(flush, 300); }

  const api = {
    all(sql, params = []) {
      const st = db.prepare(sql);
      try { st.bind(params); const out = []; while (st.step()) out.push(st.getAsObject()); return out; }
      finally { st.free(); }
    },
    get(sql, params) { return api.all(sql, params)[0]; },
    run(sql, params = []) { db.run(sql, params); changed(); },
    tx(fn) {
      db.run('BEGIN');
      try { const r = fn(); db.run('COMMIT'); changed(); return r; }
      catch (e) { db.run('ROLLBACK'); throw e; }
    },
    lastId() { return api.get('SELECT last_insert_rowid() AS id').id; },
    flush,
    close() { flush(); closed = true; db.close(); },
  };
  if (file && !fs.existsSync(file)) { dirty = true; flush(); }
  return api;
}

module.exports = { openDb };
