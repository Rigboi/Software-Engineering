// Business rules for Feature 06, kept in ONE module (QA-07): validation + overdue rule.
const FIELDS = [
  { key: 'description',    label: 'Description' },
  { key: 'equipment',      label: 'Equipment or facility' },
  { key: 'scheduled_date', label: 'Scheduled date' },
  { key: 'assigned_staff', label: 'Assigned staff member' },
];
const STATUSES = ['Pending', 'Completed'];

/** Strict yyyy-mm-dd check that rejects letters and impossible dates (e.g. 2026-02-31). */
function isValidDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/**
 * SR-01/SR-02. Returns [{field, message}] naming each wrong field.
 * For updates pass {partial:true}: only the supplied fields are checked,
 * but a supplied field may not be blank.
 */
function validateTask(input = {}, { partial = false } = {}) {
  const errors = [];
  for (const { key, label } of FIELDS) {
    const supplied = input[key] !== undefined && input[key] !== null;
    if (partial && !supplied) continue;
    const value = supplied ? String(input[key]).trim() : '';
    if (!value) { errors.push({ field: key, message: `${label} is required.` }); continue; }
    if (key === 'scheduled_date' && !isValidDate(value)) {
      errors.push({ field: key, message: `${label} is not a valid date (use YYYY-MM-DD).` });
    }
  }
  if (input.status !== undefined && !STATUSES.includes(input.status)) {
    errors.push({ field: 'status', message: 'Status must be Pending or Completed.' });
  }
  return errors;
}

/** SR-06 / AC-06: Overdue only if Pending AND date strictly earlier than today. */
function isOverdue(task, today) {
  return task.status === 'Pending' && task.scheduled_date < today; // ISO strings compare correctly
}

/** Local-time yyyy-mm-dd for a Date. */
function toISODate(date) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

module.exports = { FIELDS, STATUSES, isValidDate, validateTask, isOverdue, toISODate };
