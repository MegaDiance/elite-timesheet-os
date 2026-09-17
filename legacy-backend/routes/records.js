const express = require('express');
const router = express.Router();
const { randomUUID: uuidv4 } = require('crypto');
const { db } = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

function rangesOverlap(s1, e1, s2, e2) {
    if (e1 <= s1) e1 += 24 * 60;
    if (e2 <= s2) e2 += 24 * 60;
    return Math.max(s1, s2) < Math.min(e1, e2);
}

const toMins = t => { if(!t) return 0; let [h,m] = t.split(':').map(Number); return h*60+m; };

// Check locks middleware
async function checkLocks(req, res, next) {
    const { record_date } = req.body;
    if (!record_date) return next(); // Not applicable

    // Calculate fortnight start (mocking frontend logic)
    
    const parts = record_date.split('-');
    const dt = new Date(parts[0], parts[1]-1, parts[2], 0, 0, 0, 0);

    
    const ref = new Date(2026, 2, 29, 0, 0, 0, 0); 
 
    const diff = Math.floor((dt - ref) / 86400000);
    const offset = Math.floor(diff / 14);
    const fnStart = new Date(ref.getTime() + offset * 14 * 86400000);
    
    const fnIso = fnStart.getFullYear() + '-' + String(fnStart.getMonth()+1).padStart(2,'0') + '-' + String(fnStart.getDate()).padStart(2,'0');


    const lock = await db.getAsync('SELECT * FROM fortnight_locks WHERE org_id = ? AND start_date = ?', [req.user.orgId, fnIso]);
    if (lock) {
        if (lock.roster_locked) {
            return res.status(403).json({ success: false, error: { code: 'ROSTER_LOCKED', message: 'Roster is locked for this period.' }});
        }
        if (lock.timesheet_locked) {
            return res.status(403).json({ success: false, error: { code: 'TIMESHEET_LOCKED', message: 'Timesheets are locked for this period.' }});
        }
    }
    next();
}

router.get('/', requireAuth, async (req, res, next) => {
    try {
        const records = await db.allAsync('SELECT * FROM daily_records WHERE org_id = ?', [req.user.orgId]);
        for (let rec of records) {
            rec.segments = await db.allAsync('SELECT * FROM shift_segments WHERE record_id = ?', [rec.id]);
        }
        res.json({ success: true, data: records });
    } catch (err) { next(err); }
});

router.post('/', requireAuth, requireRole(['Admin', 'Company Admin', 'Manager']), checkLocks, async (req, res, next) => {
    try {
        const { employee_id, record_date, segments } = req.body;
        
        // Validation: Overlaps
        if (segments && Array.isArray(segments)) {
            for(let i=0; i<segments.length; i++) {
                for(let j=i+1; j<segments.length; j++) {
                    const s1 = segments[i], s2 = segments[j];
                    if(!s1.is_unplanned && !s2.is_unplanned && s1.roster_in && s1.roster_out && s2.roster_in && s2.roster_out) {
                        if(rangesOverlap(toMins(s1.roster_in), toMins(s1.roster_out), toMins(s2.roster_in), toMins(s2.roster_out))) {
                            return res.status(400).json({ success: false, error: { code: 'OVERLAP', message: 'Roster times overlap.' }});
                        }
                    }
                    if(s1.actual_in && s1.actual_out && s2.actual_in && s2.actual_out) {
                        if(rangesOverlap(toMins(s1.actual_in), toMins(s1.actual_out), toMins(s2.actual_in), toMins(s2.actual_out))) {
                            return res.status(400).json({ success: false, error: { code: 'OVERLAP', message: 'Actual times overlap.' }});
                        }
                    }
                }
            }
        }

        await db.runAsync('BEGIN TRANSACTION');
        try {
            // Delete existing segments for this day
            let rec = await db.getAsync('SELECT * FROM daily_records WHERE org_id = ? AND employee_id = ? AND record_date = ?', 
                [req.user.orgId, employee_id, record_date]);
            
            if (rec) {
                await db.runAsync('DELETE FROM shift_segments WHERE record_id = ?', [rec.id]);
            } else {
                rec = { id: uuidv4() };
                await db.runAsync('INSERT INTO daily_records (id, org_id, employee_id, record_date) VALUES (?, ?, ?, ?)', 
                    [rec.id, req.user.orgId, employee_id, record_date]);
            }

            let has_actuals = 0;
            if (segments && Array.isArray(segments)) {
                for (const seg of segments) {
                    if (seg.actual_hours > 0) has_actuals = 1;
                    await db.runAsync(`
                        INSERT INTO shift_segments (
                            id, record_id, segment_type, is_unplanned,
                            roster_in, roster_out, roster_hours,
                            actual_in, actual_out, actual_hours
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    `, [
                        uuidv4(), rec.id, seg.segment_type, seg.is_unplanned ? 1 : 0,
                        seg.roster_in || null, seg.roster_out || null, seg.roster_hours || 0,
                        seg.actual_in || null, seg.actual_out || null, seg.actual_hours || 0
                    ]);
                }
            }
            await db.runAsync('UPDATE daily_records SET has_actuals = ? WHERE id = ?', [has_actuals, rec.id]);

            await db.runAsync('COMMIT');
            res.json({ success: true });
        } catch (err) {
            await db.runAsync('ROLLBACK');
            throw err;
        }
    } catch (err) { next(err); }
});

module.exports = router;
