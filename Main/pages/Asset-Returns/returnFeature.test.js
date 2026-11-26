'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const registerReturns = require('./returnFeature');
const model = require('./return-model');

function fixture(options = {}) {
  const sqlite = new DatabaseSync(':memory:');
  let failEmail = false;
  const db = {
    run(sql, values, callback) {
      try {
        if (failEmail && sql.includes('INSERT INTO ReturnEmailOutbox')) throw new Error('Simulated disk failure');
        const result = sqlite.prepare(sql).run(...values);
        callback.call({ changes: Number(result.changes), lastID: Number(result.lastInsertRowid) }, null);
      } catch (error) { callback(error); }
    },
    all(sql, values, callback) { try { callback(null, sqlite.prepare(sql).all(...values)); } catch (error) { callback(error); } }
  };
  const middleware = [];
  const router = { use(fn) { middleware.push(fn); }, get() {}, post() {} };
  const api = registerReturns({ use() {}, get() {} }, db, { router, json: () => (req, res, next) => next(), ...options });
  const seed = () => {
    sqlite.exec(`INSERT INTO Assets (assetID, assetName, status, condition) VALUES ('WJC-001', 'Laptop', 'On Loan', 'Good');
      INSERT INTO LoanTransactions (assetID, borrowerName, borrowerID, borrowerEmail, checkOutDate, dueDate)
      VALUES ('WJC-001', 'J. Brown', '101', 'j@example.com', '2026-01-01', '2026-01-10');`);
  };
  return { sqlite, db, api, seed, middleware, failNextEmail() { failEmail = true; } };
}
const input = { condition: 'Fair', assetStatus: 'Sent for Repair', notes: 'Battery needs replacement', received: true };
const staff = { staffID: 'MITS-01', name: 'IT Staff' };

test('check-in saves loan, asset, staff history, and a pending email together', async () => {
  const f = fixture(); await f.api.ready; f.seed();
  const result = await f.api.checkIn(1, input, staff);
  assert.equal(result.emailStatus, 'Pending');
  assert.equal(f.sqlite.prepare('SELECT status FROM LoanTransactions').get().status, 'Returned');
  assert.deepEqual({ ...f.sqlite.prepare('SELECT status, condition FROM Assets').get() }, { status: 'Sent for Repair', condition: 'Fair' });
  const records = await f.api.listReturns();
  assert.equal(records.loans.length, 0); assert.equal(records.returns.length, 1);
  assert.equal(records.returns[0].previousCondition, 'Good'); assert.equal(records.returns[0].staffID, 'MITS-01');
  assert.match(f.sqlite.prepare('SELECT body FROM ReturnEmailOutbox').get().body, /Previous condition: Good/);
  f.sqlite.close();
});
test('duplicate and simultaneous check-ins create exactly one return', async () => {
  const f = fixture(); await f.api.ready; f.seed();
  const results = await Promise.allSettled([f.api.checkIn(1, input, staff), f.api.checkIn(1, input, staff)]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.find(result => result.status === 'rejected').reason.status, 409);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS total FROM AssetReturns').get().total, 1);
  f.sqlite.close();
});
test('invalid inspection or unauthorized staff never change inventory', async () => {
  const f = fixture(); await f.api.ready; f.seed();
  for (const bad of [{ ...input, condition: 'Broken' }, { ...input, assetStatus: 'Borrowed' }, { ...input, received: false }, { ...input, notes: 'x'.repeat(1001) }]) {
    await assert.rejects(f.api.checkIn(1, bad, staff), error => error.status === 400);
  }
  await assert.rejects(f.api.checkIn(1, input, null), error => error.status === 403);
  await assert.rejects(f.api.checkIn('not-an-id', input, staff), error => error.status === 400);
  await assert.rejects(f.api.checkIn(999, input, staff), error => error.status === 404);
  assert.equal(f.sqlite.prepare('SELECT status FROM Assets').get().status, 'On Loan'); f.sqlite.close();
});
test('email outbox storage failure rolls back all check-in changes', async () => {
  const f = fixture(); await f.api.ready; f.seed(); f.failNextEmail();
  await assert.rejects(f.api.checkIn(1, input, staff), /Simulated disk failure/);
  assert.equal(f.sqlite.prepare('SELECT status FROM Assets').get().status, 'On Loan');
  assert.equal(f.sqlite.prepare('SELECT status FROM LoanTransactions').get().status, 'Active');
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS total FROM AssetReturns').get().total, 0); f.sqlite.close();
});
test('missing equipment can be recovered and returned to availability', async () => {
  const f = fixture(); await f.api.ready; f.seed();
  f.sqlite.exec("UPDATE Assets SET status = 'Missing'; UPDATE LoanTransactions SET status = 'Missing'");
  await f.api.checkIn(1, { ...input, condition: 'Good', assetStatus: 'Available' }, staff);
  assert.equal(f.sqlite.prepare('SELECT status FROM Assets').get().status, 'Available'); f.sqlite.close();
});
test('API denies access when authentication has not been connected', async () => {
  const f = fixture(); await f.api.ready;
  let code, body;
  f.middleware[1]({}, { status(value) { code = value; return this; }, json(value) { body = value; } });
  assert.equal(code, 401); assert.match(body.error, /sign-in/); f.sqlite.close();
});
test('demo returns are isolated, immutable, validated, and reject duplicate check-in', () => {
  const initial = { loans: [{ transactionID: 1, status: 'Active', dueDate: '2026-01-10', condition: 'Good' }], returns: [] };
  const next = model.recordDemoReturn(initial, 1, input, 'Demo Staff');
  assert.equal(initial.loans[0].status, 'Active'); assert.equal(next.loans[0].status, 'Returned');
  assert.equal(next.returns[0].emailStatus, 'Demo — not sent');
  assert.throws(() => model.recordDemoReturn(next, 1, input, 'Demo Staff'), /no longer outstanding/);
  assert.throws(() => model.recordDemoReturn(initial, 1, input, ' '), /staff name/);
  assert.equal(model.loanState(initial.loans[0], '2026-01-10'), 'On Loan');
  assert.equal(model.loanState(initial.loans[0], '2026-01-11'), 'Overdue');
});


