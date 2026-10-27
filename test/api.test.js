'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startServer } = require('../server');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studydesk-test-'));
let srv, base;
test.before(async () => { srv = await startServer({ dataDir: dir, port: 0, host: '127.0.0.1' }); base = `http://127.0.0.1:${srv.port}`; });
test.after(() => { srv.close(); fs.rmSync(dir, { recursive: true, force: true }); });

function client() {
  let cookie = '';
  return async (method, url, body, headers = { 'X-Study-Desk': '1' }) => {
    const h = { ...headers, cookie };
    if (body !== undefined) h['Content-Type'] = 'application/json';
    const r = await fetch(base + url, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined });
    const sc = r.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    let data = {}; try { data = await r.json(); } catch (e) {}
    return { status: r.status, data };
  };
}
const state = (extra = {}) => ({
  topics: [{ id: 'math1', name: 'Math', goal: 60, color: '#1f6f5c' }],
  log: [{ id: 'l1', t: 'math1', s: 1000, e: 61000 }],
  todos: [{ id: 'td1', text: 'Read chapter 3', q: 1, done: false }],
  run: null, pause: null, notified: {}, pomo: { focus: 25, brk: 5, topic: 'math1', phase: 'idle', end: 0, count: 0, day: '' },
  ...extra,
});

test('serves the web app', async () => {
  const r = await fetch(base + '/');
  assert.equal(r.status, 200);
  assert.match(await r.text(), /Study Desk/);
});

test('register, state sync, conflicts and logout', async () => {
  const a = client();
  assert.equal((await a('GET', '/api/me')).status, 401);
  assert.equal((await a('POST', '/api/register', { username: 'al', password: 'longenough' })).status, 400);
  assert.equal((await a('POST', '/api/register', { username: 'alice', password: 'short' })).status, 400);
  const reg = await a('POST', '/api/register', { username: 'alice', password: 'correct horse' });
  assert.equal(reg.status, 201);
  assert.equal((await a('GET', '/api/me')).data.user.username, 'alice');
  assert.equal((await client()('POST', '/api/register', { username: 'ALICE', password: 'correct horse' })).status, 409);

  let s = await a('GET', '/api/state');
  assert.equal(s.data.rev, 0);
  assert.deepEqual(s.data.state.topics, []);

  // CSRF header is required
  assert.equal((await a('PUT', '/api/state', { baseRev: 0, state: state() }, {})).status, 403);

  const put = await a('PUT', '/api/state', { baseRev: 0, state: state() });
  assert.equal(put.data.rev, 1);
  s = await a('GET', '/api/state');
  assert.equal(s.data.state.topics[0].name, 'Math');
  assert.deepEqual(s.data.state.log, [{ id: 'l1', t: 'math1', s: 1000, e: 61000 }]);
  assert.equal(s.data.state.todos[0].done, false);
  assert.equal(s.data.state.pomo.topic, 'math1');
  assert.equal((await a('GET', '/api/state?rev=1')).data.unchanged, true);

  // stale write from another device is rejected and returns the newer state
  const stale = await a('PUT', '/api/state', { baseRev: 0, state: state({ topics: [] }) });
  assert.equal(stale.status, 409);
  assert.equal(stale.data.state.topics.length, 1);

  // invalid records are dropped
  await a('PUT', '/api/state', { baseRev: 1, state: state({ log: [{ id: 'x', t: 'math1', s: 5, e: 1 }, { id: '<bad>', t: 'math1', s: 1, e: 5 }] }) });
  assert.equal((await a('GET', '/api/state')).data.state.log.length, 0);

  // another user cannot see alice's data
  const b = client();
  await b('POST', '/api/register', { username: 'bob', password: 'another pass' });
  assert.equal((await b('GET', '/api/state')).data.state.topics.length, 0);

  await a('POST', '/api/logout', {});
  assert.equal((await a('GET', '/api/state')).status, 401);
});

test('login, password change and account deletion', async () => {
  const a = client();
  await a('POST', '/api/register', { username: 'carol', password: 'first password' });
  const other = client();
  assert.equal((await other('POST', '/api/login', { username: 'carol', password: 'wrong password' })).status, 401);
  assert.equal((await other('POST', '/api/login', { username: 'Carol', password: 'first password' })).status, 200);

  assert.equal((await a('POST', '/api/password', { current: 'nope', next: 'second password' })).status, 400);
  assert.equal((await a('POST', '/api/password', { current: 'first password', next: 'second password' })).status, 200);
  assert.equal((await other('GET', '/api/me')).status, 401, 'other devices are signed out');
  assert.equal((await a('GET', '/api/me')).status, 200, 'current device stays signed in');

  assert.equal((await a('DELETE', '/api/account', { password: 'first password' })).status, 400);
  assert.equal((await a('DELETE', '/api/account', { password: 'second password' })).status, 200);
  assert.equal((await client()('POST', '/api/login', { username: 'carol', password: 'second password' })).status, 401);
});

test('data persists to the SQLite file', async () => {
  srv.db.flush();
  const { openDb } = require('../server/db');
  const db = await openDb(path.join(dir, 'studydesk.sqlite'));
  assert.ok(db.get("SELECT id FROM users WHERE username = 'alice'"));
  assert.equal(db.get("SELECT COUNT(*) AS n FROM users WHERE username = 'carol'").n, 0);
  db.close();
});
