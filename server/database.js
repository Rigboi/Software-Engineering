'use strict';
const { DatabaseSync } = require('node:sqlite');
function openStore(filename) {
  const native = new DatabaseSync(filename);
  native.exec('PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;');
  let pending = Promise.resolve();
  return {
    native,
    exclusive(action) {
      const result = pending.then(action);
      pending = result.catch(() => {});
      return result;
    },
    run(sql, values, callback) {
      if (typeof values === 'function') { callback = values; values = []; }
      let result;
      try { result = native.prepare(sql).run(...(values || [])); }
      catch (error) { callback(error); return; }
      callback.call({ changes: Number(result.changes), lastID: Number(result.lastInsertRowid) }, null);
    },
    all(sql, values, callback) {
      if (typeof values === 'function') { callback = values; values = []; }
      let rows;
      try { rows = native.prepare(sql).all(...(values || [])); }
      catch (error) { callback(error); return; }
      callback(null, rows);
    },
    async close() { await pending; native.close(); }
  };
}
module.exports = { openStore };