test('TS1.1A and TS1.2A: valid corrections persist while original history is retained', async () => {
  const f = fixture(); await f.api.ready; f.seed(); await f.api.checkIn(1, input, staff);
  await f.api.correctHistory(1, { condition: 'Poor', notes: 'Battery damaged', reason: 'Inspection corrected', revision: 0 }, staff);
  const result = await f.api.listReturns(); assert.equal(result.returns[0].correctedCondition, 'Poor');
  assert.equal(result.returns[0].correctedNotes, 'Battery damaged');
  assert.equal(f.sqlite.prepare('SELECT condition FROM AssetReturns').get().condition, 'Fair');
  assert.equal(f.sqlite.prepare('SELECT staffID FROM ReturnHistoryCorrections').get().staffID, staff.staffID);
  await assert.rejects(f.api.correctHistory(1, { condition: 'Good', notes: '', reason: 'Stale edit', revision: 0 }, staff), error => error.status === 409);
  f.sqlite.close();
});
test('TS1.1B: invalid history correction leaves all saved history unchanged', async () => {
  const f = fixture(); await f.api.ready; f.seed(); await f.api.checkIn(1, input, staff);
  for (const value of [{ condition: 'Invalid', notes: '', reason: 'test', revision: 0 }, { condition: 'Good', notes: '', reason: '', revision: 0 }]) {
    await assert.rejects(f.api.correctHistory(1, value, staff), error => error.status === 400);
  }
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM ReturnHistoryCorrections').get().n, 0); f.sqlite.close();
});
test('TS1.2B: malformed overdue searches are rejected without changing records', async () => {
  const f = fixture(); await f.api.ready; f.seed();
  await assert.rejects(f.api.listReturns({ search: '<script>' }), error => error.status === 400);
  await assert.rejects(f.api.listReturns({ search: 'x'.repeat(101) }), error => error.status === 400);
  assert.equal((await f.api.listReturns({ search: 'Brown' })).loans.length, 1); f.sqlite.close();
});
test('TS1.3A: confirmation contains original and returned conditions and records test capture', async () => {
  const delivered = []; const f = fixture({ sendEmail: async message => { delivered.push(message); return { captured: true, previewUrl: 'https://ethereal.email/message/test' }; } });
  await f.api.ready; f.seed(); await f.api.checkIn(1, input, staff);
  await f.api.processDueEmails(); assert.equal(delivered.length, 1);
  assert.match(delivered[0].text, /Previous condition: Good/); assert.match(delivered[0].text, /Condition on return: Fair/);
  assert.equal((await f.api.listEvidence()).emails[0].status, 'Captured');
  await f.api.processDueEmails(); assert.equal(delivered.length, 1); f.sqlite.close();
});
test('TS1.3B: invalid return creates no history or email', async () => {
  const delivered = []; const f = fixture({ sendEmail: async message => { delivered.push(message); return {}; } });
  await f.api.ready; f.seed();
  await assert.rejects(f.api.checkIn(1, { ...input, received: false }, staff), error => error.status === 400);
  assert.equal((await f.api.listEvidence()).emails.length, 0); assert.equal(delivered.length, 0); f.sqlite.close();
});
test('TS1.4A: custom labels generate emails only at their scheduled times and do not repeat', async () => {
  let now = new Date('2030-01-01T12:00:00.000Z'); const messages = [];
  const f = fixture({ clock: () => now, sendEmail: async message => { messages.push(message); return { captured: true }; } });
  await f.api.ready; f.seed();
  await f.api.scheduleReminders(1, { borrowedAt: '2030-01-01T12:01:00.000Z', overdueAt: '2030-01-01T12:02:00.000Z', missingAt: '2030-01-01T12:03:00.000Z' }, staff);
  await f.api.processDueEmails(); assert.equal(messages.length, 0);
  for (const [minute, tag] of [['01', 'Borrowed'], ['02', 'Overdue'], ['03', 'Missing']]) {
    now = new Date(`2030-01-01T12:${minute}:00.000Z`); await f.api.processDueEmails(); assert.match(messages.at(-1).subject, new RegExp(tag));
  }
  assert.equal(messages.length, 3); await f.api.processDueEmails(); assert.equal(messages.length, 3);
  assert.equal((await f.api.listEvidence()).emails.filter(email => email.administeredAt).length, 3); f.sqlite.close();
});
test('TS1.4B: past, impossible, and out-of-order reminder dates save nothing', async () => {
  const f = fixture({ clock: () => new Date('2030-01-01T12:00:00.000Z') }); await f.api.ready; f.seed();
  const valid = { borrowedAt: '2030-01-01T12:01:00.000Z', overdueAt: '2030-01-01T12:02:00.000Z', missingAt: '2030-01-01T12:03:00.000Z' };
  for (const value of [{ ...valid, borrowedAt: '2029-01-01T12:00:00.000Z' }, { ...valid, overdueAt: valid.borrowedAt }, { ...valid, missingAt: '2030-02-31T12:00:00.000Z' }]) {
    await assert.rejects(f.api.scheduleReminders(1, value, staff), error => error.status === 400);
  }
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM ReturnReminderEvents').get().n, 0); f.sqlite.close();
});
test('returning equipment cancels unsent custom reminders and email failure preserves the return', async () => {
  const f = fixture({ clock: () => new Date('2030-01-01T12:00:00.000Z'), sendEmail: async () => { throw new Error('Test SMTP outage'); } });
  await f.api.ready; f.seed();
  await f.api.scheduleReminders(1, { borrowedAt: '2030-01-01T12:01:00.000Z', overdueAt: '2030-01-01T12:02:00.000Z', missingAt: '2030-01-01T12:03:00.000Z' }, staff);
  await f.api.checkIn(1, input, staff); await f.api.processDueEmails();
  assert.equal(f.sqlite.prepare('SELECT status FROM LoanTransactions').get().status, 'Returned');
  assert.equal(f.sqlite.prepare('SELECT status FROM ReturnEmailOutbox').get().status, 'Failed');
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM ReturnReminderEvents WHERE status='Cancelled'").get().n, 3); f.sqlite.close();
});


