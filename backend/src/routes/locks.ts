import { Router, Response } from 'express';
import crypto from 'crypto';
import { query } from '../services/db';
import { comparePassword } from '../services/auth';
import { requireAuth, requireTenantContext, requireAnyPermission, Permission, AuthRequest } from '../middleware/auth';

const router = Router();
router.use(requireAuth, requireTenantContext);

router.get('/', async (req: AuthRequest, res: Response) => {
    try {
        const orgId = req.user?.organisation_id;
        const result = await query('SELECT start_date, roster_locked, timesheet_locked, is_published FROM fortnight_locks WHERE org_id = $1', [orgId]);
        res.json({ success: true, data: result.rows });
    } catch (err: any) {
        res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: err.message } });
    }
});

router.post('/', requireAuth, requireAnyPermission([Permission.TIMESHEET_LOCK, Permission.ORGANISATION_UPDATE]), async (req: AuthRequest, res: Response) => {
    try {
        const orgId = req.user?.organisation_id;
        const { start_date, roster_locked, timesheet_locked, is_published, password } = req.body;

        if (!password) {
            return res.status(400).json({ success: false, error: { message: 'Password required to update lock status.' } });
        }

        const orgRes = await query('SELECT roster_lock_password_hash, timesheet_lock_password_hash FROM organisations WHERE id = $1', [orgId]);
        const orgData = orgRes.rows[0];

        const userRes = await query('SELECT password_hash FROM users WHERE id = $1', [req.user?.id]);
        if (userRes.rows.length === 0) {
            return res.status(404).json({ success: false, error: { message: 'User not found.' } });
        }
        const userPasswordHash = userRes.rows[0].password_hash;

        // Current lock state
        const currentLockRes = await query('SELECT roster_locked, timesheet_locked, is_published FROM fortnight_locks WHERE org_id = $1 AND start_date = $2', [orgId, start_date]);
        const currentLock = currentLockRes.rows[0] || { roster_locked: false, timesheet_locked: false, is_published: false };

        const isChangingRoster = roster_locked !== undefined && Boolean(roster_locked) !== Boolean(currentLock.roster_locked);
        const isChangingTimesheet = timesheet_locked !== undefined && Boolean(timesheet_locked) !== Boolean(currentLock.timesheet_locked);

        let validAuth = false;
        // Check admin master password fallback
        if (userPasswordHash && await comparePassword(password, userPasswordHash)) {
            validAuth = true;
        } else {
            // Check dedicated lock passwords
            if (isChangingRoster && orgData?.roster_lock_password_hash) {
                if (await comparePassword(password, orgData.roster_lock_password_hash)) {
                    validAuth = true;
                }
            } else if (isChangingTimesheet && orgData?.timesheet_lock_password_hash) {
                if (await comparePassword(password, orgData.timesheet_lock_password_hash)) {
                    validAuth = true;
                }
            }
        }

        if (!validAuth) {
            const errorMsg = isChangingRoster && orgData?.roster_lock_password_hash
                ? 'Invalid Roster Lock password. Access denied.'
                : isChangingTimesheet && orgData?.timesheet_lock_password_hash
                    ? 'Invalid Timesheet Lock password. Access denied.'
                    : 'Invalid password. Lock update denied.';
            return res.status(401).json({ success: false, error: { message: errorMsg } });
        }

        // If unlocking roster, automatically unpublish to prevent leaking unfinished draft shifts
        let finalPublished = is_published !== undefined ? Boolean(is_published) : Boolean(currentLock.is_published);
        if (roster_locked === false && currentLock.is_published) {
            finalPublished = false;
        }

        await query(
            `INSERT INTO fortnight_locks (id, org_id, start_date, roster_locked, timesheet_locked, is_published)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT(org_id, start_date) DO UPDATE SET 
                 roster_locked = EXCLUDED.roster_locked,
                 timesheet_locked = EXCLUDED.timesheet_locked,
                 is_published = EXCLUDED.is_published`,
            [crypto.randomUUID(), orgId, start_date, roster_locked ? true : false, timesheet_locked ? true : false, finalPublished]
        );

        await query(
            `INSERT INTO audit_logs (id, org_id, timestamp, actor_id, action, details) VALUES ($1, $2, $3, $4, $5, $6)`,
            [crypto.randomUUID(), orgId, new Date().toISOString(), req.user?.id, 'LOCKED', `Updated lock/publish state for fortnight ${start_date}`]
        );

        res.json({ success: true, published: finalPublished });
    } catch (err: any) {
        res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: err.message } });
    }
});

router.post('/publish', requireAuth, requireAnyPermission([Permission.TIMESHEET_LOCK, Permission.ORGANISATION_UPDATE]), async (req: AuthRequest, res: Response) => {
    try {
        const orgId = req.user?.organisation_id;
        const { start_date, is_published } = req.body;

        if (!start_date) {
            return res.status(400).json({ success: false, error: { message: 'start_date is required.' } });
        }

        const shouldPublish = is_published !== false;

        // Check if roster is locked before publishing
        const currentLockRes = await query('SELECT roster_locked FROM fortnight_locks WHERE org_id = $1 AND start_date = $2', [orgId, start_date]);
        const isRosterLocked = Boolean(currentLockRes.rows[0]?.roster_locked);

        if (shouldPublish && !isRosterLocked) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'ROSTER_NOT_LOCKED',
                    message: 'The roster must be locked and finalised before pushing it to employees.'
                }
            });
        }

        await query(
            `INSERT INTO fortnight_locks (id, org_id, start_date, is_published)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT(org_id, start_date) DO UPDATE SET 
                 is_published = EXCLUDED.is_published`,
            [crypto.randomUUID(), orgId, start_date, shouldPublish]
        );

        await query(
            `INSERT INTO audit_logs (id, org_id, timestamp, actor_id, action, details) VALUES ($1, $2, $3, $4, $5, $6)`,
            [crypto.randomUUID(), orgId, new Date().toISOString(), req.user?.id, 'ROSTER_PUBLISHED', `${shouldPublish ? 'Published' : 'Unpublished'} roster for fortnight ${start_date}`]
        );

        // If publishing, automatically post system announcement to the organisation
        if (shouldPublish) {
            const authorName = req.user?.email ? req.user.email.split('@')[0] : 'Management';
            const [y, m, d] = start_date.split('-').map(Number);
            const startDt = new Date(Date.UTC(y, m - 1, d));
            const endDt = new Date(startDt);
            endDt.setUTCDate(startDt.getUTCDate() + 13);
            const endDateStr = endDt.toISOString().split('T')[0];

            await query(
                `INSERT INTO organisation_announcements (id, org_id, author_id, author_name, author_role, title, content, is_system, announcement_type)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
                [
                    crypto.randomUUID(),
                    orgId,
                    req.user?.id,
                    authorName,
                    req.user?.role || 'Management',
                    'Official Roster Release',
                    `The official staff roster for the fortnight from ${start_date} to ${endDateStr} has been finalised, locked, and published. Please check your schedule in the portal.`,
                    true,
                    'roster_alert'
                ]
            );
        }

        res.json({ success: true, published: shouldPublish });
    } catch (err: any) {
        res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: err.message } });
    }
});

export default router;
