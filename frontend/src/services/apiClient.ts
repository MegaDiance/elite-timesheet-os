import axios from 'axios';

const api = axios.create({
    baseURL: import.meta.env.VITE_API_URL || 'http://localhost:4000/api',
});

api.interceptors.request.use((config) => {
    const token = localStorage.getItem('token');
    if (token) {
        config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
});

api.interceptors.response.use((response) => response, (error) => {
    if (error.response?.status === 401) {
        const publicPrefixes = ['/login', '/features', '/pricing', '/find-organisation', '/reset-password', '/setup-org', '/accept-invite'];
        const isPublicRoute = window.location.pathname === '/' || publicPrefixes.some(p => window.location.pathname.startsWith(p));
        
        if (!isPublicRoute) {
            localStorage.removeItem('token');
            window.location.href = '/find-organisation';
        }
    }
    return Promise.reject(error);
});

export default api;
