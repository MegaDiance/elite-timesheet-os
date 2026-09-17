const express = require('express');
const router = express.Router();
const { randomUUID: uuidv4 } = require('crypto');
const { db } = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

router.post('/', requireAuth, requireRole(['Admin', 'Company Admin']), async (req, res, next) => {
    try {
        const { employees, records, lockedRosters, lockedTimesheets, auditLog } = req.body;
        const orgId = req.user.orgId;
        const actorId = req.user.userId;

        // Use a transaction for migration
        await db.runAsync('BEGIN TRANSACTION');

        try {
            // 1. Employees & Templates
            const employeeMap = {}; // mapping fullName -> id
            if (employees) {
                for (const [fullName, data] of Object.entries(employees)) {
                    const empId = uuidv4();
                    employeeMap[fullName] = empId;

                    await db.runAsync(`
                        INSERT INTO employees (id, org_id, full_name, department, email, phone, contracted_hours)
                        VALUES (?, ?, ?, ?, ?, ?, ?)
                    `, [empId, orgId, fullName, data.dept || null, data.email || null, data.phone || null, data.contracted || 76]);

                    if (data.template && Array.isArray(data.template)) {
                        for (let i = 0; i < data.template.length; i++) {
                            const t = data.template[i];
                            const tId = uuidv4();
                            await db.runAsync(`
                                INSERT INTO roster_templates (id, employee_id, day_index, is_off, roster_in, roster_out)
                                VALUES (?, ?, ?, ?, ?, ?)
                            `, [tId, empId, i, t.off ? 1 : 0, t.scIn || null, t.scOut || null]);
                        }
                    }
                }
            }

            // 2. Records & Segments
            if (records && Array.isArray(records)) {
                for (const rec of records) {
                    const empId = employeeMap[rec.emp];
                    if (!empId) continue; // skip if employee not found

                    const recId = uuidv4();
                    await db.runAsync(`
                        INSERT INTO daily_records (id, org_id, employee_id, record_date, has_actuals)
                        VALUES (?, ?, ?, ?, ?)
                    `, [recId, orgId, empId, rec.date, rec.hasActuals ? 1 : 0]);

                    if (rec.segments && Array.isArray(rec.segments)) {
                        for (const seg of rec.segments) {
                            const segId = uuidv4();
                            await db.runAsync(`
                                INSERT INTO shift_segments (
                                    id, record_id, segment_type, is_unplanned,
                                    roster_in, roster_out, roster_hours,
                                    actual_in, actual_out, actual_hours
                                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                            `, [
                                segId, recId, seg.type, seg.unplanned ? 1 : 0,
                                seg.scIn || null, seg.scOut || null, seg.scHrs || 0,
                                seg.acIn || null, seg.acOut || null, seg.acHrs || 0
                            ]);
                        }
                    }
                }
            }

            // 3. Locks
            if (lockedRosters && Array.isArray(lockedRosters)) {
                for (const date of lockedRosters) {
                    await db.runAsync(`
                        INSERT INTO fortnight_locks (id, org_id, start_date, roster_locked, timesheet_locked)
                        VALUES (?, ?, ?, 1, 0)
                        ON CONFLICT(org_id, start_date) DO UPDATE SET roster_locked = 1
                    `, [uuidv4(), orgId, date]);
                }
            }
            if (lockedTimesheets && Array.isArray(lockedTimesheets)) {
                for (const date of lockedTimesheets) {
                    await db.runAsync(`
                        INSERT INTO fortnight_locks (id, org_id, start_date, roster_locked, timesheet_locked)
                        VALUES (?, ?, ?, 0, 1)
                        ON CONFLICT(org_id, start_date) DO UPDATE SET timesheet_locked = 1
                    `, [uuidv4(), orgId, date]);
                }
            }

            // 4. Audit Logs
            if (auditLog && Array.isArray(auditLog)) {
                for (const log of auditLog) {
                    const logId = uuidv4();
                    await db.runAsync(`
                        INSERT INTO audit_logs (id, org_id, timestamp, actor_id, action, entity_id, details, snapshot)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    `, [
                        logId, orgId, log.timestamp || new Date().toISOString(), actorId,
                        log.action, log.employee || null, log.details || null,
                        log.snapshot ? JSON.stringify(log.snapshot) : null
                    ]);
                }
            }

            // Initial migration audit log
            await db.runAsync(`
                INSERT INTO audit_logs (id, org_id, timestamp, actor_id, action, details)
                VALUES (?, ?, ?, ?, ?, ?)
            `, [uuidv4(), orgId, new Date().toISOString(), actorId, 'SYSTEM_MIGRATION', 'Completed initial data migration from localStorage']);

            await db.runAsync('COMMIT');
            console.log(`[MIGRATION] Migration successful for org_id=${orgId} req_id=${req.requestId}`);
            res.json({ success: true, message: 'Migration completed successfully.' });
        } catch (err) {
            await db.runAsync('ROLLBACK');
            throw err;
        }
    } catch (err) {
        console.error(`[MIGRATION] Error: ${err.message}`, err.stack);
        next(err);
    }
});

module.exports = router;
