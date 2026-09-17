const express = require('express');
const router = express.Router();
const { db } = require('../db');
const { requireAuth } = require('../middleware/auth');

router.get('/me', requireAuth, async (req, res, next) => {
    try {
        const org = await db.getAsync('SELECT id, name FROM organizations WHERE id = ?', [req.user.orgId]);
        if (!org) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Organisation not found' } });
        res.json({ success: true, data: org });
    } catch (err) { next(err); }
});

module.exports = router;
