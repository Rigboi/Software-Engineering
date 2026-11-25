'use strict';
const { isValidDate, toISODate } = require('../Maintennance-schedule/src/maintenanceRules');

module.exports = function registerLoans(app, db, options = {}) {
  const express = options.express || require('express');
  const router = express.Router();
  router.use(express.json({ limit: '16kb' }));
  if (options.authorize) router.use(options.authorize);
  const sql = db.native;
  const today = () => toISODate(options.clock ? options.clock() : new Date());
  const daysLate = loan => Math.floor((Date.parse(today()) - Date.parse(loan.dueDate)) / 86400000);
  function transaction(action) {
    sql.exec('BEGIN IMMEDIATE');
    try { const result = action(); sql.exec('COMMIT'); return result; }
    catch (error) { sql.exec('ROLLBACK'); throw error; }
  }
  function endpoint(action) {
    return async (req, res, next) => {
      try { await db.exclusive(() => action(req, res)); } catch (error) { next(error); }
    };
  }
  router.post('/checkout', endpoint((req, res) => {
    const data = req.body || {};
    for (const key of ['assetID', 'borrowerName', 'borrowerID', 'borrowerEmail', 'dueDate']) {
      if (typeof data[key] !== 'string' || !data[key].trim()) return res.status(400).json({ ok: false, errors: ['All fields are required.'] });
    }
    if (!isValidDate(data.dueDate) || data.dueDate <= today()) return res.status(400).json({ ok: false, errors: ['Return date must be a valid future date.'] });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.borrowerEmail)) return res.status(400).json({ ok: false, errors: ['Enter a valid borrower email.'] });
    const result = transaction(() => {
      const asset = sql.prepare('SELECT status FROM Assets WHERE assetID = ?').get(data.assetID.trim());
      if (!asset) return { ok: false, errors: ['Asset not found.'] };
      if (asset.status !== 'Available') return { ok: false, errors: ['Asset is not available for checkout.'] };
      sql.prepare("UPDATE Assets SET status = 'On Loan' WHERE assetID = ?").run(data.assetID.trim());
      const row = sql.prepare(`INSERT INTO LoanTransactions
        (assetID, borrowerName, borrowerID, borrowerEmail, checkOutDate, dueDate)
        VALUES (?, ?, ?, ?, ?, ?)`).run(data.assetID.trim(), data.borrowerName.trim(), data.borrowerID.trim(), data.borrowerEmail.trim(), today(), data.dueDate);
      return { ok: true, transactionID: Number(row.lastInsertRowid), message: 'Checked out successfully.' };
    });
    res.status(result.ok ? 200 : 400).json(result);
  }));
  router.get('/history', endpoint((req, res) => {
    const rows = sql.prepare(`SELECT t.*, a.assetName FROM LoanTransactions t
      LEFT JOIN Assets a ON t.assetID = a.assetID WHERE t.borrowerName LIKE ? ORDER BY t.transactionID DESC`).all(`%${String(req.query.search || '')}%`);
    res.json(rows.map(loan => ({ ...loan,
      flagged: loan.status !== 'Returned' && daysLate(loan) >= 1,
      state: loan.status === 'Returned' ? 'Returned' : loan.status === 'Missing' ? 'Missing' : daysLate(loan) >= 1 ? 'Overdue' : loan.status
    })));
  }));
  router.get('/summary', endpoint((req, res) => {
    const counts = { Available: 0, 'On Loan': 0, Missing: 0, 'Sent for Repair': 0 };
    sql.prepare('SELECT status, COUNT(*) AS count FROM Assets GROUP BY status').all().forEach(row => { counts[row.status] = row.count; });
    const flagged = sql.prepare("SELECT * FROM LoanTransactions WHERE status != 'Returned'").all()
      .filter(loan => daysLate(loan) >= 1).map(loan => ({ borrowerID: loan.borrowerID, borrowerName: loan.borrowerName }));
    res.json({ today: today(), counts, flagged });
  }));
  router.get('/assets', endpoint((req, res) => res.json(sql.prepare('SELECT assetID, assetName, status FROM Assets ORDER BY assetName, assetID').all())));
  router.post('/return/:id', (req, res) => res.status(410).json({ error: 'Use the Asset Returns page to record an inspection and return.' }));
  app.use('/api/loans', router);
  app.get('/loaning', (req, res) => res.redirect('/pages/Asset-Borrowing/loaning.html'));

  async function runDailyCheck() {
    return db.exclusive(() => transaction(() => {
      const loans = sql.prepare("SELECT * FROM LoanTransactions WHERE status != 'Returned'").all();
      for (const loan of loans) {
        const days = daysLate(loan);
        if (days >= 1) sql.prepare('UPDATE LoanTransactions SET status = ? WHERE transactionID = ?')
          .run(days >= 31 ? 'Missing' : 'Overdue', loan.transactionID);
        if (days >= 31) sql.prepare("UPDATE Assets SET status = 'Missing' WHERE assetID = ?").run(loan.assetID);
      }
      // Delivery is not connected: never mark overdueEmailSent as true.
    }));
  }
  return { runDailyCheck };
};
