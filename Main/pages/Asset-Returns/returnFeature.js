'use strict';
const { validateReturn } = require('./return-model');

// Mount with the SAME SQLite database as Asset-Borrowing/loanFeature.js.
// Pass a dedicated SQLite connection to keep transaction ownership isolated.
module.exports = function registerReturns(app, db, options = {}) {
  const router = options.router || (options.express || require('express')).Router();
  const json = options.json || (options.express || require('express')).json;
  const run = (sql, values = []) => new Promise((resolve, reject) => db.run(sql, values, function (error) { error ? reject(error) : resolve({ changes: this.changes, lastID: this.lastID }); }));
  const all = (sql, values = []) => new Promise((resolve, reject) => db.all(sql, values, (error, rows) => error ? reject(error) : resolve(rows)));
  const get = async (sql, values) => (await all(sql, values))[0];
  let queue = Promise.resolve();
  function exclusive(action) {
    if (options.exclusive) return options.exclusive(action);
    const task = queue.then(action); queue = task.catch(() => {}); return task;
  }
  const ready = exclusive(async () => {
    await run(`CREATE TABLE IF NOT EXISTS Assets (assetID TEXT PRIMARY KEY, assetName TEXT, status TEXT DEFAULT 'Available')`);
    const columns = await all('PRAGMA table_info(Assets)');
    if (!columns.some(column => column.name === 'condition')) await run('ALTER TABLE Assets ADD COLUMN condition TEXT');
    if (!columns.some(column => column.name === 'version')) await run('ALTER TABLE Assets ADD COLUMN version INTEGER NOT NULL DEFAULT 1');
    await run(`CREATE TABLE IF NOT EXISTS LoanTransactions (
      transactionID INTEGER PRIMARY KEY AUTOINCREMENT, assetID TEXT NOT NULL,
      borrowerName TEXT NOT NULL, borrowerID TEXT NOT NULL, borrowerEmail TEXT NOT NULL,
      checkOutDate TEXT NOT NULL, dueDate TEXT NOT NULL, checkinDate TEXT,
      status TEXT DEFAULT 'Active', overdueEmailSent INTEGER DEFAULT 0)`);
    await run(`CREATE TABLE IF NOT EXISTS AssetReturns (
      returnID INTEGER PRIMARY KEY AUTOINCREMENT, transactionID INTEGER NOT NULL UNIQUE,
      assetID TEXT NOT NULL, assetName TEXT, borrowerName TEXT NOT NULL, borrowerID TEXT NOT NULL,
      borrowerEmail TEXT NOT NULL, previousCondition TEXT NOT NULL, condition TEXT NOT NULL,
      assetStatus TEXT NOT NULL, notes TEXT NOT NULL, staffID TEXT NOT NULL, staffName TEXT NOT NULL,
      returnedAt TEXT NOT NULL)`);
    await run(`CREATE TABLE IF NOT EXISTS ReturnEmailOutbox (
      emailID INTEGER PRIMARY KEY AUTOINCREMENT, returnID INTEGER NOT NULL UNIQUE,
      recipient TEXT NOT NULL, subject TEXT NOT NULL, body TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'Pending', createdAt TEXT NOT NULL)`);
  });
  // Mark handled immediately; requests still await the rejected promise and report failure.
  ready.catch(() => {});
  router.use(json({ limit: '16kb' }));
  router.use(options.authorize || ((req, res) => res.status(401).json({ error: 'Staff sign-in is not connected.' })));
  router.use((req, res, next) => {
    if (!req.user || !req.user.staffID || !req.user.name) return res.status(403).json({ error: 'A verified staff account is required.' });
    next();
  });
  function fail(res, error) {
    if (options.onError) options.onError(error);
    return res.status(error.status || 500).json({ error: error.status ? error.message : 'The return could not be processed. Refresh and try again.' });
  }
  function invalid(message, status = 400) { const error = new Error(message); error.status = status; return error; }
  async function listReturns() {
    await ready;
    return exclusive(async () => ({
      loans: await all(`SELECT t.*, a.assetName, a.condition FROM LoanTransactions t
        LEFT JOIN Assets a ON a.assetID = t.assetID
        WHERE t.status != 'Returned' AND t.checkinDate IS NULL ORDER BY t.dueDate, t.transactionID`),
      returns: await all(`SELECT r.*, COALESCE(e.status, 'Pending') AS emailStatus FROM AssetReturns r
        LEFT JOIN ReturnEmailOutbox e ON e.returnID = r.returnID ORDER BY r.returnID DESC`)
    }));
  }
  async function checkIn(transactionID, input, staff) {
    await ready;
    if (!/^\d+$/.test(String(transactionID)) || !Number.isSafeInteger(Number(transactionID)) || Number(transactionID) < 1) throw invalid('Select a valid loan.');
    try { validateReturn(input); } catch (error) { throw invalid(error.message); }
    if (!staff || !staff.staffID || !staff.name) throw invalid('A verified staff account is required.', 403);
    return exclusive(async () => {
      await run('BEGIN IMMEDIATE');
      try {
        const loan = await get(`SELECT t.*, a.assetName, a.condition, a.assetID AS foundAsset
          FROM LoanTransactions t LEFT JOIN Assets a ON a.assetID = t.assetID WHERE t.transactionID = ?`, [transactionID]);
        if (!loan) throw invalid('Loan not found.', 404);
        if (!loan.foundAsset) throw invalid('The asset record is missing. Ask MITS to correct the inventory.', 409);
        if (loan.status === 'Returned' || loan.checkinDate) throw invalid('This loan has already been returned. Refresh the records.', 409);
        const now = new Date().toISOString();
        const previousCondition = loan.condition || 'Not recorded';
        const updated = await run(`UPDATE LoanTransactions SET status = 'Returned', checkinDate = ?
          WHERE transactionID = ? AND status != 'Returned' AND checkinDate IS NULL`, [now.slice(0, 10), transactionID]);
        if (updated.changes !== 1) throw invalid('This loan is no longer outstanding.', 409);
        await run('UPDATE Assets SET status = ?, condition = ?, version = version + 1 WHERE assetID = ?', [input.assetStatus, input.condition, loan.assetID]);
        const record = await run(`INSERT INTO AssetReturns
          (transactionID, assetID, assetName, borrowerName, borrowerID, borrowerEmail, previousCondition,
          condition, assetStatus, notes, staffID, staffName, returnedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [transactionID, loan.assetID, loan.assetName, loan.borrowerName, loan.borrowerID, loan.borrowerEmail,
            previousCondition, input.condition, input.assetStatus, input.notes.trim(), String(staff.staffID), staff.name, now]);
        await run(`INSERT INTO ReturnEmailOutbox (returnID, recipient, subject, body, createdAt) VALUES (?, ?, ?, ?, ?)`,
          [record.lastID, loan.borrowerEmail, `Asset return confirmed: ${loan.assetID}`,
            `Hello ${loan.borrowerName},\n\nYour return of ${loan.assetID} (${loan.assetName || 'IT equipment'}) was recorded at ${now}.\nPrevious condition: ${previousCondition}\nCondition on return: ${input.condition}\nAsset status: ${input.assetStatus}\n\nWJC MITS`, now]);
        await run('COMMIT');
        return { ok: true, returnID: record.lastID, emailStatus: 'Pending' };
      } catch (error) { await run('ROLLBACK'); throw error; }
    });
  }
  router.get('/', async (req, res) => { try { res.json(await listReturns()); } catch (error) { fail(res, error); } });
  router.post('/:id', async (req, res) => {
    try { res.json(await checkIn(req.params.id, req.body || {}, req.user)); } catch (error) { fail(res, error); }
  });
  app.use('/api/returns', router);
  app.get('/returns', (req, res) => res.redirect('/pages/Asset-Returns/index.html'));
  return { ready, listReturns, checkIn };
};
