import axios from 'axios';
import { portalLoginPath } from './portal';

const api = axios.create({
    // In production the API is served from the same origin as the app, so a
    // relative base works with no build-time configuration. Vite's dev server
    // runs on :3000 while the API runs on :4000, hence the explicit dev value.
    baseURL: import.meta.env.VITE_API_URL || (import.meta.env.DEV ? 'http://localhost:4000/api' : '/api'),
});

const FEATURE_OFF_CODES = new Set(['EMPLOYEE_TIMESHEETS_DISABLED']);

api.interceptors.request.use((config) => {
    const token = localStorage.getItem('token');
    if (token) {
        config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
});

api.interceptors.response.use((response) => {
    if (localStorage.getItem('token')) {
        localStorage.setItem('session_last_active', Date.now().toString());
    }
    return response;
}, (error) => {
    // A feature this page relies on was switched off since access was last read (e.g. employee
    // timesheets): re-read access so navigation and route guards drop it straight away.
    if (error.response?.status === 403 && FEATURE_OFF_CODES.has(error.response?.data?.error?.code)) {
        window.dispatchEvent(new Event('access-stale'));
    }
    if (error.response?.status === 401) {
        const publicPrefixes = ['/login/', '/features', '/pricing', '/signup', '/setup-organisation', '/forgot-password', '/reset-password', '/accept-invite', '/accept-employee-invite', '/verify-login'];
        const isPublicRoute = window.location.pathname === '/' || publicPrefixes.some(p => window.location.pathname.startsWith(p));
        
        if (!isPublicRoute) {
            const code = error.response?.data?.error?.code || error.response?.data?.code || '';
            const reason = code === 'SESSION_EXPIRED' ? 'inactivity'
                : code === 'USER_DEACTIVATED' ? 'deactivated'
                : code === 'SESSION_REVOKED' ? 'revoked'
                : code === 'ACCESS_REVOKED' ? 'access-ended'
                : undefined;

            localStorage.removeItem('token');
            localStorage.removeItem('session_last_active');
            window.dispatchEvent(new Event('auth-change'));
            window.location.href = portalLoginPath(reason);
        }
    }
    return Promise.reject(error);
});

export default api;
