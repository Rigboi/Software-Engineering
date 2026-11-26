'use strict';
const { validateReturn, validateSearch, validateCorrection, validateSchedule } = require('./return-model');
const nodemailer = require('nodemailer');

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
    for (const table of ['ReturnEmailOutbox']) {
      const fields = await all(`PRAGMA table_info(${table})`);
      for (const name of ['previewUrl', 'lastError', 'sentAt']) if (!fields.some(field => field.name === name)) await run(`ALTER TABLE ${table} ADD COLUMN ${name} TEXT`);
    }
    await run(`CREATE TABLE IF NOT EXISTS ReturnHistoryCorrections (
      correctionID INTEGER PRIMARY KEY, returnID INTEGER NOT NULL, condition TEXT NOT NULL,
      notes TEXT NOT NULL, reason TEXT NOT NULL, staffID TEXT NOT NULL, staffName TEXT NOT NULL, correctedAt TEXT NOT NULL)`);
    await run(`CREATE TABLE IF NOT EXISTS ReturnReminderEvents (
      eventID INTEGER PRIMARY KEY, transactionID INTEGER NOT NULL, tag TEXT NOT NULL, scheduledAt TEXT NOT NULL,
      recipient TEXT NOT NULL, subject TEXT NOT NULL, body TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'Scheduled',
      staffID TEXT NOT NULL, staffName TEXT NOT NULL, administeredAt TEXT, previewUrl TEXT, lastError TEXT, sentAt TEXT,
      UNIQUE(transactionID, tag))`);

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
  async function listReturns(query = {}) {
    try { validateSearch(query.search || ''); } catch (error) { throw invalid(error.message); }
    await ready;
    return exclusive(async () => ({
      loans: (await all(`SELECT t.*, a.assetName, a.condition FROM LoanTransactions t
        LEFT JOIN Assets a ON a.assetID = t.assetID
        WHERE t.status != 'Returned' AND t.checkinDate IS NULL ORDER BY t.dueDate, t.transactionID`)).filter(loan =>
          (!query.overdueOnly || query.overdueOnly === 'false' || loan.dueDate < clock().toISOString().slice(0, 10)) &&
          [loan.assetID, loan.assetName, loan.borrowerName, loan.borrowerID].some(value => String(value || '').toLowerCase().includes(String(query.search || '').trim().toLowerCase()))),
      returns: await all(`SELECT r.*, COALESCE(e.status, 'Pending') AS emailStatus,
        COALESCE((SELECT MAX(correctionID) FROM ReturnHistoryCorrections c WHERE c.returnID = r.returnID), 0) AS revision,
        (SELECT condition FROM ReturnHistoryCorrections c WHERE c.returnID = r.returnID ORDER BY correctionID DESC LIMIT 1) AS correctedCondition,
        (SELECT notes FROM ReturnHistoryCorrections c WHERE c.returnID = r.returnID ORDER BY correctionID DESC LIMIT 1) AS correctedNotes,
        (SELECT reason FROM ReturnHistoryCorrections c WHERE c.returnID = r.returnID ORDER BY correctionID DESC LIMIT 1) AS correctionReason
        FROM AssetReturns r
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










await run("UPDATE ReturnReminderEvents SET status = 'Cancelled' WHERE transactionID = ? AND status IN ('Scheduled', 'Pending', 'Failed')", [transactionID]);
        await run('COMMIT');







        return { ok: true, returnID: record.lastID, emailStatus: 'Pending' };
      } catch (error) { await run('ROLLBACK'); throw error; }
    });
  }
  // Additional routes and worker follow.

  const clock = () => options.clock ? options.clock() : new Date();
  let transportPromise;
  const senderConfigured = () => !!options.sendEmail || !!process.env.SMTP_HOST || process.env.ETHEREAL_EMAIL === '1';
  async function deliver(message) {
    if (options.sendEmail) return options.sendEmail(message);
    if (!senderConfigured()) throw invalid('Email is not configured. Set SMTP settings or ETHEREAL_EMAIL=1, then restart the server.', 503);
    if (!transportPromise) transportPromise = (async () => {
      if (process.env.SMTP_HOST) return { captured: false, from: process.env.MAIL_FROM || process.env.SMTP_USER,
        transporter: nodemailer.createTransport({ host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT || 465),
          secure: process.env.SMTP_SECURE !== 'false', connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 10000,
          ...(process.env.SMTP_USER ? { auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } } : {}) }) };
      const account = await nodemailer.createTestAccount();
      return { captured: true, from: account.user, transporter: nodemailer.createTransport({ host: 'smtp.ethereal.email', port: 587,
        secure: false, requireTLS: true, connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 10000,
        auth: { user: account.user, pass: account.pass } }) };
    })().catch(error => { transportPromise = null; throw error; });
    const transport = await transportPromise;
    const info = await transport.transporter.sendMail({ from: transport.from, ...message });
    return { captured: transport.captured, previewUrl: nodemailer.getTestMessageUrl(info) || null };
  }
  function emailTable(kind) {
    if (kind === 'return') return { table: 'ReturnEmailOutbox', id: 'emailID' };
    if (kind === 'reminder') return { table: 'ReturnReminderEvents', id: 'eventID' };
    throw invalid('Invalid email type.');
  }
  async function listEvidence() {
    await ready;
    return exclusive(async () => ({
      emails: (await all(`SELECT *, 'return' AS kind FROM ReturnEmailOutbox ORDER BY emailID DESC`))
        .concat(await all(`SELECT *, eventID AS emailID, 'reminder' AS kind FROM ReturnReminderEvents ORDER BY eventID DESC`)),
      senderConfigured: senderConfigured()
    }));
  }
  async function sendEmail(kind, id) {
    await ready;
    const { table, id: key } = emailTable(kind);
    if (!/^\d+$/.test(String(id))) throw invalid('Invalid email record.');
    if (!senderConfigured()) throw invalid('Email is not configured. Set SMTP settings or ETHEREAL_EMAIL=1, then restart the server.', 503);
    const row = await exclusive(async () => {
      const item = await get(`SELECT * FROM ${table} WHERE ${key} = ?`, [id]);
      if (!item) throw invalid('Email not found.', 404);
      if (!['Pending', 'Failed'].includes(item.status)) throw invalid('This email is not ready to send or has already been processed.', 409);
      if (kind === 'reminder') {
        const loan = await get('SELECT status, checkinDate FROM LoanTransactions WHERE transactionID = ?', [item.transactionID]);
        if (!loan || loan.status === 'Returned' || loan.checkinDate) {
          await run(`UPDATE ${table} SET status = 'Cancelled' WHERE ${key} = ?`, [id]);
          throw invalid('The asset was returned. This reminder was cancelled.', 409);
        }
      }
      await run(`UPDATE ${table} SET status = 'Sending', lastError = NULL WHERE ${key} = ?`, [id]);
      return item;
    });
    try {
      const result = await deliver({ to: row.recipient, subject: row.subject, text: row.body });
      const status = result?.captured ? 'Captured' : 'Sent';
      await exclusive(() => run(`UPDATE ${table} SET status = ?, previewUrl = ?, sentAt = ? WHERE ${key} = ?`, [status, result?.previewUrl || null, clock().toISOString(), id]));
      return { status, previewUrl: result?.previewUrl || null };
    } catch (error) {
      await exclusive(() => run(`UPDATE ${table} SET status = 'Failed', lastError = ? WHERE ${key} = ?`, [String(error.message).slice(0, 500), id]));
      return { status: 'Failed', error: 'Email could not be sent. See delivery status and retry after checking the email configuration.' };
    }
  }
  async function correctHistory(id, input, staff) {
    await ready;
    try { validateCorrection(input); } catch (error) { throw invalid(error.message); }
    if (!staff?.staffID || !staff?.name) throw invalid('A verified staff account is required.', 403);
    return exclusive(async () => {
      await run('BEGIN IMMEDIATE');
      try {
        const record = await get('SELECT returnID FROM AssetReturns WHERE returnID = ?', [id]);
        if (!record) throw invalid('Return history record not found.', 404);
        const revision = await get('SELECT COALESCE(MAX(correctionID), 0) AS revision FROM ReturnHistoryCorrections WHERE returnID = ?', [id]);
        if (revision.revision !== input.revision) throw invalid('This history record changed. Refresh before editing.', 409);
        const result = await run(`INSERT INTO ReturnHistoryCorrections (returnID, condition, notes, reason, staffID, staffName, correctedAt)
          VALUES (?, ?, ?, ?, ?, ?, ?)`, [id, input.condition, input.notes.trim(), input.reason.trim(), staff.staffID, staff.name, clock().toISOString()]);
        await run('COMMIT'); return { ok: true, revision: result.lastID };
      } catch (error) { await run('ROLLBACK'); throw error; }
    });
  }
  async function scheduleReminders(id, input, staff) {
    await ready;
    try { validateSchedule(input, clock()); } catch (error) { throw invalid(error.message); }
    if (!staff?.staffID || !staff?.name) throw invalid('A verified staff account is required.', 403);
    return exclusive(async () => {
      await run('BEGIN IMMEDIATE');
      try {
        const loan = await get('SELECT * FROM LoanTransactions WHERE transactionID = ?', [id]);
        if (!loan || loan.status === 'Returned' || loan.checkinDate) throw invalid('Select an outstanding loan.', 409);
        const processed = await get("SELECT eventID FROM ReturnReminderEvents WHERE transactionID = ? AND status != 'Scheduled'", [id]);
        if (processed) throw invalid('Reminder processing has started. This schedule can no longer be replaced.', 409);
        await run('DELETE FROM ReturnReminderEvents WHERE transactionID = ?', [id]);
        for (const [tag, field] of [['Borrowed', 'borrowedAt'], ['Overdue', 'overdueAt'], ['Missing', 'missingAt']]) {
          await run(`INSERT INTO ReturnReminderEvents (transactionID, tag, scheduledAt, recipient, subject, body, staffID, staffName)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [id, tag, input[field], loan.borrowerEmail,
              `${tag} reminder: ${loan.assetID}`, `Hello ${loan.borrowerName},\n\nReturns reminder label: ${tag}\nAsset: ${loan.assetID}\nLabel scheduled for: ${input[field]}\nLoan due date: ${loan.dueDate}\n\nPlease contact WJC MITS about this equipment.`, staff.staffID, staff.name]);
        }
        await run('COMMIT'); return { ok: true };
      } catch (error) { await run('ROLLBACK'); throw error; }
    });
  }
  let processing = false;
  async function processDueEmails() {
    await ready; if (processing) return { busy: true }; processing = true;
    try {
      await exclusive(async () => {
        const due = await all("SELECT e.*, l.status AS loanStatus, l.checkinDate FROM ReturnReminderEvents e LEFT JOIN LoanTransactions l ON l.transactionID = e.transactionID WHERE e.status = 'Scheduled' AND e.scheduledAt <= ?", [clock().toISOString()]);
        for (const event of due) await run('UPDATE ReturnReminderEvents SET status = ?, administeredAt = ? WHERE eventID = ?',
          [!event.loanStatus || event.loanStatus === 'Returned' || event.checkinDate ? 'Cancelled' : 'Pending', clock().toISOString(), event.eventID]);
      });
      if (senderConfigured()) {
        const evidence = await listEvidence();
        for (const email of evidence.emails.filter(item => item.status === 'Pending')) {
          try { await sendEmail(email.kind, email.emailID); } catch (error) { if (error.status !== 409) throw error; }
        }
      }
      return { ok: true };
    } finally { processing = false; }
  }
  router.get('/', async (req, res) => { try { res.json(await listReturns(req.query)); } catch (error) { fail(res, error); } });
  router.get('/emails', async (req, res) => { try { res.json(await listEvidence()); } catch (error) { fail(res, error); } });
  router.post('/emails/:kind/:id/send', async (req, res) => { try { res.json(await sendEmail(req.params.kind, req.params.id)); } catch (error) { fail(res, error); } });
  router.post('/history/:id/corrections', async (req, res) => { try { res.json(await correctHistory(req.params.id, req.body || {}, req.user)); } catch (error) { fail(res, error); } });
  router.post('/reminders/:id', async (req, res) => { try { res.json(await scheduleReminders(req.params.id, req.body || {}, req.user)); } catch (error) { fail(res, error); } });
  router.post('/process-reminders', async (req, res) => { try { res.json(await processDueEmails()); } catch (error) { fail(res, error); } });
  router.post('/:id', async (req, res) => { try { res.json(await checkIn(req.params.id, req.body || {}, req.user)); } catch (error) { fail(res, error); } });
  app.use('/api/returns', router);
  app.get('/returns', (req, res) => res.redirect('/pages/Asset-Returns/index.html'));
  let timer;
  if (!options.router && options.autoProcess !== false) {
    timer = setInterval(() => processDueEmails().catch(error => {
      if (/not open|closed/i.test(error.message)) clearInterval(timer);
      else if (options.onError) options.onError(error);
    }), 5000); timer.unref();
  }
  return { ready, listReturns, checkIn, correctHistory, scheduleReminders, processDueEmails, listEvidence, sendEmail,
    stop() { if (timer) clearInterval(timer); } };
};
