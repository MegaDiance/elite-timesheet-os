const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { randomUUID } = require('crypto');
const { db } = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

// Get all employees for the org (can filter by include_inactive)
router.get('/', requireAuth, async (req, res, next) => {
    try {
        const includeInactive = req.query.include_inactive === 'true';
        const query = includeInactive 
            ? 'SELECT e.*, u.id as user_account_id, u.email as user_email, u.role as user_role, u.is_active as user_is_active, (u.password_hash = \'PENDING_SETUP\') as is_pending_setup FROM employees e LEFT JOIN users u ON e.user_id = u.id WHERE e.org_id = ?'
            : 'SELECT e.*, u.id as user_account_id, u.email as user_email, u.role as user_role, u.is_active as user_is_active, (u.password_hash = \'PENDING_SETUP\') as is_pending_setup FROM employees e LEFT JOIN users u ON e.user_id = u.id WHERE e.org_id = ? AND e.is_active = 1';
        
        const emps = await db.allAsync(query, [req.user.orgId]);
        for (let emp of emps) {
            emp.template = await db.allAsync('SELECT * FROM roster_templates WHERE employee_id = ? ORDER BY day_index ASC', [emp.id]);
        }
        res.json({ success: true, data: emps });
    } catch (err) { next(err); }
});

// Create employee record
router.post('/', requireAuth, requireRole(['Admin', 'Company Admin', 'Manager']), async (req, res, next) => {
    try {
        // Password removed from creation!
        const { full_name, department, email, phone, contracted_hours, create_account, role } = req.body;
        if (!full_name) {
            return res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: 'full_name is required' }});
        }
        
        await db.runAsync('BEGIN TRANSACTION');
        try {
            const empId = randomUUID();
            let userId = null;

            if (create_account && email) {
                userId = randomUUID();
                const userRole = role || 'Employee';
                
                // create user with no password hash initially, and is_active 0 (pending setup)
                await db.runAsync(`INSERT INTO users (id, org_id, email, password_hash, role, is_active) VALUES (?, ?, ?, ?, ?, ?)`,
                    [userId, req.user.orgId, email, 'PENDING_SETUP', userRole, 0]);

                // generate invitation
                const token = crypto.randomBytes(32).toString('hex');
                const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
                const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(); // 7 days
                
                await db.runAsync('INSERT INTO invitation_tokens (token_hash, user_id, expires_at) VALUES (?, ?, ?)', [tokenHash, userId, expiresAt]);
                
                // Mock email sending
                console.log(`\n========================================`);
                console.log(`MOCK EMAIL SENT TO: ${email}`);
                console.log(`SUBJECT: Invitation to Elite Timesheet OS Pro`);
                console.log(`BODY: Click the link below to set up your account:`);
                console.log(`http://localhost:3003/?invite=${token}`);
                console.log(`========================================\n`);
            }

            await db.runAsync(`
                INSERT INTO employees (id, org_id, user_id, full_name, department, email, phone, contracted_hours)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `, [empId, req.user.orgId, userId, full_name, department || null, email || null, phone || null, contracted_hours || 76]);

            await db.runAsync(`INSERT INTO audit_logs (id, org_id, timestamp, actor_id, action, entity_id, details) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [randomUUID(), req.user.orgId, new Date().toISOString(), req.user.userId, 'CREATED', empId, `Created employee ${full_name}`]);

            await db.runAsync('COMMIT');
            res.json({ success: true, data: { id: empId, user_id: userId } });
        } catch (err) {
            await db.runAsync('ROLLBACK');
            throw err;
        }
    } catch (err) { next(err); }
});

// Update employee record
router.put('/:id', requireAuth, requireRole(['Admin', 'Company Admin', 'Manager']), async (req, res, next) => {
    try {
        const empId = req.params.id;
        const { full_name, department, email, phone, contracted_hours } = req.body;

        const emp = await db.getAsync('SELECT * FROM employees WHERE id = ? AND org_id = ?', [empId, req.user.orgId]);
        if (!emp) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Employee not found' }});

        await db.runAsync(`
            UPDATE employees SET full_name = ?, department = ?, email = ?, phone = ?, contracted_hours = ?
            WHERE id = ?
        `, [full_name, department, email, phone, contracted_hours, empId]);

        await db.runAsync(`INSERT INTO audit_logs (id, org_id, timestamp, actor_id, action, entity_id, details) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [randomUUID(), req.user.orgId, new Date().toISOString(), req.user.userId, 'UPDATED', empId, `Updated employee ${full_name}`]);

        res.json({ success: true });
    } catch (err) { next(err); }
});

