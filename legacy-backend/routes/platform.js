const express = require('express');
const router = express.Router();
const { randomUUID } = require('crypto');
const bcrypt = require('bcryptjs');
const { db } = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

// Require Platform Admin
router.use(requireAuth, requireRole(['Platform Admin']));

// List all organizations
router.get('/organisations', async (req, res, next) => {
    try {
        const orgs = await db.allAsync(`
            SELECT o.*, COUNT(u.id) as user_count 
            FROM organizations o 
            LEFT JOIN users u ON o.id = u.org_id 
            GROUP BY o.id
        `);
        res.json({ success: true, data: orgs });
    } catch (err) { next(err); }
});

// Create new organization & primary admin user
router.post('/organisations', async (req, res, next) => {
    try {
        const { name, admin_email, admin_password } = req.body;
        if (!name || !admin_email || !admin_password) {
            return res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: 'Organization name, admin email, and password required.' } });
        }

        await db.runAsync('BEGIN TRANSACTION');
        try {
            const orgId = randomUUID();
            await db.runAsync('INSERT INTO organizations (id, name) VALUES (?, ?)', [orgId, name]);

            const userId = randomUUID();
            const hash = await bcrypt.hash(admin_password, 10);
            await db.runAsync('INSERT INTO users (id, org_id, email, password_hash, role) VALUES (?, ?, ?, ?, ?)', [
                userId, orgId, admin_email, hash, 'Company Admin'
            ]);

            await db.runAsync('INSERT INTO audit_logs (id, org_id, timestamp, actor_id, action, details) VALUES (?, ?, ?, ?, ?, ?)',
                [randomUUID(), orgId, new Date().toISOString(), req.user.userId, 'ORG_CREATED', `Created organisation ${name}`]);

            await db.runAsync('COMMIT');
            res.json({ success: true, data: { id: orgId, admin_id: userId } });
        } catch (err) {
            await db.runAsync('ROLLBACK');
            throw err;
        }
    } catch (err) { next(err); }
});

module.exports = router;
