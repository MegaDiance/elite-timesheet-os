const request = require('supertest');
const app = require('./server');
const { db } = require('./db');
const { randomUUID } = require('crypto');

describe('Security & Privacy Tests', () => {
    let token = '';

    beforeAll(async () => {
        await new Promise(r => setTimeout(r, 1000)); 
        const res = await request(app).post('/api/auth/login').send({ email: 'admin@elite.local', password: '1234' });
        token = res.body.data.token;
    });

    it('should reject unauthenticated access', async () => {
        const res = await request(app).get('/api/employees');
        expect(res.statusCode).toEqual(401);
        expect(res.body.error.code).toEqual('UNAUTHORIZED');
    });

    it('should not leak stack traces on error', async () => {
        const res2 = await request(app).post('/api/auth/login').set('Content-Type', 'application/json').send('{ bad json');
        expect(res2.statusCode).toEqual(400);
        expect(res2.body).not.toHaveProperty('stack');
    });

    it('should enforce role-based access control', async () => {
        const viewerId = randomUUID();
        const orgId = (await db.getAsync('SELECT org_id FROM users LIMIT 1')).org_id;
        const email = `viewer_${randomUUID()}@elite.local`;
        await db.runAsync('INSERT INTO users (id, org_id, email, password_hash, role) VALUES (?, ?, ?, ?, ?)', [
            viewerId, orgId, email, 'hash', 'Viewer'
        ]);

        const jwt = require('jsonwebtoken');
        const viewerToken = jwt.sign({ userId: viewerId, orgId, role: 'Viewer' }, process.env.JWT_SECRET || 'super-secure-secret-for-dev');

        const res = await request(app).post('/api/employees').set('Authorization', `Bearer ${viewerToken}`).send({ full_name: 'Hacked' });
        expect(res.statusCode).toEqual(403);
        expect(res.body.error.code).toEqual('FORBIDDEN');
    });

    it('should enforce organization isolation', async () => {
        const newOrgId = randomUUID();
        await db.runAsync('INSERT INTO organizations (id, name) VALUES (?, ?)', [newOrgId, 'Evil Corp']);
        
        const evilUserId = randomUUID();
        const email = `evil_${randomUUID()}@elite.local`;
        await db.runAsync('INSERT INTO users (id, org_id, email, password_hash, role) VALUES (?, ?, ?, ?, ?)', [
            evilUserId, newOrgId, email, 'hash', 'Admin'
        ]);

        const jwt = require('jsonwebtoken');
        const evilToken = jwt.sign({ userId: evilUserId, orgId: newOrgId, role: 'Admin' }, process.env.JWT_SECRET || 'super-secure-secret-for-dev');

        const res = await request(app).get('/api/employees').set('Authorization', `Bearer ${evilToken}`);
        expect(res.statusCode).toEqual(200);
        expect(res.body.data.length).toEqual(0);
    });

    it('should prevent locking bypass', async () => {
        const date = '2026-03-30';
        await request(app).post('/api/locks').set('Authorization', `Bearer ${token}`).send({ start_date: date, roster_locked: true, timesheet_locked: false });

        const res = await request(app).post('/api/records').set('Authorization', `Bearer ${token}`).send({
            employee_id: randomUUID(),
            record_date: date,
            segments: []
        });

        expect(res.statusCode).toEqual(403);
        expect(res.body.error.code).toEqual('ROSTER_LOCKED');
    });
});