async function routeFixture(t) {
  const express = require('express'); const f = fixture(); await f.api.ready; f.seed();
  const app = express(); const delivered = [];
  const api = registerReturns(app, f.db, { router: express.Router(), json: express.json,
    authorize(req, res, next) { req.user = staff; next(); },
    sendEmail: async message => { delivered.push(message); return { captured: true }; } });
  await api.ready; const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  t.after(async () => { await new Promise(resolve => server.close(resolve)); api.stop(); f.sqlite.close(); });
  const base = `http://127.0.0.1:${server.address().port}/api/returns`;
  return { ...f, api, delivered,
    request: (path, body) => fetch(base + path, { ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) }) };
}
test('HTTP: invalid inspection is rejected and valid history can be corrected and reloaded', async t => {
  const f = await routeFixture(t);
  assert.equal((await f.request('/1', { ...input, condition: 'Invalid' })).status, 400);
  assert.equal((await f.request('/1', input)).status, 200);
  assert.equal((await f.request('/history/1/corrections', { condition: 'Poor', notes: 'Rechecked', reason: 'Inspection correction', revision: 0 })).status, 200);
  const data = await (await f.request('')).json(); assert.equal(data.returns[0].correctedCondition, 'Poor');
  const emails = await (await f.request('/emails')).json(); assert.match(emails.emails[0].body, /Previous condition: Good/);
  assert.equal((await f.request('/emails/return/1/send', {})).status, 200);
  assert.equal(f.delivered.length, 1); assert.equal((await (await f.request('/emails')).json()).emails[0].status, 'Captured');
});
test('HTTP: overdue search validates input and future reminder dates are persisted', async t => {
  const f = await routeFixture(t);
  assert.equal((await f.request('?search=%3Cscript%3E')).status, 400);
  assert.equal((await (await f.request('?search=not-found&overdueOnly=true')).json()).loans.length, 0);
  const date = minutes => new Date(Date.now() + minutes * 60000).toISOString();
  assert.equal((await f.request('/reminders/1', { borrowedAt: date(-1), overdueAt: date(2), missingAt: date(3) })).status, 400);
  assert.equal((await f.request('/reminders/1', { borrowedAt: date(1), overdueAt: date(2), missingAt: date(3) })).status, 200);
  assert.equal((await (await f.request('/emails')).json()).emails.length, 3);
});
