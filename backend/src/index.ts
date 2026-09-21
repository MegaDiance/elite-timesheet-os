import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import authRoutes from './routes/auth';
import employeesRoutes from './routes/employees';
import recordsRoutes from './routes/records';
import locksRoutes from './routes/locks';
import organisationRoutes from './routes/organisation';
import platformRoutes from './routes/platform';
import locationsRoutes from './routes/locations';
import { initDB } from './services/db';
import path from 'path';
import os from 'os';
import fs from 'fs';

dotenv.config();
dotenv.config({ path: path.join(__dirname, '../.env') });
dotenv.config({ path: path.join(__dirname, '../../.env') });
dotenv.config({ path: path.join(os.homedir(), '.env') });

// Check for key file fallbacks (supports .txt, .rtf, TextEdit files)
const keyCandidates = [
    path.join(__dirname, '../key.txt'),
    path.join(__dirname, '../key.txt.rtf'),
    path.join(__dirname, '../key.rtf'),
    path.join(__dirname, '../../key.txt'),
    path.join(__dirname, '../../key.txt.rtf'),
    path.join(__dirname, '../../key.rtf'),
];

for (const kPath of process.env.NODE_ENV === 'production' ? [] : keyCandidates) {
    if (fs.existsSync(kPath) && !process.env.RESEND_API_KEY) {
        const content = fs.readFileSync(kPath, 'utf8');
        const match = content.match(/re_[a-zA-Z0-9_]+/);
        if (match) {
            process.env.RESEND_API_KEY = match[0];
            console.log(`[ENV] Loaded RESEND_API_KEY from ${path.basename(kPath)}`);
            break;
        }
    }
}

const app = express();

// Secure CORS configuration
const publicUrl = process.env.PUBLIC_URL
    || (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : undefined);

const allowedOrigins = [
    process.env.FRONTEND_URL,
    publicUrl,
    'http://localhost:3000',
    'http://localhost:3001',
    'http://localhost:3002',
    'http://localhost:3003',
    'http://localhost:3004',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:3001',
    'http://127.0.0.1:3002',
    'http://127.0.0.1:3003',
    'http://127.0.0.1:3004',
].filter(Boolean);

app.use(cors({
    origin: (origin, callback) => {
        // Allow requests with no origin (e.g. mobile apps, curl, supertest, local server)
        if (!origin) return callback(null, true);
        if (allowedOrigins.includes(origin) || origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:')) {
            return callback(null, true);
        }
        return callback(new Error('Cross-Origin Request Blocked by Security Policy'));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

// Payload limits to prevent memory exhaustion DoS
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Enterprise Security Headers Middleware
app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader(
        'Content-Security-Policy',
        "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: https:; connect-src 'self' http://localhost:* http://127.0.0.1:* https:;"
    );
    next();
});

import rosterRoutes from './routes/roster';
import portalRoutes from './routes/portal';
import submissionsRoutes from './routes/submissions';
import holidaysRoutes from './routes/holidays';
import reportsRoutes from './routes/reports';
import xeroRoutes from './routes/xero';
import auditRoutes from './routes/audit';
import announcementsRoutes from './routes/announcements';
import dashboardRoutes from './routes/dashboard';
import membershipsRoutes from './routes/memberships';

// Health check (used by Railway to decide the deploy succeeded)
app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok', uptime: process.uptime() });
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api', membershipsRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/employees', employeesRoutes);
app.use('/api/records', recordsRoutes);
app.use('/api/locks', locksRoutes);
app.use('/api/organisation', organisationRoutes);
app.use('/api/organisation/holidays', holidaysRoutes);
app.use('/api/locations', locationsRoutes);
app.use('/api/platform', platformRoutes);
app.use('/api/roster', rosterRoutes);
app.use('/api/portal', portalRoutes);
app.use('/api/submissions', submissionsRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/xero', xeroRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/announcements', announcementsRoutes);

// Serve the built frontend from this same service (single-service deployment).
// In local development Vite serves the frontend on :3000, so this is skipped.
const frontendDist = path.join(__dirname, '../../frontend/dist');
const frontendIndex = path.join(frontendDist, 'index.html');

if (fs.existsSync(frontendIndex)) {
    app.use(express.static(frontendDist, {
        index: false,
        setHeaders: (res, filePath) => {
            // Hashed asset filenames are safe to cache hard; index.html must not be.
            if (filePath.includes(`${path.sep}assets${path.sep}`)) {
                res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
            }
        },
    }));

    // Anything that is not an API call falls through to the SPA so client-side
    // routes like /roster and /login/:slug work on a hard refresh.
    app.use((req, res, next) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') return next();
        if (req.path.startsWith('/api/') || req.path === '/health') return next();
        res.sendFile(frontendIndex);
    });
} else {
    console.warn('[STARTUP] No frontend build found at frontend/dist - serving API only.');
}

// Unmatched API routes should be JSON, not HTML
app.use('/api', (_req, res) => {
    res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Endpoint not found' } });
});

// Error handling
app.use((err: any, req: any, res: any, next: any) => {
    console.error('[ERROR]', err);
    res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 4000;

// Initialize DB and start server
async function start() {
    const dbUrl = process.env.DATABASE_URL;
    if (dbUrl) {
        await initDB(dbUrl);
        app.listen(Number(PORT), '0.0.0.0', () => {
            console.log(`Server listening on port ${PORT}`);
            if (publicUrl) console.log(`Public URL: ${publicUrl}`);
        });
    } else {
        console.error('DATABASE_URL is required');
        process.exit(1);
    }
}

if (require.main === module) {
    start();
}

export default app;
