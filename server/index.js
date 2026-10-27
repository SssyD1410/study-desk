'use strict';
const path = require('path');
const { openDb } = require('./db');
const { createApp } = require('./app');

// Start the HTTP server. Used by the desktop app (embedded, localhost only) and standalone.
async function startServer({ dataDir, port = 8080, host = '0.0.0.0', localOnly = false, allowSignup = true } = {}) {
  const db = await openDb(path.join(dataDir, 'studydesk.sqlite'));
  const app = createApp({ db, localOnly, allowSignup });
  const listen = p => new Promise((res, rej) => {
    const s = app.listen(p, host);
    s.once('listening', () => res(s));
    s.once('error', rej);
  });
  let server;
  try { server = await listen(port); }
  catch (e) { if (e.code !== 'EADDRINUSE' || !localOnly) throw e; server = await listen(0); }
  return {
    server, db, port: server.address().port,
    close() { server.close(); db.close(); },
  };
}

module.exports = { startServer };

if (require.main === module) {
  const env = process.env;
  startServer({
    dataDir: env.DATA_DIR || path.join(__dirname, '..', 'data'),
    port: +env.PORT || 8080,
    host: env.HOST || '0.0.0.0',
    allowSignup: env.ALLOW_SIGNUP !== 'false',
  }).then(s => {
    console.log(`Study Desk server running on http://localhost:${s.port}`);
    const stop = () => { s.close(); process.exit(0); };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
  }).catch(e => { console.error(e); process.exit(1); });
}
