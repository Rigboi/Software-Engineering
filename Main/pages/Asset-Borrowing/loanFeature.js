// Feature 03: Asset Loaning & Tracking
const express = require('express');
const cron = require('node-cron');
const path = require('path');

// Add this to the server
module.exports = function (app, db, options = {}) {
    const router = express.Router();
    router.use(express.json());

    // Variables
    const MITS_EMAIL = 'mits@uwi.edu'; 
    const OVERDUE_DAY = 1;  
    const MISSING_DAY = 31; 

    // DATABASE SETUP 
    async function setupDatabase() {
        // Loans table
        await new Promise((resolve, reject) => {
            db.run(`CREATE TABLE IF NOT EXISTS LoanTransactions (
                transactionID INTEGER PRIMARY KEY AUTOINCREMENT,
                assetID TEXT NOT NULL,
                borrowerName TEXT NOT NULL,
                borrowerID TEXT NOT NULL,
                borrowerEmail TEXT NOT NULL,
                checkOutDate TEXT NOT NULL,
                dueDate TEXT NOT NULL,
                checkinDate TEXT,
                status TEXT DEFAULT 'Active',
                overdueEmailSent INTEGER DEFAULT 0
            )`, (err) => err ? reject(err) : resolve());
        });

        
        if (options.sampleAssets) {
            await new Promise((resolve) => {
                db.run(`CREATE TABLE IF NOT EXISTS Assets (assetID TEXT PRIMARY KEY, assetName TEXT, status TEXT DEFAULT 'Available')`, resolve);
            });
            await new Promise((resolve) => {
                db.run(`INSERT OR IGNORE INTO Assets (assetID, assetName) VALUES 
                    ('WJC-001', 'Dell Laptop'), ('WJC-002', 'Projector'), ('WJC-003', 'Wired Mouse')`, resolve);
            });
        }
    }

    
    const dbReady = setupDatabase();

    // 1. CHECK-OUT (SR-5.1, SR-5.2) 
    async function checkOut(data) {
        // SR-5.1: Validate that all fields are filled out
        if (!data.assetID || !data.borrowerName || !data.borrowerID || !data.borrowerEmail || !data.dueDate) {
            return { ok: false, errors: ['All fields are required.'] };
        }
        // TS-5.1B: Ensure the return date is in the future
        const today = new Date().toISOString().split('T')[0];

        if (data.dueDate <= today) {
            return { ok: false, errors: ['Return date must be in the future.'] };
            }
        
        // SR-5.2: Check if the asset is Available
        const asset = await new Promise((resolve) => {
            db.get(`SELECT status FROM Assets WHERE assetID = ?`, [data.assetID], (err, row) => resolve(row));
        });

        if (!asset) return { ok: false, errors: ['Asset not found.'] };
        if (asset.status !== 'Available') return { ok: false, errors: ['Asset is already on loan or missing.'] };

        // SR-5.2: Save the transaction and update the asset status
        await new Promise((resolve) => {
            db.serialize(() => {
                db.run(`UPDATE Assets SET status = 'On Loan' WHERE assetID = ?`, [data.assetID]);
                db.run(`INSERT INTO LoanTransactions (assetID, borrowerName, borrowerID, borrowerEmail, checkOutDate, dueDate) 
                        VALUES (?, ?, ?, ?, date('now'), ?)`, 
                    [data.assetID, data.borrowerName, data.borrowerID, data.borrowerEmail, data.dueDate], resolve);
            });
        });

        return { ok: true, message: 'Checked out successfully.' };
    }

    // 2. DAILY OVERDUE CHECK (SR-5.3, 5.4, 5.6, 5.7) 
    async function runDailyCheck() {
       
        const loans = await new Promise((resolve) => {
            db.all(`SELECT * FROM LoanTransactions WHERE status != 'Returned'`, (err, rows) => resolve(rows || []));
        });

        for (let loan of loans) {
            // Calculate how many days late it is
            const today = new Date().toISOString().split('T')[0];
            const daysLate = Math.floor((new Date(today) - new Date(loan.dueDate)) / (1000 * 60 * 60 * 24));

            if (daysLate >= OVERDUE_DAY) {
                // SR-5.3 & 5.6: Send overdue email and flag borrower (only if not sent yet)
                if (!loan.overdueEmailSent) {
                    console.log(`[EMAIL] Overdue Alert for ${loan.borrowerName} (Asset: ${loan.assetID})`);
                    await new Promise((resolve) => {
                        db.run(`UPDATE LoanTransactions SET overdueEmailSent = 1, status = 'Overdue' WHERE transactionID = ?`, [loan.transactionID], resolve);
                    });
                }

                // SR-5.4: Mark as Missing after 31 days
                if (daysLate >= MISSING_DAY && loan.status !== 'Missing') {
                    await new Promise((resolve) => {
                        db.run(`UPDATE LoanTransactions SET status = 'Missing' WHERE transactionID = ?`, [loan.transactionID]);
                        db.run(`UPDATE Assets SET status = 'Missing' WHERE assetID = ?`, [loan.assetID], resolve);
                    });
                }
            }
        }
    }

    // SR-5.7: Run the check automatically every night at midnight
    cron.schedule('0 0 * * *', runDailyCheck);
    

    // 3. API ROUTES 

    // Checkout route
    router.post('/checkout', async (req, res) => {
        await dbReady; // Wait for DB setup
        const result = await checkOut(req.body);
        res.status(result.ok ? 200 : 400).json(result);
    });

    // Search History (SR-5.5)
    router.get('/history', async (req, res) => {
        await dbReady;
        const search = req.query.search || '';
        db.all(`SELECT t.*, a.assetName FROM LoanTransactions t LEFT JOIN Assets a ON t.assetID = a.assetID WHERE t.borrowerName LIKE ? ORDER BY t.transactionID DESC`, ['%' + search + '%'], (err, rows) => {
           
            const results = (rows || []).map(loan => {
                const daysLate = Math.floor((new Date(new Date().toISOString().split('T')[0]) - new Date(l.dueDate)) / (1000 * 60 * 60 * 24));
                return {
                    ...loan,
                    flagged: (loan.status !== 'Returned' && daysLate >= 1),
                    state: loan.status === 'Missing' ? 'Missing' : (daysLate >= 1 && loan.status !== 'Returned' ? 'Overdue' : loan.status)
                };
            });
            res.json(results);
        });
    });

    // Get Summary Counts
    router.get('/summary', async (req, res) => {
        await dbReady;
        db.all(`SELECT status, COUNT(*) as count FROM Assets GROUP BY status`, (err, rows) => {
            const counts = { 'Available': 0, 'On Loan': 0, 'Missing': 0 };
            (rows || []).forEach(row => counts[row.status] = row.count);

            db.all(`SELECT borrowerID, borrowerName, dueDate, status FROM LoanTransactions WHERE status != 'Returned'`, (err, loans) => {
                const flagged = (loans || []).filter(l => {
                    const daysLate = Math.floor((new Date(new Date().toISOString().split('T')[0]) - new Date(l.dueDate)) / (1000 * 60 * 60 * 24));
                    return daysLate >= 1;
                }).map(l => ({ borrowerID: l.borrowerID, borrowerName: l.borrowerName }));

                res.json({ today: new Date().toISOString().split('T')[0], counts, flagged });
            });
        });
    });

    // Get Assets for Dropdown
    router.get('/assets', async (req, res) => {
        await dbReady;
        db.all(`SELECT assetID, assetName, status FROM Assets ORDER BY assetName ASC, assetID ASC`, (err, rows) => {
            res.json(rows || []);
        });
    });

    // Temporary Route for "Mark Returned" button (For testing)
    router.post('/return/:id', async (req, res) => {
        await dbReady;
        db.get(`SELECT assetID FROM LoanTransactions WHERE transactionID = ?`, [req.params.id], (err, row) => {
            if (row) {
                db.serialize(() => {
                    db.run(`UPDATE LoanTransactions SET status = 'Returned', checkinDate = date('now') WHERE transactionID = ?`, [req.params.id]);
                    db.run(`UPDATE Assets SET status = 'Available' WHERE assetID = ?`, [row.assetID], () => res.json({ ok: true }));
                });
            }
        });
    });

    // Connect the routes to /api/loans
    app.use('/api/loans', router);

    // Serve the HTML page
    app.get('/loaning', (req, res) => {
        res.sendFile(path.join(__dirname, 'loaning.html'));
    });

    return { runDailyCheck }; // Return for testing purposes
};