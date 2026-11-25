'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createApplication } = require('../server');
const { IDLE } = require('../auth');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');

async function fixture(t, options = {}) {
  const runtime = await createApplication({ loanFile: ':memory:', maintenanceFile: ':memory:', ...options });
  const server = runtime.app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await runtime.close(); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  return { ...runtime, origin, request: (url, body, cookie, headers = {}) => fetch(origin + url, { redirect: 'manual',
    method: body === undefined ? 'GET' : 'POST', headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(cookie ? { Cookie: cookie } : {}), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) }) };
}
const admin = { name: 'First Staff', loginID: '012345678', password: 'a-long-test-password' };
const cookie = response => response.headers.get('set-cookie').split(';')[0];
async function signup(f) {
  const response = await f.request('/api/auth/signup', admin); assert.equal(response.status, 201); return cookie(response);
}

test('first signup hashes credentials, creates an admin, and permits protected pages', async t => {
  const f = await fixture(t);
  const response = await f.request('/api/auth/signup', admin); assert.equal(response.status, 201);
  const data = await response.json(); assert.equal(data.user.role, 'admin'); assert.equal(data.user.passwordHash, undefined);
  assert.match(response.headers.get('set-cookie'), /HttpOnly/); assert.match(response.headers.get('set-cookie'), /SameSite=Strict/);
  const stored = f.store.native.prepare('SELECT * FROM StaffUsers').get(); assert.notEqual(stored.passwordHash, admin.password);
  const session = f.store.native.prepare('SELECT * FROM StaffSessions').get(); assert.notEqual(session.tokenHash, cookie(response).split('=')[1]);
  assert.equal((await f.request('/pages/Asset-Management/index.html', undefined, cookie(response))).status, 200);
  assert.equal((await f.request('/api/loans/assets', undefined, cookie(response))).status, 200);
  assert.equal((await f.request('/api/maintenance', undefined, cookie(response))).status, 200);
});
test('signup validates fields, rejects duplicates, and additional staff need a single-use invite', async t => {
  const f = await fixture(t);
  assert.equal((await f.request('/api/auth/signup', { ...admin, password: 'short' })).status, 400);
  assert.equal((await f.request('/api/auth/signup', { ...admin, loginID: 'bad' })).status, 400);
  const session = await signup(f);
  const next = { ...admin, loginID: '123456789', name: 'Other Staff' };
  assert.equal((await f.request('/api/auth/signup', next)).status, 403);
  const invitation = await f.request('/api/auth/invitations', {}, session); assert.equal(invitation.status, 201);
  const { invitationCode } = await invitation.json();
  assert.equal((await f.request('/api/auth/signup', { ...admin, invitationCode })).status, 409);
  const result = await f.request('/api/auth/signup', { ...next, invitationCode }); assert.equal(result.status, 201);
  assert.equal((await result.clone().json()).user.role, 'staff');
  assert.equal((await f.request('/api/auth/invitations', {}, cookie(result))).status, 403);
  assert.equal((await f.request('/api/auth/signup', { ...next, loginID: '987654321', invitationCode })).status, 403);
});
test('login preserves leading zeros and rejects wrong passwords, and logout invalidates the cookie', async t => {
  const f = await fixture(t); await signup(f);
  assert.equal((await f.request('/api/auth/login', { ...admin, password: 'wrong-password' })).status, 401);
  const response = await f.request('/api/auth/login', { ...admin, loginID: '012345678' }); assert.equal(response.status, 200);
  const session = cookie(response);
  assert.equal((await f.request('/api/auth/me', undefined, session)).status, 200);
  assert.equal((await f.request('/api/auth/logout', {}, session)).status, 200);
  assert.equal((await f.request('/api/auth/me', undefined, session)).status, 401);
  assert.equal((await f.request('/api/returns', undefined, session)).status, 401);
});
test('sessions expire after 15 idle minutes and active sessions slide the deadline', async t => {
  let time = Date.now(); const f = await fixture(t, { authNow: () => time }); const session = await signup(f);
  time += IDLE - 1000; assert.equal((await f.request('/api/auth/me', undefined, session)).status, 200);
  time += 2000; assert.equal((await f.request('/api/auth/me', undefined, session)).status, 200);
  time += IDLE; assert.equal((await f.request('/api/auth/me', undefined, session)).status, 401);
});
test('forged staff headers and cookies cannot access data; unauthenticated pages redirect', async t => {
  const f = await fixture(t);
  const response = await f.request('/pages/Asset-Management/index.html'); assert.equal(response.status, 302); assert.match(response.headers.get('location'), /^\/login\?returnTo=/);
  for (const url of ['/api/maintenance', '/api/returns', '/api/loans/assets']) {
    assert.equal((await f.request(url, undefined, 'wjc_session=' + 'a'.repeat(64), { 'X-User': 'MITS Staff' })).status, 401);
  }
  assert.equal((await f.request('/api/warranty-email', {})).status, 401);
});
test('cross-site writes are rejected and repeated login attempts are throttled', async t => {
  const f = await fixture(t);
  assert.equal((await f.request('/api/auth/signup', admin, undefined, { Origin: 'https://foreign.example' })).status, 403);
  let result;
  for (let i = 0; i < 21; i++) result = await f.request('/api/auth/login', { loginID: '999999999', password: 'wrong' });
  assert.equal(result.status, 429); assert.ok(result.headers.get('retry-after'));
});
test('accounts and session cookies survive application restart', async t => {
  const directory = mkdtempSync(path.join(tmpdir(), 'wjc-auth-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'accounts.sqlite');
  let runtime = await createApplication({ loanFile: file, maintenanceFile: ':memory:' });
  let server = runtime.app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/auth/signup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(admin) });
  const session = cookie(response); assert.equal(response.status, 201);
  await new Promise(resolve => server.close(resolve)); await runtime.close();
  runtime = await createApplication({ loanFile: file, maintenanceFile: ':memory:' });
  server = runtime.app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  try { const me = await fetch(`http://127.0.0.1:${server.address().port}/api/auth/me`, { headers: { Cookie: session } }); assert.equal(me.status, 200); }
  finally { await new Promise(resolve => server.close(resolve)); await runtime.close(); }
});
test('a signed-in staff member can check out and return an asset with attributable history', async t => {
  const f = await fixture(t); const session = await signup(f);
  f.store.native.exec("INSERT INTO Assets (assetID, assetName, status, condition) VALUES ('TAG-1', 'Laptop', 'Available', 'Good')");
  const checked = await f.request('/api/loans/checkout', { assetID: 'TAG-1', borrowerName: 'Borrower', borrowerID: '101', borrowerEmail: 'b@uwi.edu', dueDate: '2099-01-01' }, session);
  assert.equal(checked.status, 200); const { transactionID } = await checked.json();
  assert.equal((await f.request('/api/returns/' + transactionID, { condition: 'Good', assetStatus: 'Available', notes: '', received: true }, session)).status, 200);
  const records = await (await f.request('/api/returns', undefined, session)).json();
  assert.equal(records.returns[0].staffName, admin.name);
});

