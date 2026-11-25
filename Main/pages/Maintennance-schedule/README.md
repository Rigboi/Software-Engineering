# Maintenance Schedule (Feature 06)

Node.js server + SQLite database (built-in `node:sqlite`, Node 22.5 or newer, nothing to install), as in SRS 1.4 and the SDS.

From the repository root, run `npm install`, then `npm start`.
Open http://localhost:3000/maintenance. Run `npm test` from the root for all features.
The standalone src/server.js remains available for tests, but is not a second application launcher.

Modules (SDS 3.1): `src/maintenanceRules.js` (validation + Overdue rule), `src/maintenanceService.js`,
`src/maintenanceRoutes.js`, `src/auth.js` (stand-in until the group's authentication exists),
`src/assetLookup.js` (read-only Tag ID lookup), `src/db.js`, `src/server.js`, and the screen `index.html`.

Do not run `Main/generate.js`: it overwrites this page's index.html with the blank template.
