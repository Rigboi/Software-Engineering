'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const registerReturns = require('./returnFeature');
const model = require('./return-model');

function fixture() {
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
  const api = registerReturns({ use() {}, get() {} }, db, { router, json: () => (req, res, next) => next() });
  const seed = () => {
    sqlite.exec(`INSERT INTO Assets (assetID, assetName, status, condition) VALUES ('WJC-001', 'Laptop', 'On Loan', 'Good');
      INSERT INTO LoanTransactions (assetID, borrowerName, borrowerID, borrowerEmail, checkOutDate, dueDate)
      VALUES ('WJC-001', 'J. Brown', '101', 'j@example.com', '2026-01-01', '2026-01-10');`);
  };
  return { sqlite, api, seed, middleware, failNextEmail() { failEmail = true; } };
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
