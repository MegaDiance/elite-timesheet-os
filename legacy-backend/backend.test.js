const request = require('supertest');
const app = require('./server');
const { db, initializeSchema } = require('./db');

describe('Backend Tests', () => {
    let token = '';

    beforeAll(async () => {
        await new Promise(r => setTimeout(r, 1000)); 
    });

    it('should login and get a token', async () => {
        const res = await request(app)
            .post('/api/auth/login')
            .send({ email: 'admin@elite.local', password: '1234' });
        expect(res.statusCode).toEqual(200);
        expect(res.body.success).toBe(true);
        token = res.body.data.token;
    });

    it('should fail with invalid password safely', async () => {
        const res = await request(app)
            .post('/api/auth/login')
            .send({ email: 'admin@elite.local', password: 'wrong' });
        expect(res.statusCode).toEqual(401);
        expect(res.body.success).toBe(false);
        expect(res.body.error.code).toEqual('AUTH_FAILED');
        expect(res.body.error.requestId).toBeDefined();
    });

    it('should migrate data', async () => {
        const name = 'Test User ' + Date.now();
        const emps = {};
        emps[name] = { dept: 'IT', contracted: 38 };
        const res = await request(app)
            .post('/api/migrate')
            .set('Authorization', `Bearer ${token}`)
            .send({
                employees: emps,
                records: [],
                lockedRosters: [],
                lockedTimesheets: [],
                auditLog: []
            });
        expect(res.statusCode).toEqual(200);
        expect(res.body.success).toBe(true);
    });

    it('should fetch employees', async () => {
        const res = await request(app)
            .get('/api/employees')
            .set('Authorization', `Bearer ${token}`);
        expect(res.statusCode).toEqual(200);
        expect(res.body.data.length).toBeGreaterThan(0);
    });

    it('should rate limit login attempts', async () => {
        // Attempt 5 wrong logins
        for (let i = 0; i < 5; i++) {
            await request(app)
                .post('/api/auth/login')
                .send({ email: 'brute@elite.local', password: 'wrong' });
        }
        // 6th attempt should return 429
        const res = await request(app)
            .post('/api/auth/login')
            .send({ email: 'brute@elite.local', password: 'wrong' });
        
        expect(res.statusCode).toEqual(429);
        expect(res.body.error.code).toEqual('TOO_MANY_REQUESTS');
    });

    it('should not leak existence of user during reset-request', async () => {
        const resValid = await request(app)
            .post('/api/auth/reset-request')
            .send({ email: 'admin@elite.local' });
        
        const resInvalid = await request(app)
            .post('/api/auth/reset-request')
            .send({ email: 'nonexistent@elite.local' });

        expect(resValid.statusCode).toEqual(200);
        expect(resInvalid.statusCode).toEqual(200);
        expect(resValid.body.message).toEqual(resInvalid.body.message);
    });
});
