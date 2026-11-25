// Automated tests for Feature 06 - one test per SRS scenario TS-01 .. TS-13.
// "Today" is fixed to 4 Nov 2026 so date-based behaviour is reliable (QA-08).
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os'); const path = require('path'); const fs = require('fs');
const { openDatabase } = require('../src/db');
const { createMaintenanceService, ValidationError, EMPTY_MESSAGE } = require('../src/maintenanceService');

const TODAY = new Date(2026, 10, 4, 9, 0, 0); // 4 Nov 2026, local time
const fresh = () => { const db = openDatabase(':memory:');
  db.exec("INSERT INTO assets (tag_id, device_name) VALUES ('TAG-1001', 'Dell Latitude laptop'), ('TAG-1002', 'HP projector')");
  return { db, svc: createMaintenanceService(db, () => TODAY) }; };
const valid = { description: 'Replace Laptop battery', equipment: 'TAG-1001', scheduled_date: '2026-11-05', assigned_staff: 'J. Brown' };
const count = (db) => db.prepare('SELECT COUNT(*) n FROM maintenance_tasks').get().n;
const rejects = (fn) => assert.throws(fn, ValidationError);
const fieldsOf = (fn) => { try { fn(); } catch (e) { return e.errors.map((x) => x.field); } return null; };

test('TS-01 creating a task shows it in the schedule with status Pending', () => {
  const { svc } = fresh();
  svc.createTask(valid);
  const { tasks } = svc.listTasks();
  assert.equal(tasks.length, 1);
  assert.deepEqual([tasks[0].description, tasks[0].equipment, tasks[0].scheduled_date, tasks[0].assigned_staff, tasks[0].status],
    ['Replace Laptop battery', 'TAG-1001', '2026-11-05', 'J. Brown', 'Pending']);
});

test('TS-02 saved task is still shown after leaving and reopening the schedule', () => {
  const file = path.join(os.tmpdir(), `wjc_ts02_${Date.now()}.db`);
  const db1 = openDatabase(file); createMaintenanceService(db1, () => TODAY).createTask(valid); db1.close();
  const db2 = openDatabase(file);                       // "reopen"
  const { tasks } = createMaintenanceService(db2, () => TODAY).listTasks();
  assert.equal(tasks.length, 1); assert.equal(tasks[0].status, 'Pending');
  db2.close(); fs.unlinkSync(file);
});

test('TS-03 task with no assigned staff is rejected, names the staff field, saves nothing', () => {
  const { db, svc } = fresh();
  assert.deepEqual(fieldsOf(() => svc.createTask({ ...valid, assigned_staff: '' })), ['assigned_staff']);
  assert.deepEqual(fieldsOf(() => svc.createTask({ ...valid, assigned_staff: undefined })), ['assigned_staff']);
  assert.equal(count(db), 0);
});

test('TS-04 invalid scheduled date (31 Feb 2026, letters) is rejected on create and update', () => {
  const { db, svc } = fresh();
  for (const bad of ['2026-02-31', 'abc', '31 Feb 2026', '2026-13-01']) {
    assert.deepEqual(fieldsOf(() => svc.createTask({ ...valid, scheduled_date: bad })), ['scheduled_date'], bad);
  }
  assert.equal(count(db), 0);
  const t = svc.createTask(valid);
  assert.deepEqual(fieldsOf(() => svc.updateTask(t.id, { scheduled_date: '2026-02-31' })), ['scheduled_date']);
  assert.equal(svc.getTask(t.id).scheduled_date, '2026-11-05');   // unchanged
});

test('TS-05 with three tasks recorded, each is listed with all fields', () => {
  const { svc } = fresh();
  svc.createTask(valid);
  svc.createTask({ ...valid, description: 'Clean vents', equipment: 'Server room', assigned_staff: 'A. Lee' });
  svc.createTask({ ...valid, description: 'Update firmware', equipment: 'Router 1', assigned_staff: 'K. Reid' });
  const { tasks, message } = svc.listTasks();
  assert.equal(tasks.length, 3); assert.equal(message, null);
  for (const t of tasks) for (const k of ['description', 'equipment', 'scheduled_date', 'assigned_staff', 'status']) assert.ok(t[k], k);
});

test('TS-06 with no tasks the schedule shows the empty message', () => {
  const { svc } = fresh();
  const r = svc.listTasks();
  assert.equal(r.tasks.length, 0);
  assert.equal(r.message, 'No maintenance tasks are currently scheduled');
  assert.equal(r.message, EMPTY_MESSAGE);
});

test('TS-07 changing the date from 5 Nov to 12 Nov 2026 shows 12 Nov when viewed again', () => {
  const { svc } = fresh();
  const t = svc.createTask(valid);
  svc.updateTask(t.id, { scheduled_date: '2026-11-12' });
  assert.equal(svc.getTask(t.id).scheduled_date, '2026-11-12');
  assert.equal(svc.listTasks().tasks[0].scheduled_date, '2026-11-12');
});