test('staff ID must be a string of exactly nine ASCII digits', async t => {
  const f = await fixture(t);
  for (const loginID of ['12345678', '1234567890', '12345678a', '123 56789', '\uff11\uff12\uff13\uff14\uff15\uff16\uff17\uff18\uff19', 123456789, null]) {
    assert.equal((await f.request('/api/auth/signup', { ...admin, loginID })).status, 400, String(loginID));
    assert.equal((await f.request('/api/auth/login', { loginID, password: admin.password })).status, 400, String(loginID));
  }
});

test('the empty email-account schema upgrades without changing equipment records', async t => {
  const { DatabaseSync } = require('node:sqlite');
  const directory = mkdtempSync(path.join(tmpdir(), 'wjc-id-upgrade-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'legacy.sqlite'); const old = new DatabaseSync(file);
  old.exec(`CREATE TABLE StaffUsers (staffID TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
    salt TEXT NOT NULL, passwordHash TEXT NOT NULL, role TEXT NOT NULL, createdAt INTEGER NOT NULL);
    CREATE TABLE Assets (assetID TEXT PRIMARY KEY, assetName TEXT, status TEXT DEFAULT 'Available');
    INSERT INTO Assets VALUES ('EXISTING-1', 'Existing laptop', 'Available');`);
  old.close();
  const runtime = await createApplication({ loanFile: file, maintenanceFile: ':memory:' });
  try {
    assert.ok(runtime.store.native.prepare('PRAGMA table_info(StaffUsers)').all().some(column => column.name === 'loginID'));
    assert.equal(runtime.store.native.prepare('SELECT assetName FROM Assets').get().assetName, 'Existing laptop');
  } finally { await runtime.close(); }
});
