const http = require('http');
const { openDatabase } = require('./db');
const { createMaintenanceService } = require('./maintenanceService');
const { createHandler } = require('./maintenanceRoutes');
const { authorize } = require('./auth');

function createServer(db, clock, authorizeRequest = authorize) {
  return http.createServer(createHandler(createMaintenanceService(db, clock), authorizeRequest));
}
module.exports = { createServer };

if (require.main === module) {
  const port = process.env.PORT || 3001; // 3000 is used by the group's other pages
  createServer(openDatabase(process.env.DB_FILE || 'wjc_assets.db')).listen(port, () =>
    console.log(`Maintenance schedule running at http://localhost:${port}`));
}
