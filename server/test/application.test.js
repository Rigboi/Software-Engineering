'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createApplication } = require('../server');

async function fixture(t, options = {}) {
  const runtime = await createApplication({ loanFile: ':memory:', maintenanceFile: ':memory:',
    clock: () => new Date(2026, 10, 25, 12), ...options });
  const server = runtime.app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await runtime.close(); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  return { ...runtime, origin,
    get: url => fetch(origin + url),
    post: (url, body, headers = {}) => fetch(origin + url, { method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) }) };
}
const authenticate = (req, res, next) => { req.user = { staffID: 'TEST-01', name: 'Test Staff' }; next(); };
const loan = { assetID: 'WJC-001', borrowerName: 'J. Brown', borrowerID: '101', borrowerEmail: 'j@example.com', dueDate: '2026-12-01' };
const returned = { condition: 'Fair', assetStatus: 'Sent for Repair', notes: 'Battery issue', received: true };
function seed(f) { f.store.native.exec("INSERT INTO Assets (assetID, assetName, status, condition) VALUES ('WJC-001', 'Laptop', 'Available', 'Good')"); }

test('one server serves all pages and reports unknown API routes as JSON', async t => {
  const f = await fixture(t, { authenticate });
  for (const page of ['/', '/loaning', '/returns', '/maintenance', '/pages/Warranty-Report/index.html', '/pages/Storage-Management/index.html']) {
    const response = await f.get(page); assert.equal(response.status, 200, page);
    assert.match(response.headers.get('content-type'), /text\/html/);
  }
  assert.equal((await f.get('/health')).status, 200);
  const missing = await f.get('/api/unknown'); assert.equal(missing.status, 404); assert.match((await missing.json()).error, /not found/);
});
test('mounted maintenance parser handles POST and PATCH after combining servers', async t => {
  const f = await fixture(t, { authenticate });
  const response = await f.post('/api/maintenance', { description: 'Battery check', equipment: 'Facility A', scheduled_date: '2026-12-01', assigned_staff: 'J. Brown' }, { 'X-User': 'Test Staff' });
  assert.equal(response.status, 201); const task = await response.json();
  const update = await fetch(f.origin + '/api/maintenance/' + task.id, { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'X-User': 'Test Staff' }, body: JSON.stringify({ status: 'Completed' }) });
  assert.equal(update.status, 200); assert.equal((await update.json()).status, 'Completed');
});
test('real loan and return APIs share records; duplicate checkout and return are rejected', async t => {
  const f = await fixture(t, { authenticate }); seed(f);
  const checkouts = await Promise.all([f.post('/api/loans/checkout', loan), f.post('/api/loans/checkout', loan)]);
  assert.deepEqual(checkouts.map(result => result.status).sort(), [200, 400]);
  const checked = await checkouts.find(result => result.status === 200).json();
  const history = await (await f.get('/api/loans/history?search=Brown')).json();
  assert.equal(history.length, 1); assert.equal(history[0].flagged, false);
  assert.equal((await (await f.get('/api/returns')).json()).loans.length, 1);
  assert.equal((await f.post(`/api/returns/${checked.transactionID}`, returned)).status, 200);
  assert.equal((await f.post(`/api/returns/${checked.transactionID}`, returned)).status, 409);
  const records = await (await f.get('/api/returns')).json();
  assert.equal(records.loans.length, 0); assert.equal(records.returns[0].emailStatus, 'Pending');
  const summary = await (await f.get('/api/loans/summary')).json(); assert.equal(summary.counts['Sent for Repair'], 1);
  assert.equal((await f.post(`/api/loans/return/${checked.transactionID}`, {})).status, 410);
});
test('failed checkout insert rolls back the asset availability update', async t => {
  const f = await fixture(t, { authenticate }); seed(f);
  f.store.native.exec("CREATE TRIGGER reject_loan BEFORE INSERT ON LoanTransactions BEGIN SELECT RAISE(ABORT, 'test failure'); END");
  assert.equal((await f.post('/api/loans/checkout', loan)).status, 500);
  assert.equal(f.store.native.prepare('SELECT status FROM Assets').get().status, 'Available');
});
test('checkout rejects impossible dates and malformed email addresses', async t => {
  const f = await fixture(t, { authenticate }); seed(f);
  assert.equal((await f.post('/api/loans/checkout', { ...loan, dueDate: '2027-02-31' })).status, 400);
  assert.equal((await f.post('/api/loans/checkout', { ...loan, borrowerEmail: 'invalid' })).status, 400);
});
test('daily check marks overdue and missing records without pretending emails were sent', async t => {
  const f = await fixture(t, { authenticate }); seed(f);
  const response = await f.post('/api/loans/checkout', loan); assert.equal(response.status, 200);
  f.store.native.exec("UPDATE LoanTransactions SET dueDate = '2026-10-24'");
  await f.loans.runDailyCheck();
  const history = await (await f.get('/api/loans/history')).json();
  assert.equal(history[0].state, 'Missing'); assert.equal(history[0].overdueEmailSent, 0);
});
test('loan and return APIs require a verified account by default', async t => {
  const f = await fixture(t);
  assert.equal((await f.get('/api/loans/assets')).status, 401);
  assert.equal((await f.get('/api/returns')).status, 401);
});
test('warranty email retains its parser and has explicit unavailable and success responses', async t => {
  const f = await fixture(t, { authenticate });
  assert.equal((await f.post('/api/warranty-email', {})).status, 400);
  const devices = [{ tagId: 'WJC-001', deviceType: 'Laptop', warrantyDate: '2026-12-01' }];
  assert.equal((await f.post('/api/warranty-email', { devices })).status, 503);
  const sent = [];
  const connected = await fixture(t, { authenticate, transporter: { async sendMail(message) { sent.push(message); return { messageId: 'test' }; } } });
  assert.equal((await connected.post('/api/warranty-email', { devices })).status, 200); assert.equal(sent.length, 1);
});