test('TS-08 changing description and assigned staff saves and shows both changes', () => {
  const { svc } = fresh();
  const t = svc.createTask(valid);
  svc.updateTask(t.id, { description: 'Replace water filter', assigned_staff: 'M. Clarke' });
  const r = svc.getTask(t.id);
  assert.equal(r.description, 'Replace water filter'); assert.equal(r.assigned_staff, 'M. Clarke');
  assert.equal(r.equipment, 'TAG-1001');   // untouched fields stay the same
});

test('TS-09 changing Pending to Completed and saving shows Completed', () => {
  const { svc } = fresh();
  const t = svc.createTask(valid);
  assert.equal(svc.setStatus(t.id, 'Completed').status, 'Completed');
  assert.equal(svc.getTask(t.id).status, 'Completed');
  rejects(() => svc.setStatus(t.id, 'Done'));      // only Pending or Completed allowed
});

test('TS-10 Completed status is still shown after leaving and reopening', () => {
  const file = path.join(os.tmpdir(), `wjc_ts10_${Date.now()}.db`);
  const db1 = openDatabase(file); const s1 = createMaintenanceService(db1, () => TODAY);
  const t = s1.createTask(valid); s1.setStatus(t.id, 'Completed'); db1.close();
  const db2 = openDatabase(file);
  assert.equal(createMaintenanceService(db2, () => TODAY).listTasks().tasks[0].status, 'Completed');
  db2.close(); fs.unlinkSync(file);
});

test('TS-11 a Pending task scheduled yesterday shows the Overdue tag', () => {
  const { svc } = fresh();
  svc.createTask({ ...valid, scheduled_date: '2026-11-03' });
  assert.equal(svc.listTasks().tasks[0].overdue, true);
});

test('TS-12 a Completed task scheduled yesterday does not show the Overdue tag', () => {
  const { svc } = fresh();
  const t = svc.createTask({ ...valid, scheduled_date: '2026-11-03' });
  svc.setStatus(t.id, 'Completed');
  assert.equal(svc.listTasks().tasks[0].overdue, false);
});

test('TS-13 a Pending task scheduled for today (or later) does not show the Overdue tag', () => {
  const { svc } = fresh();
  svc.createTask({ ...valid, scheduled_date: '2026-11-04' });
  svc.createTask({ ...valid, scheduled_date: '2026-11-05' });
  assert.deepEqual(svc.listTasks().tasks.map((t) => t.overdue), [false, false]);
});

// ---- asset ID support: equipment can be an asset Tag ID ----
test('equipment that is a registered Tag ID is linked to the asset (any letter case) and shows the device name', () => {
  const { svc } = fresh();
  const t = svc.createTask({ ...valid, equipment: ' tag-1001 ' });
  assert.equal(t.equipment, 'TAG-1001');
  assert.deepEqual(t.asset, { tag_id: 'TAG-1001', device_name: 'Dell Latitude laptop' });
  assert.equal(svc.updateTask(t.id, { equipment: 'tag-1002' }).asset.device_name, 'HP projector');
  assert.deepEqual(svc.listAssets().map((a) => a.tag_id), ['TAG-1001', 'TAG-1002']);
});

test('equipment that is not a registered Tag ID (e.g. a facility) is still accepted, with no asset link', () => {
  const { svc } = fresh();
  const t = svc.createTask({ ...valid, equipment: 'Server Room A' });
  assert.equal(t.equipment, 'Server Room A'); assert.equal(t.asset, null);
});

// ---- extra checks for QA-02 (no partial saves) and the HTTP layer ----
test('a rejected update changes nothing (no partial update)', () => {
  const { svc } = fresh();
  const t = svc.createTask(valid);
  rejects(() => svc.updateTask(t.id, { description: 'New text', scheduled_date: 'bad' }));
  assert.equal(svc.getTask(t.id).description, 'Replace Laptop battery');
});

test('HTTP API: 401 without sign-in, 400 names the field, 201 on success, empty message', async () => {
  const { createServer } = require('../src/server');
  const server = createServer(openDatabase(':memory:'), () => TODAY, req => req.headers['x-user'] ? { ok: true, user: req.headers['x-user'] } : { ok: false, status: 401, message: 'Please log in.' });
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}/api/maintenance`;
  const H = { 'Content-Type': 'application/json', 'X-User': 'jsmith' };
  try {
    assert.equal((await fetch(base)).status, 401);
    const empty = await (await fetch(base, { headers: H })).json();
    assert.equal(empty.message, EMPTY_MESSAGE);
    const bad = await fetch(base, { method: 'POST', headers: H, body: JSON.stringify({ ...valid, assigned_staff: '' }) });
    assert.equal(bad.status, 400); assert.equal((await bad.json()).errors[0].field, 'assigned_staff');
    const ok = await fetch(base, { method: 'POST', headers: H, body: JSON.stringify(valid) });
    assert.equal(ok.status, 201); assert.equal((await ok.json()).status, 'Pending');
    assert.equal((await fetch(`${base}/999`, { headers: H })).status, 404);
  } finally { server.close(); }
});
