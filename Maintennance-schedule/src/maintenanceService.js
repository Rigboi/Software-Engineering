// Maintenance Scheduling component (Feature 06). Talks only to the Asset Database.
const { validateTask, isOverdue, toISODate } = require('./maintenanceRules');
const { createAssetLookup } = require('./assetLookup');

const EMPTY_MESSAGE = 'No maintenance tasks are currently scheduled';

class ValidationError extends Error {
  constructor(errors) { super(errors.map((e) => e.message).join(' ')); this.errors = errors; }
}
class NotFoundError extends Error {}

/**
 * @param db    DatabaseSync from openDatabase()
 * @param clock () => Date. Injectable so "today" can be controlled in tests (QA-08).
 * @param assets read-only asset lookup. Equipment that is a registered asset Tag ID is linked to that asset.
 */
function createMaintenanceService(db, clock = () => new Date(), assets = createAssetLookup(db)) {
  const today = () => toISODate(clock());
  const now = () => clock().toISOString();


  // Several writes happen as ONE transaction; roll back on any failure (QA-02).
  const transaction = (fn) => {
    db.exec('BEGIN');
    try { const r = fn(); db.exec('COMMIT'); return r; }
    catch (e) { db.exec('ROLLBACK'); throw e; }
  };

  const decorate = (row) => ({ ...row, overdue: isOverdue(row, today()), asset: assets.find(row.equipment) });
  // A registered Tag ID (any letter case) is stored in its official form; anything else (e.g. a facility) is kept as typed.
  const canonicalEquipment = (value) => { const a = assets.find(value); return a ? a.tag_id : String(value).trim(); };
  const getRow = (id) => db.prepare('SELECT * FROM maintenance_tasks WHERE id = ?').get(id);

  return {
    /** SR-01, SR-02, SR-05 (new tasks start Pending). */
    createTask(input) {
      const errors = validateTask(input);
      if (errors.length) throw new ValidationError(errors); // nothing saved
      return transaction(() => {
        const t = now();
        const { lastInsertRowid } = db.prepare(
          `INSERT INTO maintenance_tasks (description, equipment, scheduled_date, assigned_staff, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'Pending', ?, ?)`)
          .run(input.description.trim(), canonicalEquipment(input.equipment), input.scheduled_date.trim(), input.assigned_staff.trim(), t, t);
        const row = getRow(Number(lastInsertRowid));
        return decorate(row);
      });
    },

    /** SR-03 + empty-schedule message (AC-03), ordered by date. */
    listTasks() {
      const tasks = db.prepare('SELECT * FROM maintenance_tasks ORDER BY scheduled_date, id').all().map(decorate);
      return { tasks, message: tasks.length ? null : EMPTY_MESSAGE };
    },

    /** Registered assets, offered as Tag ID suggestions. */
    listAssets() { return assets.list(); },

    getTask(id) {
      const row = getRow(id);
      if (!row) throw new NotFoundError(`Maintenance task ${id} was not found.`);
      return decorate(row);
    },

    /** SR-04 / SR-05. Any subset of fields, including status. All-or-nothing. */
    updateTask(id, changes) {
      const before = getRow(id);
      if (!before) throw new NotFoundError(`Maintenance task ${id} was not found.`);
      const errors = validateTask(changes, { partial: true });
      if (errors.length) throw new ValidationError(errors);
      const merged = { ...before };
      for (const k of ['description', 'equipment', 'scheduled_date', 'assigned_staff']) {
        if (changes[k] !== undefined) merged[k] = String(changes[k]).trim();
      }
      if (changes.equipment !== undefined) merged.equipment = canonicalEquipment(changes.equipment);
      if (changes.status !== undefined) merged.status = changes.status;
      return transaction(() => {
        db.prepare(`UPDATE maintenance_tasks SET description=?, equipment=?, scheduled_date=?, assigned_staff=?, status=?, updated_at=? WHERE id=?`)
          .run(merged.description, merged.equipment, merged.scheduled_date, merged.assigned_staff, merged.status, now(), id);
        const after = getRow(id);
        return decorate(after);
      });
    },

    setStatus(id, status) { return this.updateTask(id, { status }); },
  };
}

module.exports = { createMaintenanceService, ValidationError, NotFoundError, EMPTY_MESSAGE };
