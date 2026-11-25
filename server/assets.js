'use strict';
const { isValidDate } = require('../Main/pages/Maintennance-schedule/src/maintenanceRules');
const LOCATIONS = ['IT Storage Room', 'Main Office', 'Server Room', 'Computer Lab', 'Equipment Cabinet'];
const CONDITIONS = ['New', 'Good', 'Fair', 'Poor'];

async function registerAssets(app, store, express, authorize) {
  const db = store.native;
  await store.exclusive(() => {
    const columns = new Set(db.prepare('PRAGMA table_info(Assets)').all().map(column => column.name));
    for (const [name, type] of Object.entries({ serialNumber: 'TEXT', deviceType: 'TEXT', purchaseDate: 'TEXT',
      location: 'TEXT', warrantyDate: 'TEXT', version: 'INTEGER NOT NULL DEFAULT 1' })) {
      if (!columns.has(name)) db.exec(`ALTER TABLE Assets ADD COLUMN ${name} ${type}`);
    }
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS unique_asset_serial ON Assets(serialNumber COLLATE NOCASE)
      WHERE serialNumber IS NOT NULL AND serialNumber != '';
      CREATE TABLE IF NOT EXISTS AssetChanges (
        changeID INTEGER PRIMARY KEY, assetID TEXT NOT NULL, action TEXT NOT NULL, staffID TEXT NOT NULL,
        staffName TEXT NOT NULL, changedAt TEXT NOT NULL, previousValues TEXT, newValues TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS AssetRelocations (
        relocationID INTEGER PRIMARY KEY, assetID TEXT NOT NULL, previousLocation TEXT NOT NULL,
        newLocation TEXT NOT NULL, relocationDate TEXT NOT NULL, staffID TEXT NOT NULL, staffMember TEXT NOT NULL);`);
  });
  function transaction(action) {
    db.exec('BEGIN IMMEDIATE');
    try { const result = action(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  const invalid = (message, status = 400) => Object.assign(new Error(message), { status });
  const view = row => ({ ...row, tagId: row.assetID, assetName: row.assetName || row.deviceType || '',
    serialNumber: row.serialNumber || '', deviceType: row.deviceType || '', purchaseDate: row.purchaseDate || '',
    condition: row.condition || '', location: row.location || '', warrantyDate: row.warrantyDate || '' });
  const find = id => db.prepare('SELECT * FROM Assets WHERE assetID = ?').get(id);
  function validate(body) {
    if (!body || typeof body !== 'object') throw invalid('Provide the asset details.');
    const asset = {};
    for (const key of ['tagId', 'serialNumber', 'deviceType', 'purchaseDate', 'condition', 'location']) {
      if (typeof body[key] !== 'string' || !body[key].trim() || body[key].length > 200) throw invalid(`${key} is required and must be at most 200 characters.`);
      asset[key] = body[key].trim();
    }
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(asset.tagId)) throw invalid('Tag ID must contain letters, numbers, dots, underscores, or hyphens.');
    if (!CONDITIONS.includes(asset.condition)) throw invalid('Select a valid asset condition.');
    if (!isValidDate(asset.purchaseDate)) throw invalid('Enter a valid purchase date.');
    asset.warrantyDate = body.warrantyDate || '';
    if (typeof asset.warrantyDate !== 'string' || (asset.warrantyDate && !isValidDate(asset.warrantyDate))) throw invalid('Enter a valid warranty end date.');
    if (asset.warrantyDate && asset.warrantyDate < asset.purchaseDate) throw invalid('Warranty end date cannot be before purchase date.');
    asset.assetName = typeof body.assetName === 'string' ? body.assetName.trim() : asset.deviceType;
    if (!asset.assetName || asset.assetName.length > 200) throw invalid('Enter an asset name of at most 200 characters.');
    return asset;
  }
  function duplicates(asset, originalID) {
    if (db.prepare('SELECT assetID FROM Assets WHERE assetID = ? COLLATE NOCASE AND assetID != ?').get(asset.tagId, originalID || '')) throw invalid('Tag ID already exists.', 409);
    if (db.prepare('SELECT assetID FROM Assets WHERE serialNumber = ? COLLATE NOCASE AND assetID != ?').get(asset.serialNumber, originalID || '')) throw invalid('Serial number already exists.', 409);
  }
  function audit(before, after, user, action) {
    const timestamp = new Date().toISOString();
    db.prepare('INSERT INTO AssetChanges (assetID, action, staffID, staffName, changedAt, previousValues, newValues) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(after.assetID, action, user.staffID, user.name, timestamp, before ? JSON.stringify(before) : null, JSON.stringify(after));
    if (before && before.location !== after.location) db.prepare(`INSERT INTO AssetRelocations
      (assetID, previousLocation, newLocation, relocationDate, staffID, staffMember) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(after.assetID, before.location || '', after.location, timestamp, user.staffID, user.name);
  }
  function insert(asset, user) {
    duplicates(asset);
    db.prepare(`INSERT INTO Assets (assetID, assetName, serialNumber, deviceType, purchaseDate, condition, location, warrantyDate, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Available')`).run(asset.tagId, asset.assetName, asset.serialNumber, asset.deviceType,
      asset.purchaseDate, asset.condition, asset.location, asset.warrantyDate || null);
    const result = find(asset.tagId); audit(null, result, user, 'Created'); return view(result);
  }
  function endpoint(action) {
    return async (req, res, next) => {
      try { await store.exclusive(() => action(req, res)); }
      catch (error) { if (error.status) res.status(error.status).json({ error: error.message }); else next(error); }
    };
  }
  const router = express.Router(); router.use(authorize, express.json({ limit: '2mb' }));
  router.get('/', endpoint((req, res) => {
    const query = '%' + String(req.query.q || '').trim() + '%';
    res.json(db.prepare(`SELECT * FROM Assets WHERE assetID LIKE ? OR assetName LIKE ? OR deviceType LIKE ? OR serialNumber LIKE ? ORDER BY assetID`)
      .all(query, query, query, query).map(view));
  }));
  router.post('/', endpoint((req, res) => { const asset = validate(req.body); res.status(201).json(transaction(() => insert(asset, req.user))); }));
  router.post('/import', endpoint((req, res) => {
    const records = req.body?.assets;
    if (!Array.isArray(records) || !records.length || records.length > 2000) throw invalid('Provide between 1 and 2,000 saved assets.');
    const validated = records.map(validate);
    const inserted = transaction(() => validated.map(asset => insert(asset, req.user)));
    res.status(201).json({ imported: inserted.length });
  }));
  router.get('/:id', endpoint((req, res) => { const asset = find(req.params.id); if (!asset) throw invalid('Asset not found.', 404); res.json(view(asset)); }));
  router.put('/:id', endpoint((req, res) => {
    const asset = validate(req.body);
    res.json(transaction(() => {
      const before = find(req.params.id); if (!before) throw invalid('Asset not found.', 404);
      if (asset.tagId !== before.assetID) throw invalid('The Tag ID cannot change after registration because loans and maintenance use it.');
      if (req.body.version !== before.version) throw invalid('This asset changed since you opened it. Refresh the inventory and edit it again.', 409);
      duplicates(asset, before.assetID);
      db.prepare(`UPDATE Assets SET assetName = ?, serialNumber = ?, deviceType = ?, purchaseDate = ?, condition = ?,
        location = ?, warrantyDate = ?, version = version + 1 WHERE assetID = ?`).run(asset.assetName, asset.serialNumber, asset.deviceType,
          asset.purchaseDate, asset.condition, asset.location, asset.warrantyDate || null, before.assetID);
      const result = find(before.assetID); audit(before, result, req.user, 'Edited'); return view(result);
    }));
  }));
  app.use('/api/assets', router);
  const storage = express.Router(); storage.use(authorize, express.json({ limit: '16kb' }));
  const locations = () => [...new Set([...LOCATIONS, ...db.prepare("SELECT DISTINCT location FROM Assets WHERE location IS NOT NULL AND location != ''").all().map(row => row.location)])].sort();
  storage.get('/', endpoint((req, res) => res.json({ assets: db.prepare('SELECT * FROM Assets ORDER BY assetID').all().map(view),
    locations: locations(), history: db.prepare('SELECT * FROM AssetRelocations ORDER BY relocationID DESC').all() })));
  storage.post('/relocations', endpoint((req, res) => {
    if (typeof req.body?.assetID !== 'string' || typeof req.body?.newLocation !== 'string' || !locations().includes(req.body.newLocation)) throw invalid('Select a valid asset and destination.');
    res.json(transaction(() => {
      const before = find(req.body.assetID); if (!before) throw invalid('Asset not found.', 404);
      if (req.body.version !== before.version) throw invalid('The asset changed. Refresh and select it again.', 409);
      if (before.location === req.body.newLocation) throw invalid('The asset is already stored at this location.');
      db.prepare('UPDATE Assets SET location = ?, version = version + 1 WHERE assetID = ?').run(req.body.newLocation, before.assetID);
      const result = find(before.assetID); audit(before, result, req.user, 'Relocated'); return view(result);
    }));
  }));
  app.use('/api/storage', storage);
  return { lookup: {
    find(tag) { const row = db.prepare('SELECT assetID AS tag_id, assetName AS device_name FROM Assets WHERE assetID = ? COLLATE NOCASE').get(String(tag).trim()); return row ? { ...row } : null; },
    list() { return db.prepare('SELECT assetID AS tag_id, assetName AS device_name FROM Assets ORDER BY assetID').all().map(row => ({ ...row })); }
  } };
}
module.exports = { registerAssets };
