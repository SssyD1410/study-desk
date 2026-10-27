'use strict';
const path = require('path');
const crypto = require('crypto');
const express = require('express');

const COOKIE = 'sd_session';
const SESSION_TTL = 30 * 864e5;
const USERNAME_RE = /^[A-Za-z0-9_.-]{3,32}$/;
const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;

const scrypt = (pw, salt) => new Promise((res, rej) =>
  crypto.scrypt(pw, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (e, k) => e ? rej(e) : res(k)));
async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  return 'scrypt$' + salt.toString('base64') + '$' + (await scrypt(pw, salt)).toString('base64');
}
async function verifyPassword(pw, stored) {
  const [alg, salt, hash] = String(stored).split('$');
  if (alg !== 'scrypt' || !salt || !hash) return false;
  const want = Buffer.from(hash, 'base64'), got = await scrypt(pw, Buffer.from(salt, 'base64'));
  return want.length === got.length && crypto.timingSafeEqual(want, got);
}
const A = fn => (req, res, next) => fn(req, res, next).catch(next);
const sha256 = s => crypto.createHash('sha256').update(s).digest('hex');
function parseCookies(h) {
  const out = {};
  for (const part of String(h || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) { try { out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); } catch (e) {} }
  }
  return out;
}

// --- state validation: the client sends its whole state; only well-formed records are stored
const arr = v => Array.isArray(v) ? v : [];
const num = (v, d) => Number.isFinite(+v) ? +v : d;
const str = (v, n) => String(v == null ? '' : v).slice(0, n);
function uniq(list) { const m = new Map(); for (const x of list) m.set(x.id, x); return [...m.values()]; }
function cleanState(s) {
  s = s && typeof s === 'object' ? s : {};
  const topics = uniq(arr(s.topics).filter(t => t && ID_RE.test(t.id)).slice(0, 1000).map(t => ({
    id: t.id, name: str(t.name, 200) || 'Untitled',
    goal: Math.max(1, Math.min(1440, Math.round(num(t.goal, 60)))),
    color: /^#[0-9a-fA-F]{6}$/.test(t.color) ? t.color : '#1f6f5c',
  })));
  const log = uniq(arr(s.log).filter(l => l && ID_RE.test(l.id) && typeof l.t === 'string' && ID_RE.test(l.t))
    .map(l => ({ id: l.id, t: l.t, s: Math.round(num(l.s, NaN)), e: Math.round(num(l.e, NaN)) }))
    .filter(l => Number.isFinite(l.s) && Number.isFinite(l.e) && l.e > l.s)).slice(0, 500000);
  const todos = uniq(arr(s.todos).filter(t => t && ID_RE.test(t.id)).slice(0, 5000).map(t => ({
    id: t.id, text: str(t.text, 1000), q: Math.max(0, Math.min(3, Math.round(num(t.q, 1)))), done: !!t.done,
  })));
  const p = s.pomo && typeof s.pomo === 'object' ? s.pomo : {};
  const pomo = {
    focus: Math.max(1, Math.min(240, Math.round(num(p.focus, 25)))),
    brk: Math.max(1, Math.min(120, Math.round(num(p.brk, 5)))),
    topic: ID_RE.test(p.topic) ? p.topic : '',
    phase: ['idle', 'focus', 'breakwait', 'break'].includes(p.phase) ? p.phase : 'idle',
    end: num(p.end, 0), count: Math.max(0, Math.round(num(p.count, 0))), day: str(p.day, 40),
    paused: !!p.paused, left: Math.max(0, num(p.left, 0)),
  };
  const run = s.run && ID_RE.test(s.run.t) && Number.isFinite(+s.run.s) ? { t: s.run.t, s: +s.run.s } : null;
  const pause = s.pause && ID_RE.test(s.pause.t) ? { t: s.pause.t } : null;
  const notified = {};
  if (s.notified && typeof s.notified === 'object') {
    for (const k of Object.keys(s.notified).slice(-300)) if (k.length <= 80) notified[k] = 1;
  }
  return { topics, log, todos, prefs: { run, pause, pomo, notified } };
}