// Deactivate employee
router.post('/:id/deactivate', requireAuth, requireRole(['Admin', 'Company Admin']), async (req, res, next) => {
    try {
        const empId = req.params.id;
        const emp = await db.getAsync('SELECT * FROM employees WHERE id = ? AND org_id = ?', [empId, req.user.orgId]);
        if (!emp) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Employee not found' }});

        await db.runAsync('BEGIN TRANSACTION');
        try {
            await db.runAsync('UPDATE employees SET is_active = 0 WHERE id = ?', [empId]);
            if (emp.user_id) {
                await db.runAsync('UPDATE users SET is_active = 0 WHERE id = ?', [emp.user_id]);
            }

            await db.runAsync(`INSERT INTO audit_logs (id, org_id, timestamp, actor_id, action, entity_id, details) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [randomUUID(), req.user.orgId, new Date().toISOString(), req.user.userId, 'DEACTIVATED', empId, `Deactivated employee ${emp.full_name}`]);

            await db.runAsync('COMMIT');
            res.json({ success: true, message: 'Employee deactivated. Historical data preserved.' });
        } catch (err) {
            await db.runAsync('ROLLBACK');
            throw err;
        }
    } catch (err) { next(err); }
});

// Reactivate employee
router.post('/:id/reactivate', requireAuth, requireRole(['Admin', 'Company Admin']), async (req, res, next) => {
    try {
        const empId = req.params.id;
        const emp = await db.getAsync('SELECT * FROM employees WHERE id = ? AND org_id = ?', [empId, req.user.orgId]);
        if (!emp) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Employee not found' }});

        await db.runAsync('BEGIN TRANSACTION');
        try {
            await db.runAsync('UPDATE employees SET is_active = 1 WHERE id = ?', [empId]);
            if (emp.user_id) {
                await db.runAsync('UPDATE users SET is_active = 1 WHERE id = ?', [emp.user_id]);
            }

            await db.runAsync(`INSERT INTO audit_logs (id, org_id, timestamp, actor_id, action, entity_id, details) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [randomUUID(), req.user.orgId, new Date().toISOString(), req.user.userId, 'REACTIVATED', empId, `Reactivated employee ${emp.full_name}`]);

            await db.runAsync('COMMIT');
            res.json({ success: true, message: 'Employee reactivated.' });
        } catch (err) {
            await db.runAsync('ROLLBACK');
            throw err;
        }
    } catch (err) { next(err); }
});

// Send Password Reset explicitly by Admin
router.post('/:id/send-reset', requireAuth, requireRole(['Admin', 'Company Admin']), async (req, res, next) => {
    try {
        const empId = req.params.id;
        const emp = await db.getAsync('SELECT e.*, u.email as user_email, u.id as u_id FROM employees e JOIN users u ON e.user_id = u.id WHERE e.id = ? AND e.org_id = ?', [empId, req.user.orgId]);
        if (!emp) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Employee or linked account not found' }});

        const token = crypto.randomBytes(32).toString('hex');
        const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
        const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString(); // 15 mins
        
        await db.runAsync('BEGIN TRANSACTION');
        try {
            await db.runAsync('INSERT INTO reset_tokens (token_hash, user_id, expires_at) VALUES (?, ?, ?)', [tokenHash, emp.u_id, expiresAt]);
            
            await db.runAsync(`INSERT INTO audit_logs (id, org_id, timestamp, actor_id, action, entity_id, details) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [randomUUID(), req.user.orgId, new Date().toISOString(), req.user.userId, 'RESET_REQUESTED', empId, `Admin requested password reset for ${emp.user_email}`]);

            await db.runAsync('COMMIT');

            console.log(`\n========================================`);
            console.log(`MOCK EMAIL SENT TO: ${emp.user_email}`);
            console.log(`SUBJECT: Password Reset Request (Admin Initiated)`);
            console.log(`BODY: Click the link below to reset your password:`);
            console.log(`http://localhost:3003/?reset=${token}`);
            console.log(`========================================\n`);

            res.json({ success: true, message: 'Password reset email sent.' });
        } catch (err) {
            await db.runAsync('ROLLBACK');
            throw err;
        }
    } catch (err) { next(err); }
});

// Resend Invitation explicitly by Admin
router.post('/:id/send-invitation', requireAuth, requireRole(['Admin', 'Company Admin']), async (req, res, next) => {
    try {
        const empId = req.params.id;
        const emp = await db.getAsync('SELECT e.*, u.email as user_email, u.id as u_id, u.password_hash FROM employees e JOIN users u ON e.user_id = u.id WHERE e.id = ? AND e.org_id = ?', [empId, req.user.orgId]);
        if (!emp) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Employee or linked account not found' }});

        if (emp.password_hash !== 'PENDING_SETUP') {
            return res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: 'Account is already set up.' }});
        }

        const token = crypto.randomBytes(32).toString('hex');
        const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(); // 7 days
        
        await db.runAsync('BEGIN TRANSACTION');
        try {
            // Delete old tokens for this user just in case
            await db.runAsync('DELETE FROM invitation_tokens WHERE user_id = ?', [emp.u_id]);
            await db.runAsync('INSERT INTO invitation_tokens (token_hash, user_id, expires_at) VALUES (?, ?, ?)', [tokenHash, emp.u_id, expiresAt]);
            
            await db.runAsync(`INSERT INTO audit_logs (id, org_id, timestamp, actor_id, action, entity_id, details) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [randomUUID(), req.user.orgId, new Date().toISOString(), req.user.userId, 'INVITE_SENT', empId, `Admin sent invitation to ${emp.user_email}`]);

            await db.runAsync('COMMIT');

            console.log(`\n========================================`);
            console.log(`MOCK EMAIL SENT TO: ${emp.user_email}`);
            console.log(`SUBJECT: Invitation to Elite Timesheet OS Pro`);
            console.log(`BODY: Click the link below to set up your account:`);
            console.log(`http://localhost:3003/?invite=${token}`);
            console.log(`========================================\n`);

            res.json({ success: true, message: 'Invitation email sent.' });
        } catch (err) {
            await db.runAsync('ROLLBACK');
            throw err;
        }
    } catch (err) { next(err); }
});

module.exports = router;
