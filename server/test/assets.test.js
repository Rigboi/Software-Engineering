'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { createApplication } = require('../server');

async function fixture(t, options = {}) {
  const runtime = await createApplication({ loanFile: ':memory:', maintenanceFile: ':memory:', ...options });
  const server = runtime.app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await runtime.close(); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  let cookie = '';
  const request = (url, body, method = body === undefined ? 'GET' : 'POST') => fetch(origin + url, {
    method, headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const signup = await request('/api/auth/signup', { name: 'Asset Staff', loginID: '620177693', password: 'a-long-test-password' });
  if (signup.status === 201) cookie = signup.headers.get('set-cookie').split(';')[0];
  else {
    const login = await request('/api/auth/login', { loginID: '620177693', password: 'a-long-test-password' });
    assert.equal(login.status, 200); cookie = login.headers.get('set-cookie').split(';')[0];
  }
  return { ...runtime, request, server };
}
const asset = { tagId: 'TAG-1001', assetName: 'Dell Latitude', serialNumber: 'SN-001', deviceType: 'Laptop',
  purchaseDate: '2026-01-01', condition: 'Good', location: 'IT Storage Room', warrantyDate: '2027-01-01' };
async function create(f, value = asset) { const response = await f.request('/api/assets', value); assert.equal(response.status, 201); return response.json(); }

test('registered inventory is shared by borrowing, storage, maintenance, and warranty data', async t => {
  const f = await fixture(t); const saved = await create(f);
  assert.equal(saved.status, 'Available');
  const loans = await (await f.request('/api/loans/assets')).json(); assert.equal(loans[0].assetName, asset.assetName);
  const storage = await (await f.request('/api/storage')).json(); assert.equal(storage.assets[0].location, asset.location);
  const maintenance = await (await f.request('/api/maintenance/assets')).json(); assert.equal(maintenance.assets[0].tag_id, asset.tagId);
  const warranty = await (await f.request('/api/assets')).json(); assert.equal(warranty[0].warrantyDate, asset.warrantyDate);
  const task = await f.request('/api/maintenance', { description: 'Inspect', equipment: asset.tagId, assigned_staff: 'Asset Staff', scheduled_date: '2027-01-01' });
  assert.equal(task.status, 201); assert.equal((await task.json()).asset.device_name, asset.assetName);
});
test('edits persist, update all readers, record relocation, and retain loan status', async t => {
  const f = await fixture(t); const saved = await create(f);
  const checkout = await f.request('/api/loans/checkout', { assetID: asset.tagId, borrowerName: 'Borrower', borrowerID: '101', borrowerEmail: 'b@uwi.edu', dueDate: '2099-01-01' });
  assert.equal(checkout.status, 200);
  const current = await (await f.request('/api/assets/' + asset.tagId)).json();
  const edited = await f.request('/api/assets/' + asset.tagId, { ...current, assetName: 'Renamed laptop', location: 'Computer Lab' }, 'PUT');
  assert.equal(edited.status, 200); assert.equal((await edited.json()).status, 'On Loan');
  const storage = await (await f.request('/api/storage')).json(); assert.equal(storage.history[0].previousLocation, asset.location);
  assert.equal(storage.history[0].staffMember, 'Asset Staff');
  const stale = await f.request('/api/assets/' + asset.tagId, { ...saved, assetName: 'Stale edit' }, 'PUT'); assert.equal(stale.status, 409);
  assert.equal(f.store.native.prepare('SELECT COUNT(*) AS n FROM AssetChanges').get().n, 2);
});
test('server validation rejects duplicate tags and serials and prevents partial invalid edits', async t => {
  const f = await fixture(t); const saved = await create(f);
  assert.equal((await f.request('/api/assets', asset)).status, 409);
  assert.equal((await f.request('/api/assets', { ...asset, tagId: 'TAG-1002' })).status, 409);
  assert.equal((await f.request('/api/assets', { ...asset, tagId: 'tag-1001', serialNumber: 'SN-002' })).status, 409);
  assert.equal((await f.request('/api/assets/' + asset.tagId, { ...saved, purchaseDate: '2026-02-31' }, 'PUT')).status, 400);
  assert.equal((await f.request('/api/assets/' + asset.tagId, { ...saved, tagId: 'NEW-TAG' }, 'PUT')).status, 400);
  assert.equal((await (await f.request('/api/assets/' + asset.tagId)).json()).assetName, asset.assetName);
});
test('storage relocations modify the same inventory and survive page reloads', async t => {
  const f = await fixture(t); const saved = await create(f);
  const moved = await f.request('/api/storage/relocations', { assetID: asset.tagId, newLocation: 'Main Office', version: saved.version });
  assert.equal(moved.status, 200);
  assert.equal((await (await f.request('/api/assets/' + asset.tagId)).json()).location, 'Main Office');
  const history = await (await f.request('/api/storage')).json(); assert.equal(history.history.length, 1);
  assert.equal((await f.request('/api/storage/relocations', { assetID: asset.tagId, newLocation: 'Computer Lab', version: saved.version })).status, 409);
});
test('browser import is atomic and never silently overwrites existing inventory', async t => {
  const f = await fixture(t); await create(f);
  const other = { ...asset, tagId: 'TAG-2', serialNumber: 'SN-2' };
  assert.equal((await f.request('/api/assets/import', { assets: [other, asset] })).status, 409);
  assert.equal((await (await f.request('/api/assets')).json()).length, 1);
  assert.equal((await f.request('/api/assets/import', { assets: [other] })).status, 201);
});
test('return condition is visible in inventory and invalidates older edit forms', async t => {
  const f = await fixture(t); await create(f);
  const checkout = await f.request('/api/loans/checkout', { assetID: asset.tagId, borrowerName: 'B', borrowerID: '101', borrowerEmail: 'b@uwi.edu', dueDate: '2099-01-01' });
  const { transactionID } = await checkout.json(); const before = await (await f.request('/api/assets/' + asset.tagId)).json();
  assert.equal((await f.request('/api/returns/' + transactionID, { condition: 'Poor', assetStatus: 'Sent for Repair', notes: 'Damaged', received: true })).status, 200);
  const after = await (await f.request('/api/assets/' + asset.tagId)).json(); assert.equal(after.condition, 'Poor'); assert.equal(after.status, 'Sent for Repair');
  assert.equal((await f.request('/api/assets/' + asset.tagId, before, 'PUT')).status, 409);
});
test('inventory survives restarting the application against the same database', async t => {
  const directory = mkdtempSync(path.join(tmpdir(), 'wjc-assets-'));
  const file = path.join(directory, 'assets.sqlite');
  const f = await fixture(t, { loanFile: file });
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  await create(f);
  const reopened = await createApplication({ loanFile: file, maintenanceFile: ':memory:' });
  try { assert.equal(reopened.store.native.prepare('SELECT assetName FROM Assets WHERE assetID = ?').get(asset.tagId).assetName, asset.assetName); }
  finally { await reopened.close(); }
});
