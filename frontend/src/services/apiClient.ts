import axios from 'axios';

const api = axios.create({
    // In production the API is served from the same origin as the app, so a
    // relative base works with no build-time configuration. Vite's dev server
    // runs on :3000 while the API runs on :4000, hence the explicit dev value.
    baseURL: import.meta.env.VITE_API_URL || (import.meta.env.DEV ? 'http://localhost:4000/api' : '/api'),
});

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
    if (error.response?.status === 401) {
        const publicPrefixes = ['/login', '/features', '/pricing', '/portal-access', '/find-organisation', '/reset-password', '/setup-org', '/accept-invite', '/platform-gate', '/platform-login', '/verify-login'];
        const isPublicRoute = window.location.pathname === '/' || publicPrefixes.some(p => window.location.pathname.startsWith(p));
        
        if (!isPublicRoute) {
            const code = error.response?.data?.error?.code || error.response?.data?.code || '';
            let reasonParam = '';
            if (code === 'SESSION_EXPIRED') {
                reasonParam = '?reason=inactivity';
            } else if (code === 'USER_DEACTIVATED') {
                reasonParam = '?reason=deactivated';
            } else if (code === 'SESSION_REVOKED') {
                reasonParam = '?reason=revoked';
            }

            localStorage.removeItem('token');
            localStorage.removeItem('user');
            localStorage.removeItem('session_last_active');
            window.dispatchEvent(new Event('auth-change'));

            const lastSlug = localStorage.getItem('last_org_slug');
            if (lastSlug) {
                window.location.href = `/login/${lastSlug}${reasonParam}`;
            } else {
                window.location.href = `/login${reasonParam}`;
            }
        }
    }
    return Promise.reject(error);
});

export default api;