function createApp({ db, publicDir = path.join(__dirname, '..', 'public'), localOnly = false, allowSignup = true }) {
  const app = express();
  app.disable('x-powered-by');
  if (process.env.TRUST_PROXY) app.set('trust proxy', 1);

  // The desktop app's built-in server only answers to localhost (blocks DNS-rebinding).
  if (localOnly) app.use((req, res, next) => ['127.0.0.1', 'localhost'].includes(req.hostname) ? next() : res.status(403).end());

  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    });
    next();
  });
  app.use('/api', express.json({ limit: '20mb' }));

  // CSRF: state-changing API calls must carry a custom header, which other sites cannot send.
  app.use('/api', (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.get('X-Study-Desk') !== '1') return res.status(403).json({ error: 'Missing request header.' });
    next();
  });

  // Resolve the signed-in user from the session cookie.
  app.use('/api', (req, res, next) => {
    const tok = parseCookies(req.headers.cookie)[COOKIE];
    if (tok) {
      const now = Date.now(), th = sha256(tok);
      const row = db.get('SELECT s.user_id, s.expires_at, u.username, u.created_at FROM auth_sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?', [th, now]);
      if (row) {
        req.user = { id: row.user_id, username: row.username, createdAt: row.created_at };
        req.tokenHash = th;
        if (row.expires_at - now < SESSION_TTL / 2) { // sliding expiry
          db.run('UPDATE auth_sessions SET expires_at = ? WHERE token_hash = ?', [now + SESSION_TTL, th]);
          setCookie(req, res, tok);
        }
      }
    }
    next();
  });
  const auth = (req, res, next) => req.user ? next() : res.status(401).json({ error: 'Please sign in.' });

  function setCookie(req, res, tok) {
    res.cookie(COOKIE, tok, { httpOnly: true, sameSite: 'lax', secure: req.secure, maxAge: SESSION_TTL, path: '/' });
  }
  function startSession(req, res, userId) {
    const tok = crypto.randomBytes(32).toString('base64url'), now = Date.now();
    db.run('DELETE FROM auth_sessions WHERE expires_at <= ?', [now]);
    db.run('INSERT INTO auth_sessions(token_hash, user_id, created_at, expires_at) VALUES(?,?,?,?)', [sha256(tok), userId, now, now + SESSION_TTL]);
    setCookie(req, res, tok);
  }

  // Simple per-IP limiter for password attempts.
  const fails = new Map();
  function limited(req) {
    const f = fails.get(req.ip);
    return f && f.n >= 20 && Date.now() - f.t < 15 * 6e4;
  }
  function failed(req) {
    const f = fails.get(req.ip), now = Date.now();
    fails.set(req.ip, f && now - f.t < 15 * 6e4 ? { n: f.n + 1, t: f.t } : { n: 1, t: now });
    if (fails.size > 10000) fails.clear();
  }
  const pwError = pw => typeof pw !== 'string' || pw.length < 8 ? 'Password must be at least 8 characters.' : pw.length > 200 ? 'Password is too long.' : '';
  const userOut = u => ({ id: u.id, username: u.username, createdAt: u.createdAt });

  app.get('/api/health', (req, res) => res.json({ ok: true }));
  app.get('/api/config', (req, res) => res.json({ allowSignup }));

  app.post('/api/register', A(async (req, res) => {
    if (!allowSignup) return res.status(403).json({ error: 'New accounts are disabled on this server.' });
    const { username, password } = req.body || {};
    if (typeof username !== 'string' || !USERNAME_RE.test(username)) return res.status(400).json({ error: 'Username must be 3–32 letters, numbers, dots, dashes or underscores.' });
    const pe = pwError(password); if (pe) return res.status(400).json({ error: pe });
    if (db.get('SELECT id FROM users WHERE username = ?', [username])) return res.status(409).json({ error: 'That username is taken.' });
    const hash = await hashPassword(password), now = Date.now();
    if (db.get('SELECT id FROM users WHERE username = ?', [username])) return res.status(409).json({ error: 'That username is taken.' });
    db.run('INSERT INTO users(username, pass_hash, created_at) VALUES(?,?,?)', [username, hash, now]);
    const id = db.lastId();
    startSession(req, res, id);
    res.status(201).json({ user: { id, username, createdAt: now } });
  }));

  app.post('/api/login', A(async (req, res) => {
    if (limited(req)) return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });
    const { username, password } = req.body || {};
    const u = typeof username === 'string' && db.get('SELECT id, username, pass_hash, created_at FROM users WHERE username = ?', [username]);
    const ok = u && typeof password === 'string' && await verifyPassword(password, u.pass_hash);
    if (!ok) { failed(req); return res.status(401).json({ error: 'Wrong username or password.' }); }
    startSession(req, res, u.id);
    res.json({ user: { id: u.id, username: u.username, createdAt: u.created_at } });
  }));

  app.post('/api/logout', (req, res) => {
    if (req.tokenHash) db.run('DELETE FROM auth_sessions WHERE token_hash = ?', [req.tokenHash]);
    res.clearCookie(COOKIE, { path: '/' });
    res.json({ ok: true });
  });

  app.get('/api/me', auth, (req, res) => res.json({ user: userOut(req.user) }));

  app.post('/api/password', auth, A(async (req, res) => {
    if (limited(req)) return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });
    const { current, next } = req.body || {};
    const u = db.get('SELECT pass_hash FROM users WHERE id = ?', [req.user.id]);
    if (typeof current !== 'string' || !await verifyPassword(current, u.pass_hash)) { failed(req); return res.status(400).json({ error: 'Current password is wrong.' }); }
    const pe = pwError(next); if (pe) return res.status(400).json({ error: pe });
    const hash = await hashPassword(next);
    db.tx(() => {
      db.run('UPDATE users SET pass_hash = ? WHERE id = ?', [hash, req.user.id]);
      // sign out every other device
      db.run('DELETE FROM auth_sessions WHERE user_id = ? AND token_hash != ?', [req.user.id, req.tokenHash]);
    });
    res.json({ ok: true });
  }));

  app.delete('/api/account', auth, A(async (req, res) => {
    if (limited(req)) return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });
    const { password } = req.body || {};
    const u = db.get('SELECT pass_hash FROM users WHERE id = ?', [req.user.id]);
    if (typeof password !== 'string' || !await verifyPassword(password, u.pass_hash)) { failed(req); return res.status(400).json({ error: 'Password is wrong.' }); }
    const id = req.user.id;
    db.tx(() => {
      for (const t of ['auth_sessions', 'topics', 'study_sessions', 'todos', 'user_prefs']) db.run(`DELETE FROM ${t} WHERE user_id = ?`, [id]);
      db.run('DELETE FROM users WHERE id = ?', [id]);
    });
    res.clearCookie(COOKIE, { path: '/' });
    res.json({ ok: true });
  }));

  function readState(uid) {
    const prefs = db.get('SELECT data FROM user_prefs WHERE user_id = ?', [uid]);
    const p = prefs ? JSON.parse(prefs.data) : {};
    return {
      topics: db.all('SELECT id, name, goal, color FROM topics WHERE user_id = ? ORDER BY pos', [uid]),
      log: db.all('SELECT id, topic_id AS t, start_ms AS s, end_ms AS e FROM study_sessions WHERE user_id = ? ORDER BY start_ms', [uid]),
      todos: db.all('SELECT id, text, quadrant AS q, done FROM todos WHERE user_id = ? ORDER BY pos', [uid]).map(t => ({ ...t, done: !!t.done })),
      run: p.run || null, pause: p.pause || null, pomo: p.pomo, notified: p.notified || {},
    };
  }
  const revOf = uid => db.get('SELECT rev FROM users WHERE id = ?', [uid]).rev;

  app.get('/api/state', auth, (req, res) => {
    const rev = revOf(req.user.id);
    if (req.query.rev !== undefined && +req.query.rev === rev) return res.json({ rev, unchanged: true });
    res.json({ rev, state: readState(req.user.id) });
  });

  // Replace the user's data. baseRev guards against overwriting newer changes from another device.
  app.put('/api/state', auth, (req, res) => {
    const uid = req.user.id, rev = revOf(uid);
    if (!req.body || +req.body.baseRev !== rev) return res.status(409).json({ rev, state: readState(uid) });
    const s = cleanState(req.body.state);
    db.tx(() => {
      for (const t of ['topics', 'study_sessions', 'todos']) db.run(`DELETE FROM ${t} WHERE user_id = ?`, [uid]);
      s.topics.forEach((t, i) => db.run('INSERT INTO topics(user_id, id, name, goal, color, pos) VALUES(?,?,?,?,?,?)', [uid, t.id, t.name, t.goal, t.color, i]));
      for (const l of s.log) db.run('INSERT INTO study_sessions(user_id, id, topic_id, start_ms, end_ms) VALUES(?,?,?,?,?)', [uid, l.id, l.t, l.s, l.e]);
      s.todos.forEach((t, i) => db.run('INSERT INTO todos(user_id, id, text, quadrant, done, pos) VALUES(?,?,?,?,?,?)', [uid, t.id, t.text, t.q, t.done ? 1 : 0, i]));
      db.run('INSERT INTO user_prefs(user_id, data) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET data = excluded.data', [uid, JSON.stringify(s.prefs)]);
      db.run('UPDATE users SET rev = rev + 1 WHERE id = ?', [uid]);
    });
    res.json({ rev: rev + 1 });
  });

  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));
  app.use(express.static(publicDir, { index: 'index.html' }));
  app.use((err, req, res, next) => {
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Data is too large.' });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON.' });
    console.error(err);
    res.status(500).json({ error: 'Server error.' });
  });
  return app;
}

module.exports = { createApp, cleanState };
