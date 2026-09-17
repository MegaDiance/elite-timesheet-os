require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { db, initializeSchema } = require('./db');
const { randomUUID: uuidv4 } = require('crypto');
const bcrypt = require('bcryptjs');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

app.use((req, res, next) => {
    req.requestId = uuidv4();
    if(req.requestId === undefined) req.requestId = "unknown";
    const start = Date.now();
    res.on('finish', () => {
        console.log(`[REQUEST] req_id=${req.requestId} method=${req.method} url=${req.originalUrl} status=${res.statusCode} duration=${Date.now() - start}ms`);
    });
    next();
});

// Import Routes
const platformRoutes = require("./routes/platform");
const organisationRoutes = require("./routes/organisation");

const locksRoutes = require("./routes/locks");

const employeesRoutes = require("./routes/employees");
const recordsRoutes = require("./routes/records");

const authRoutes = require('./routes/auth');
const migrateRoutes = require('./routes/migrate');
app.use('/api/auth', authRoutes);
app.use('/api/employees', employeesRoutes);
app.use('/api/records', recordsRoutes);
app.use('/api/locks', locksRoutes);
app.use('/api/platform', platformRoutes);
app.use('/api/organisation', organisationRoutes);
app.use('/api/migrate', migrateRoutes);

app.use((err, req, res, next) => {
    console.error(`[ERROR] req_id=${req.requestId} msg=${err.message}`, err.stack);
    res.status(err.status || 500).json({
        success: false,
        error: {
            code: 'INTERNAL_ERROR',
            message: 'An unexpected error occurred.',
            requestId: req.requestId
        }
    });
});

async function startServer() {
    await initializeSchema();

    // Check if we need to seed the initial org and admin user
    const org = await db.getAsync('SELECT * FROM organizations LIMIT 1');
    if (!org) {
        const orgId = uuidv4();
        await db.runAsync('INSERT INTO organizations (id, name) VALUES (?, ?)', [orgId, 'Acme Corp']);
        const hash = await bcrypt.hash('1234', 10);
        await db.runAsync('INSERT INTO users (id, org_id, email, password_hash, role) VALUES (?, ?, ?, ?, ?)', [
            uuidv4(), orgId, 'admin@elite.local', hash, 'Company Admin'
        ]);
        await db.runAsync('INSERT INTO users (id, org_id, email, password_hash, role) VALUES (?, ?, ?, ?, ?)', [
            uuidv4(), orgId, 'platform@elite.local', hash, 'Platform Admin'
        ]);
        console.log('Seeded Acme Corp (Company Admin: admin@elite.local, Platform Admin: platform@elite.local / 1234)');
    }

    const port = process.env.PORT || 3003;
    if (require.main === module) {
        app.listen(port, () => {
            console.log(`Server listening on port ${port}`);
        });
    }
}

startServer().catch(err => {
    console.error('Failed to start server:', err);
});

module.exports = app;
