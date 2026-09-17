import request from 'supertest';
import app from '../src/index';
import { newDb } from 'pg-mem';
import { setPool } from '../src/services/db';
import { clearAllRateLimits } from '../src/routes/auth';

describe('Auth Routes', () => {
    beforeAll(async () => {
        const db = newDb();
        db.public.registerFunction({
            name: 'gen_random_uuid',
            args: [],
            returns: 'uuid',
            implementation: () => '123e4567-e89b-12d3-a456-426614174000',
        });
        
        db.public.none(`
            CREATE TABLE organisations (id UUID PRIMARY KEY, name TEXT);
            CREATE TABLE organisation_members(user_id UUID, role TEXT, organisation_id UUID); 
            CREATE TABLE users (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                org_id UUID,
                role TEXT,
                email TEXT UNIQUE NOT NULL,
                password_hash TEXT,
                two_factor_enabled BOOLEAN DEFAULT false,
                is_active BOOLEAN DEFAULT true,
                created_at TIMESTAMP DEFAULT NOW()
            );
        `);
        
        const { hashPassword } = require('../src/services/auth');
        const hash = await hashPassword('password123');
        db.public.none(`INSERT INTO users (email, password_hash, role) VALUES ('test@elite.local', '` + hash + `', 'Company Admin')`);

        const Pool = db.adapters.createPg().Pool;
        setPool(new Pool());
        clearAllRateLimits();
    });

    beforeEach(() => {
        clearAllRateLimits();
    });

    afterAll(() => {
        clearAllRateLimits();
    });

    it('should fail with missing credentials', async () => {
        const res = await request(app).post('/api/auth/login').send({});
        expect(res.status).toBe(400);
    });

    it('should login with correct credentials', async () => {
        const res = await request(app).post('/api/auth/login').send({
            email: 'test@elite.local',
            password: 'password123'
        });
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.token).toBeDefined();
    });

    it('should reject unauthorized organisation switching', async () => {
        const loginRes = await request(app).post('/api/auth/login').send({
            email: 'test@elite.local',
            password: 'password123'
        });
        expect(loginRes.status).toBe(200);
        const token = loginRes.body.data.token;

        const switchRes = await request(app)
            .post('/api/auth/switch-organisation')
            .set('Authorization', `Bearer ${token}`)
            .send({ organisation_id: '123e4567-e89b-12d3-a456-999999999999' });

        expect(switchRes.status).toBe(403);
    });

    it('should fail and rate limit after 5 failed attempts', async () => {
        for(let i=0; i<5; i++) {
            const res = await request(app).post('/api/auth/login').send({
                email: 'test@elite.local',
                password: 'wrong'
            });
            expect(res.status).toBe(401);
        }

        const blocked = await request(app).post('/api/auth/login').send({
            email: 'test@elite.local',
            password: 'wrong'
        });
        expect(blocked.status).toBe(429);
    });
});

