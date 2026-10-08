import { Router, Response } from 'express';
import { requireAuth, requirePermission, Permission, AuthRequest, sendError } from '../middleware/auth';
import { isUuid, notFound } from '../services/policy';
import { checkRows, importRows, readJob } from '../services/staffImport';

/**
 * Staff import (services/staffImport.ts). Adding staff needs employees.create; each row's branch is
 * checked against where the caller holds it.
 *
 *   POST /api/staff-import/validate  { rows }  → every row with its problems; nothing is written
 *   POST /api/staff-import           { rows }  → 201 imported, 202 queued (large files), or 422 with the problem rows
 *   GET  /api/staff-import/jobs/:id            → progress of a queued import
 */
const router = Router();
router.use(requireAuth, requirePermission(Permission.EMPLOYEES_CREATE));

router.post('/validate', async (req: AuthRequest, res: Response) => {
    try {
        const result = await checkRows(req.auth!, req.body?.rows);
        res.json({ success: true, data: result });
    } catch (err) {
        sendError(res, err, 'STAFF IMPORT VALIDATE ERROR');
    }
});

router.post('/', async (req: AuthRequest, res: Response) => {
    try {
        const outcome = await importRows(req.auth!, req.body?.rows);
        if (outcome.kind === 'invalid') {
            return res.status(422).json({
                success: false,
                error: { code: 'IMPORT_INVALID', message: `${outcome.invalid} ${outcome.invalid === 1 ? 'row has a problem' : 'rows have problems'}. Nothing was imported.` },
                data: { rows: outcome.rows },
            });
        }
        if (outcome.kind === 'queued') {
            return res.status(202).json({ success: true, data: { job_id: outcome.jobId, total: outcome.total }, message: 'Import started.' });
        }
        res.status(201).json({ success: true, data: { imported: outcome.count }, message: `${outcome.count} ${outcome.count === 1 ? 'person' : 'people'} imported.` });
    } catch (err) {
        sendError(res, err, 'STAFF IMPORT ERROR');
    }
});

router.get('/jobs/:id', async (req: AuthRequest, res: Response) => {
    try {
        if (!isUuid(req.params.id)) throw notFound('Import');
        const job = await readJob(req.auth!.orgId, req.params.id);
        if (!job) throw notFound('Import');
        res.json({ success: true, data: job });
    } catch (err) {
        sendError(res, err, 'STAFF IMPORT JOB ERROR');
    }
});

export default router;
