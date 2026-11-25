// Read-only lookup of registered assets by Tag ID (Asset Management owns the assets table).
// This is the ONLY place Maintenance Scheduling touches the asset table (loose coupling, QA-07).
function createAssetLookup(db) {
  const safe = (fn, fallback) => { try { return fn(); } catch { return fallback; } }; // table missing -> no assets
  return {
    /** Case-insensitive match on Tag ID. Returns {tag_id, device_name} or null. */
    find(tagId) {
      return safe(() => { const row = db.prepare('SELECT tag_id, device_name FROM assets WHERE UPPER(tag_id) = UPPER(?)').get(String(tagId).trim()); return row ? { ...row } : null; }, null);
    },
    /** All registered assets, for the Tag ID suggestions on the screen. */
    list() { return safe(() => db.prepare('SELECT tag_id, device_name FROM assets ORDER BY tag_id').all().map((r) => ({ ...r })), []); },
  };
}
module.exports = { createAssetLookup };
