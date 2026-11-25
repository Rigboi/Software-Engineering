# WJC IT Asset Management

## Run one application server

Use Node.js 24 or newer. From the repository root:

```powershell
npm install
npm start
```

Open http://localhost:3000. Do not also start the standalone maintenance server or use Live Server. `npm start` from `Main` or `server` also starts the same entry point. Maintenance's standalone server module is retained for its tests.

| Feature | URL |
| --- | --- |
| Inventory | http://localhost:3000/pages/Asset-Management/index.html |
| Storage | http://localhost:3000/pages/Storage-Management/index.html |
| Borrowing | http://localhost:3000/loaning |
| Returns | http://localhost:3000/returns |
| Maintenance | http://localhost:3000/maintenance |
| Warranty | http://localhost:3000/pages/Warranty-Report/index.html |
| Health | http://localhost:3000/health |

The server binds to loopback by default. It starts even when email is unconfigured. `PORT` can override 3000.

## Data and feature integration

Loans and Returns use `server/data/loans.sqlite`, Node's built-in SQLite, and one transaction queue. No sqlite3 native package is required. Set `LOAN_DB_FILE` to use another file. Checkout, asset status, and return-history writes are transactional; the old incomplete loan-return endpoint returns 410 and directs callers to the Returns workflow.

Maintenance tasks retain their own schema in `server/data/maintenance.sqlite`. A single existing `wjc_assets.db` at the repository root, Main, or the old maintenance folders is reused automatically. Set `MAINTENANCE_DB_FILE` (or legacy `DB_FILE`) explicitly if multiple databases exist. No existing database is deleted or migrated by this change.

Asset Management, Storage, Warranty, Borrowing, and Returns now read the same Assets table in server/data/loans.sqlite. New assets and edits are saved by authenticated server APIs. Maintenance keeps its task records in its existing database but resolves equipment names and Tag ID suggestions from that shared Assets table.

Use the Edit button in Asset Management to update saved records. Tags remain fixed after registration so existing loans, returns, and maintenance references stay linked. Duplicate tags/serial numbers and invalid dates are rejected on the server. Each edit requires the current record version; conflicting edits are rejected rather than silently overwriting newer condition, location, or loan changes. Loan status is controlled by checkout/return operations, not by the registration form.

Storage uses real assets and persists relocations with the signed-in staff identity. Asset Management location edits also create relocation history. Warranty reports and alerts load the shared inventory instead of browser-local copies. Component pages reload records when opened; Inventory and Storage also reload on window focus. Inventory has a Refresh inventory button.

Previously saved localStorage assets are not deleted. On the same browser/origin, Asset Management offers Import saved browser assets if a legacy assetData list exists. Import validates the entire batch and saves it in one transaction; duplicates or invalid rows reject the entire import without overwriting existing database records. Correct conflicts before retrying. No demo storage assets are imported automatically.

## Accounts and login

Open http://localhost:3000/login or http://localhost:3000/signup.

Sign up and log in using your unique nine-digit staff ID (for example, 620177693), not an email address. IDs are stored as text so leading zeros are preserved. The first signup creates an administrator account and signs it in. Passwords must be 12 to 128 characters. Administrators can use **Invite staff** in the navigation to generate a single-use signup code that expires after 24 hours. Additional accounts require a valid invitation; they receive the staff role. Both roles can use asset management, while only administrators can create invitations.

Passwords are salted and hashed with Node's scrypt. Accounts and hashed session tokens persist in the loan database. The session cookie is HttpOnly and SameSite=Strict; the server invalidates sessions after 15 minutes of inactivity. Log out is available on every component page and deletes the server session. Active use renews sessions. Component pages and all feature APIs require login; Maintenance no longer accepts X-User identity headers.

Use the same hostname throughout development (localhost and 127.0.0.1 have separate cookies). Under HTTPS hosting, set SECURE_COOKIES=1 so browsers only send session cookies over HTTPS. The server still binds to loopback by default. First-account setup should be completed locally before changing network exposure.

Email verification and forgotten-password recovery are not implemented. Invitation codes are shown to the administrator to share directly; this application does not automatically email invitations. Shared inventory is stored on the server and is accessible to authorized staff accounts. Legacy browser copies remain only for explicit import.

Tests inject identity middleware only in isolated fixtures. The normal application uses its stored cookie sessions.

## Email

SMTP is optional at startup. Set SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS, MAIL_FROM and MITS_EMAIL to use the approved mail service. SMTP_SECURE defaults to true (implicit TLS, normally port 465); use false with an appropriate STARTTLS port when required by the provider. To create an Ethereal test inbox instead, explicitly set ETHEREAL_EMAIL=1. Ethereal captures messages; it does not deliver to real recipients.

The warranty email endpoint returns 503 when no transport is configured. Return confirmations remain in ReturnEmailOutbox until a delivery worker is connected. Daily loan checks run at midnight in the server's local timezone and once at startup. They update overdue/missing status, but do not claim to send overdue messages. Warranty scheduling still depends on opening its page and needs a server-side job.

## Checks

```powershell
npm test
```

Tests cover the existing maintenance/returns behavior plus combined-server routing, request-body parsing, checkout/return integration, duplicate operations, rollback, date validation, and email availability.

`Main/generate.js` now fills only empty HTML files and skips existing pages. It is not the application launcher. Runtime databases and .env files are ignored by Git.
