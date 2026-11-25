'use strict';
const { randomBytes, randomUUID, createHash, scrypt, timingSafeEqual } = require('node:crypto');
const { promisify } = require('node:util');
const derive = promisify(scrypt);
const COOKIE = 'wjc_session';
const IDLE = 15 * 60 * 1000;
const hash = value => createHash('sha256').update(value).digest('hex');
const publicUser = row => ({ staffID: row.staffID, name: row.name, loginID: row.loginID, role: row.role });

async function createAuth(app, store, express, options = {}) {
  const db = store.native;
  const now = options.now || Date.now;
  await store.exclusive(() => {
    const columns = db.prepare('PRAGMA table_info(StaffUsers)').all();
    if (columns.some(column => column.name === 'email')) {
      const count = db.prepare('SELECT COUNT(*) AS n FROM StaffUsers').get().n;
      if (count !== 0) throw new Error('Existing email accounts need staff ID mappings before upgrading. No accounts were changed.');
      db.exec('DROP TABLE StaffUsers');
    }
  });
  await store.exclusive(() => db.exec(`
    CREATE TABLE IF NOT EXISTS StaffUsers (
      staffID TEXT PRIMARY KEY, name TEXT NOT NULL, loginID TEXT NOT NULL UNIQUE CHECK(length(loginID) = 9 AND loginID NOT GLOB '*[^0-9]*'),
      salt TEXT NOT NULL, passwordHash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','staff')),
      createdAt INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS StaffSessions (
      tokenHash TEXT PRIMARY KEY, staffID TEXT NOT NULL REFERENCES StaffUsers(staffID),
      lastSeen INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS StaffInvitations (
      codeHash TEXT PRIMARY KEY, createdBy TEXT NOT NULL REFERENCES StaffUsers(staffID),
      expiresAt INTEGER NOT NULL, usedAt INTEGER);
  `));
  const userCount = () => db.prepare('SELECT COUNT(*) AS n FROM StaffUsers').get().n;
  const cookieOptions = { httpOnly: true, sameSite: 'strict', secure: options.secureCookies === true, path: '/' };
  function token(req) {
    const value = (req.headers.cookie || '').split(';').map(part => part.trim()).find(part => part.startsWith(COOKIE + '='));
    return value ? value.slice(COOKIE.length + 1) : '';
  }
  function setCookie(res, value) { res.cookie(COOKIE, value, { ...cookieOptions, maxAge: IDLE }); }
  function clearCookie(res) { res.clearCookie(COOKIE, cookieOptions); }
  function createSession(req, res, staffID) {
    const old = token(req); if (old) db.prepare('DELETE FROM StaffSessions WHERE tokenHash = ?').run(hash(old));
    db.prepare('DELETE FROM StaffSessions WHERE lastSeen <= ?').run(now() - IDLE);
    const value = randomBytes(32).toString('hex');
    db.prepare('INSERT INTO StaffSessions VALUES (?, ?, ?)').run(hash(value), staffID, now());
    setCookie(res, value);
  }
  // Resolve identity from the cookie only, never from a name/header supplied by the page.
  app.use(async (req, res, next) => {
    try {
      const value = token(req);
      if (!/^[a-f0-9]{64}$/.test(value)) return next();
      await store.exclusive(() => {
        const session = db.prepare(`SELECT u.*, s.lastSeen FROM StaffSessions s JOIN StaffUsers u
          ON u.staffID = s.staffID WHERE s.tokenHash = ?`).get(hash(value));
        if (!session || session.lastSeen <= now() - IDLE) {
          db.prepare('DELETE FROM StaffSessions WHERE tokenHash = ?').run(hash(value)); clearCookie(res); return;
        }
        db.prepare('UPDATE StaffSessions SET lastSeen = ? WHERE tokenHash = ?').run(now(), hash(value));
        req.user = publicUser(session); setCookie(res, value);
      });
      next();
    } catch (error) { next(error); }
  });
  app.use((req, res, next) => {
    // JSON write endpoints are same-origin. Block cross-site form/fetch requests.
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const origin = req.headers.origin;
      let foreign = req.headers['sec-fetch-site'] === 'cross-site';
      if (origin) { try { foreign ||= new URL(origin).host !== req.headers.host; } catch { foreign = true; } }
      if (foreign) return res.status(403).json({ error: 'This request must come from the application.' });
    }
    next();
  });
  const router = express.Router();
  router.use(express.json({ limit: '16kb' }));
  router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  const attempts = new Map();
  function limit(req, res, next) {
    const key = req.ip;
    const current = now();
    for (const [ip, entry] of attempts) if (entry.until <= current) attempts.delete(ip);
    const entry = attempts.get(key) || { count: 0, until: current + IDLE };
    entry.count++; attempts.set(key, entry);
    if (entry.count > 20) { res.set('Retry-After', String(Math.ceil((entry.until - current) / 1000))); return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' }); }
    next();
  }
  router.get('/status', async (req, res, next) => {
    try { res.json(await store.exclusive(() => ({ requiresInvitation: userCount() > 0 }))); } catch (error) { next(error); }
  });
  router.get('/me', (req, res) => req.user ? res.json({ user: req.user }) : res.status(401).json({ error: 'Please log in.' }));
  router.post('/signup', limit, async (req, res, next) => {
    try {
      const { name, loginID, password, invitationCode } = req.body || {};
      if (typeof name !== 'string' || !name.trim() || name.trim().length > 100) return res.status(400).json({ error: 'Enter your name (up to 100 characters).' });
      if (typeof loginID !== 'string' || !/^[0-9]{9}$/.test(loginID)) return res.status(400).json({ error: 'Enter a staff ID containing exactly 9 digits.' });
      if (typeof password !== 'string' || password.length < 12 || password.length > 128) return res.status(400).json({ error: 'Use a password between 12 and 128 characters.' });
      const salt = randomBytes(16).toString('hex');
      const passwordHash = (await derive(password, salt, 64)).toString('hex');
      const result = await store.exclusive(() => {
        db.exec('BEGIN IMMEDIATE');
        try {
          const first = userCount() === 0;
          const code = typeof invitationCode === 'string' ? invitationCode.trim() : '';
          const invitation = code ? db.prepare('SELECT * FROM StaffInvitations WHERE codeHash = ?').get(hash(code)) : null;
          if (!first && (!invitation || invitation.usedAt || invitation.expiresAt <= now())) {
            db.exec('ROLLBACK'); return { status: 403, error: 'Enter a valid, unused staff invitation code.' };
          }
          if (db.prepare('SELECT staffID FROM StaffUsers WHERE loginID = ?').get(loginID)) {
            db.exec('ROLLBACK'); return { status: 409, error: 'An account already uses that staff ID. Log in instead.' };
          }
          const user = { staffID: randomUUID(), name: name.trim(), loginID, role: first ? 'admin' : 'staff' };
          db.prepare('INSERT INTO StaffUsers VALUES (?, ?, ?, ?, ?, ?, ?)').run(user.staffID, user.name, user.loginID, salt, passwordHash, user.role, now());
          if (!first) db.prepare('UPDATE StaffInvitations SET usedAt = ? WHERE codeHash = ?').run(now(), hash(code));
          createSession(req, res, user.staffID);
          db.exec('COMMIT'); return { user };
        } catch (error) { db.exec('ROLLBACK'); throw error; }
      });
      res.status(result.status || 201).json(result.error ? { error: result.error } : result);
    } catch (error) { next(error); }
  });
  router.post('/login', limit, async (req, res, next) => {
    try {
      const { loginID, password } = req.body || {};
      if (typeof loginID !== 'string' || !/^[0-9]{9}$/.test(loginID) || typeof password !== 'string' || password.length > 128) return res.status(400).json({ error: 'Enter your 9-digit staff ID and password.' });
      const user = await store.exclusive(() => db.prepare('SELECT * FROM StaffUsers WHERE loginID = ?').get(loginID));
      const candidate = await derive(password, user ? user.salt : '00000000000000000000000000000000', 64);
      const expected = user ? Buffer.from(user.passwordHash, 'hex') : Buffer.alloc(64);
      if (!user || !timingSafeEqual(candidate, expected)) return res.status(401).json({ error: 'Staff ID or password is incorrect.' });
      await store.exclusive(() => createSession(req, res, user.staffID));
      attempts.delete(req.ip);
      res.json({ user: publicUser(user) });
    } catch (error) { next(error); }
  });
  router.post('/logout', async (req, res, next) => {
    try {
      const value = token(req);
      if (value) await store.exclusive(() => db.prepare('DELETE FROM StaffSessions WHERE tokenHash = ?').run(hash(value)));
      clearCookie(res); res.json({ ok: true });
    } catch (error) { next(error); }
  });
  router.post('/invitations', async (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Please log in.' });
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Only an administrator can invite staff.' });
    try {
      const code = randomBytes(18).toString('hex'); const expiresAt = now() + 24 * 60 * 60 * 1000;
      await store.exclusive(() => db.prepare('INSERT INTO StaffInvitations (codeHash, createdBy, expiresAt) VALUES (?, ?, ?)').run(hash(code), req.user.staffID, expiresAt));
      res.status(201).json({ invitationCode: code, expiresAt });
    } catch (error) { next(error); }
  });
  app.use('/api/auth', router);
  const requireUser = (req, res, next) => req.user ? next() : res.status(401).json({ error: 'Please log in to continue.' });
  return { requireUser };
}
module.exports = { createAuth, IDLE };
