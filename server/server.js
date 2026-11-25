'use strict';
const express = require('express');
const nodemailer = require('nodemailer');
const path = require('node:path');
const fs = require('node:fs');
const { openStore } = require('./database');
const { createAuth } = require('./auth');
const { registerAssets } = require('./assets');
const registerLoans = require('../Main/pages/Asset-Borrowing/loanFeature');
const registerReturns = require('../Main/pages/Asset-Returns/returnFeature');
const { openDatabase } = require('../Main/pages/Maintennance-schedule/src/db');
const { createMaintenanceService } = require('../Main/pages/Maintennance-schedule/src/maintenanceService');
const { createHandler } = require('../Main/pages/Maintennance-schedule/src/maintenanceRoutes');
const { authorize: maintenanceAuthorize } = require('../Main/pages/Maintennance-schedule/src/auth');

async function createApplication(options = {}) {
  const app = express();
  const dataDirectory = path.join(__dirname, 'data');
  if (!options.loanFile || !options.maintenanceFile) fs.mkdirSync(dataDirectory, { recursive: true });
  const store = openStore(options.loanFile || process.env.LOAN_DB_FILE || path.join(dataDirectory, 'loans.sqlite'));
  let maintenanceDb;
  try {
    if (options.authenticate) app.use(options.authenticate);
    const auth = await createAuth(app, store, express, { now: options.authNow, secureCookies: options.secureCookies || process.env.SECURE_COOKIES === '1' });
    const authorize = options.authorize || auth.requireUser;
    app.use('/api', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
    app.use('/pages', (req, res, next) => {
      res.set('Cache-Control', 'no-store');
      if (req.user) return next();
      if (req.path.endsWith('.html')) return res.redirect('/login?returnTo=' + encodeURIComponent(req.originalUrl));
      return res.status(401).json({ error: 'Please log in.' });
    });
    const returns = registerReturns(app, store, { express, exclusive: store.exclusive, authorize, onError: options.onError });
    await returns.ready;
    const assets = await registerAssets(app, store, express, authorize);
    const loans = registerLoans(app, store, { express, authorize, clock: options.clock });

    // Preserve a legacy maintenance database if there is exactly one known file.
    // Multiple candidates require an explicit path so records aren't hidden.
    const root = path.join(__dirname, '..');
    const legacy = [...new Set([
      path.join(root, 'wjc_assets.db'), path.join(root, 'Main', 'wjc_assets.db'),
      path.join(root, 'Main', 'Maintennance-schedule', 'wjc_assets.db'),
      path.join(root, 'Main', 'pages', 'Maintennance-schedule', 'wjc_assets.db')
    ])].filter(file => fs.existsSync(file));
    const configured = options.maintenanceFile || process.env.MAINTENANCE_DB_FILE || process.env.DB_FILE;
    const current = path.join(dataDirectory, 'maintenance.sqlite');
    if (!configured && ((legacy.length > 0 && fs.existsSync(current)) || legacy.length > 1)) {
      throw new Error('Multiple maintenance databases found. Set MAINTENANCE_DB_FILE to the database to use.');
    }
    maintenanceDb = openDatabase(configured || legacy[0] || current);
    const handler = createHandler(createMaintenanceService(maintenanceDb, options.clock, assets.lookup), options.maintenanceAuthorize || maintenanceAuthorize);
    // Mount before JSON parsing: the existing maintenance handler consumes the stream.
    app.use('/api/maintenance', authorize, (req, res, next) => {
      store.exclusive(() => { req.url = req.originalUrl; return handler(req, res); }).catch(next);
    });

    app.post('/api/warranty-email', authorize, express.json({ limit: '64kb' }), async (req, res, next) => {
      const devices = req.body?.devices;
      if (!Array.isArray(devices) || !devices.length || devices.some(d => !d ||
        !['tagId', 'deviceType', 'warrantyDate'].every(key => typeof d[key] === 'string'))) {
        return res.status(400).json({ error: 'Provide devices with a tag, type, and warranty end date.' });
      }
      if (!options.transporter) return res.status(503).json({ error: 'Email is not configured. Set SMTP settings or explicitly enable ETHEREAL_EMAIL=1 for test messages.' });
      try {
        const info = await options.transporter.sendMail({
          from: options.mailFrom || 'WJC Asset System <no-reply@wjc-assets.test>',
          to: options.mitsEmail || 'mits@wjc-assets.test',
          subject: `Warranty alert: ${devices.length} device(s) reaching a warning day`,
          text: 'The following devices reached a warranty warning day:\n\n' + devices.map(d => `- ${d.deviceType} (${d.tagId}): warranty ends ${d.warrantyDate}`).join('\n')
        });
        const previewUrl = nodemailer.getTestMessageUrl(info);
        res.json({ sent: true, previewUrl: previewUrl || null });
      } catch (error) { next(error); }
    });
    app.get('/login', (req, res) => res.sendFile(path.join(__dirname, '..', 'Main', 'auth', 'login.html')));
    app.get('/signup', (req, res) => res.sendFile(path.join(__dirname, '..', 'Main', 'auth', 'signup.html')));
    app.get('/', (req, res) => res.redirect('/pages/Asset-Management/index.html'));
    app.get('/maintenance', (req, res) => res.redirect('/pages/Maintennance-schedule/index.html'));
    app.get('/health', (req, res) => res.json({ ok: true }));
    app.use(express.static(path.join(__dirname, '..', 'Main')));
    app.use('/api', (req, res) => res.status(404).json({ error: 'API route not found.' }));
    app.use((error, req, res, next) => {
      if (res.headersSent) return next(error);
      if (options.onError) options.onError(error);
      const status = error.status >= 400 && error.status < 500 ? error.status : 500;
      res.status(status).json({ error: status === 400 ? 'Invalid request body.' : status === 413 ? 'Request body is too large.' : 'The request could not be processed.' });
    });
    return { app, store, loans, returns, maintenanceDb,
      async close() { await store.close(); maintenanceDb.close(); } };
  } catch (error) { await store.close(); if (maintenanceDb) maintenanceDb.close(); throw error; }
}

function scheduleDaily(action) {
  let timer, stopped = false;
  function schedule() {
    const now = new Date(); const next = new Date(now); next.setHours(24, 0, 0, 0);
    timer = setTimeout(async () => {
      try { await action(); } catch (error) { console.error('Daily loan check failed:', error.message); }
      if (!stopped) schedule();
    }, next - now);
    timer.unref();
  }
  schedule();
  return () => { stopped = true; clearTimeout(timer); };
}
async function start() {
  const settings = { onError: error => console.error(error.message),
    mailFrom: process.env.MAIL_FROM, mitsEmail: process.env.MITS_EMAIL };
  const runtime = await createApplication(settings);
  const server = runtime.app.listen(Number(process.env.PORT || 3000), '127.0.0.1', () => {
    console.log(`WJC Asset Management: http://localhost:${server.address().port}`);
    console.log('Maintenance, loan and return APIs use this same server.');
  });
  const stopDaily = scheduleDaily(runtime.loans.runDailyCheck);
  runtime.loans.runDailyCheck().catch(error => console.error('Loan check failed:', error.message));
  // Configure email asynchronously; unavailable SMTP never blocks page startup.
  if (process.env.SMTP_HOST || process.env.ETHEREAL_EMAIL === '1') {
    configureEmail().then(email => Object.assign(settings, email)).catch(error => console.error('Email setup failed:', error.message));
  }
  server.on('error', async error => { stopDaily(); await runtime.close(); console.error(error.message); process.exitCode = 1; });
  const shutdown = () => { stopDaily(); server.close(() => runtime.close().catch(console.error)); };
  process.once('SIGINT', shutdown); process.once('SIGTERM', shutdown);
  return server;
}
async function configureEmail() {
  if (process.env.SMTP_HOST) {
    return { transporter: nodemailer.createTransport({ host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 465), secure: process.env.SMTP_SECURE !== 'false',
      ...(process.env.SMTP_USER ? { auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } } : {}) }) };
  }
  const account = await nodemailer.createTestAccount();
  return { transporter: nodemailer.createTransport({ host: 'smtp.ethereal.email', port: 587,
    secure: false, requireTLS: true, auth: { user: account.user, pass: account.pass } }) };
}
if (require.main === module) start().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { createApplication, scheduleDaily };
