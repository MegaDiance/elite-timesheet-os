const express = require('express');
const router = express.Router();
const { randomUUID: uuidv4 } = require('crypto');
const { db } = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

router.get('/', requireAuth, async (req, res, next) => {
    try {
        const locks = await db.allAsync('SELECT start_date, roster_locked, timesheet_locked FROM fortnight_locks WHERE org_id = ?', [req.user.orgId]);
        res.json({ success: true, data: locks });
    } catch (err) { next(err); }
});

router.post('/', requireAuth, requireRole(['Admin', 'Company Admin', 'Manager']), async (req, res, next) => {
    try {
        const { start_date, roster_locked, timesheet_locked } = req.body;
        
        await db.runAsync(`
            INSERT INTO fortnight_locks (id, org_id, start_date, roster_locked, timesheet_locked)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(org_id, start_date) DO UPDATE SET 
                roster_locked = excluded.roster_locked,
                timesheet_locked = excluded.timesheet_locked
        `, [uuidv4(), req.user.orgId, start_date, roster_locked ? 1 : 0, timesheet_locked ? 1 : 0]);

        // Audit log
        await db.runAsync(`INSERT INTO audit_logs (id, org_id, timestamp, actor_id, action, details) VALUES (?, ?, ?, ?, ?, ?)`,
            [uuidv4(), req.user.orgId, new Date().toISOString(), req.user.userId, 'LOCKED', `Updated lock for fortnight ${start_date}`]);

        res.json({ success: true });
    } catch (err) { next(err); }
});

module.exports = router;
