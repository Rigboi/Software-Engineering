// Asset Database (SQLite). Uses Node's built-in node:sqlite, so nothing to install.
const { DatabaseSync } = require('node:sqlite');

function openDatabase(file = 'wjc_assets.db') {
  const db = new DatabaseSync(file);
  db.exec(`
    -- Owned by Asset Management (Feature 01). Maintenance Scheduling only READS tag_id and device_name.
    -- Created here only so this feature runs on its own; use the group's assets table once it exists.
    CREATE TABLE IF NOT EXISTS assets (
      tag_id      TEXT PRIMARY KEY,
      device_name TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS maintenance_tasks (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      description    TEXT NOT NULL,
      equipment      TEXT NOT NULL,
      scheduled_date TEXT NOT NULL,           -- ISO yyyy-mm-dd
      assigned_staff TEXT NOT NULL,
      status         TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending','Completed')),
      created_at     TEXT NOT NULL,
      updated_at     TEXT NOT NULL
    );
  `);
  return db;
}
module.exports = { openDatabase };
