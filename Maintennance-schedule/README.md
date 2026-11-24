# Maintenance Schedule (Feature 06)

Node.js server + SQLite database (built-in `node:sqlite`, Node 22.5 or newer, nothing to install), as in SRS 1.4 and the SDS.

    cd Main/pages/Maintennance-schedule
    npm test      # TS-01 to TS-13 (+3 extra checks)
    npm start     # http://localhost:3001  (port 3000 is used by the group's other pages)

Modules (SDS 3.1): `src/maintenanceRules.js` (validation + Overdue rule), `src/maintenanceService.js`,
`src/maintenanceRoutes.js`, `src/auth.js` (stand-in until the group's authentication exists),
`src/assetLookup.js` (read-only Tag ID lookup), `src/db.js`, `src/server.js`, and the screen `index.html`.

Do not run `Main/generate.js`: it overwrites this page's index.html with the blank template.
