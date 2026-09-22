import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import authRoutes from './routes/auth';
import employeesRoutes from './routes/employees';
import recordsRoutes from './routes/records';
import locksRoutes from './routes/locks';
import organisationRoutes from './routes/organisation';
import locationsRoutes from './routes/locations';
import branchAdminsRoutes from './routes/branchAdmins';
import signupRoutes from './routes/signup';
import rosterRoutes from './routes/roster';
import submissionsRoutes from './routes/submissions';
import holidaysRoutes from './routes/holidays';
import reportsRoutes from './routes/reports';
import auditRoutes from './routes/audit';
import announcementsRoutes from './routes/announcements';
import dashboardRoutes from './routes/dashboard';
import { initDB } from './services/db';
import path from 'path';
import fs from 'fs';

dotenv.config();
dotenv.config({ path: path.join(__dirname, '../.env') });
dotenv.config({ path: path.join(__dirname, '../../.env') });

const app = express();

// Only trust X-Forwarded-For from known proxy hops. Railway terminates TLS in one proxy,
// so production defaults to 1 hop. Locally (no proxy) the header is ignored entirely.
const trustProxy = process.env.TRUST_PROXY ?? (process.env.NODE_ENV === 'production' ? '1' : 'false');
app.set('trust proxy', /^\d+$/.test(trustProxy) ? Number(trustProxy) : trustProxy === 'true');

// Secure CORS configuration
const publicUrl = process.env.PUBLIC_URL
    || (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : undefined);

// The frontend is served from this same service, so production only needs its own public URL.
// Outside production any local dev-server port is allowed (compared by parsed host, not by prefix).
const allowedOrigins = new Set([process.env.FRONTEND_URL, publicUrl].filter(Boolean).map(o => (o as string).replace(/\/+$/, '')));

function isLocalDevOrigin(origin: string): boolean {
    if (process.env.NODE_ENV === 'production') return false;
    try {
        const url = new URL(origin);
        return url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname) && !url.username && !url.password;
    } catch {
        return false;
    }
}

app.use(cors({
    // Requests without an Origin (curl, server-to-server, tests) carry no browser credentials to protect.
    // A refused origin simply gets no CORS headers, so the browser blocks the response.
    origin: (origin, callback) => callback(null, !origin || allowedOrigins.has(origin) || isLocalDevOrigin(origin)),
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

// Health check (used by Railway to decide the deploy succeeded)
app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok', uptime: process.uptime() });
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/signup', signupRoutes);
app.use('/api/branch-admins', branchAdminsRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/employees', employeesRoutes);
app.use('/api/records', recordsRoutes);
app.use('/api/locks', locksRoutes);
app.use('/api/organisation', organisationRoutes);
app.use('/api/organisation/holidays', holidaysRoutes);
app.use('/api/locations', locationsRoutes);
app.use('/api/roster', rosterRoutes);
app.use('/api/submissions', submissionsRoutes);
app.use('/api/reports', reportsRoutes);
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
app.use((err: any, _req: any, res: any, _next: any) => {
    console.error('[ERROR]', err);
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Something went wrong. Please try again.' } });
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
