/**
 * Every route must declare an authorisation policy, or be on the short, explicit public list.
 *
 * A policy is a middleware carrying a `policy` property (requireAuth, requirePermission(...)),
 * either on the route itself or registered on its router before the route. The test walks every
 * router module in src/routes, so a new route file or route is covered automatically.
 */
import fs from 'fs';
import path from 'path';

const PUBLIC_ROUTES = new Set([
    'auth POST /login',
    'auth POST /verify-login',
    'auth POST /verify-2fa',
    'auth POST /resend-2fa',
    'auth POST /forgot-password',
    'auth GET /verify-reset-token',
    'auth POST /reset-password',
    'signup POST /request',
    'signup GET /verify',
    'signup POST /complete',
    'branchAdmins GET /invitations/verify',
    'branchAdmins POST /invitations/accept',
    'organisation GET /lookup/:slug',
]);

const hasPolicy = (fn: any) => typeof fn === 'function' && typeof fn.policy === 'string';

function collectRoutes(routerName: string, router: any) {
    const found: Array<{ key: string; protectedBy: string[] }> = [];
    const routerPolicies: string[] = [];
    for (const layer of router.stack) {
        if (!layer.route) {
            if (hasPolicy(layer.handle)) routerPolicies.push(layer.handle.policy);
            continue;
        }
        const routePolicies = layer.route.stack.filter((l: any) => hasPolicy(l.handle)).map((l: any) => l.handle.policy);
        const paths = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path];
        for (const method of Object.keys(layer.route.methods)) {
            for (const p of paths) {
                found.push({ key: `${routerName} ${method.toUpperCase()} ${p}`, protectedBy: [...routerPolicies, ...routePolicies] });
            }
        }
    }
    return found;
}

describe('Route inventory', () => {
    const routesDir = path.join(__dirname, '../../src/routes');
    const all = fs.readdirSync(routesDir)
        .filter(f => f.endsWith('.ts'))
        .flatMap(file => {
            const name = file.replace(/\.ts$/, '');
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            return collectRoutes(name, require(path.join(routesDir, file)).default);
        });

    it('finds the application routes', () => {
        expect(all.length).toBeGreaterThan(60);
    });

    it('every non-public route declares a policy', () => {
        const unprotected = all.filter(r => !PUBLIC_ROUTES.has(r.key) && r.protectedBy.length === 0).map(r => r.key);
        expect(unprotected).toEqual([]);
    });

    it('every public route is really public (the list has no stale entries)', () => {
        const keys = new Set(all.map(r => r.key));
        expect([...PUBLIC_ROUTES].filter(k => !keys.has(k))).toEqual([]);
        const publicButGuarded = all.filter(r => PUBLIC_ROUTES.has(r.key) && r.protectedBy.length > 0).map(r => r.key);
        expect(publicButGuarded).toEqual([]);
    });

    it('route files do not read a branch or organisation from request headers', () => {
        for (const file of fs.readdirSync(routesDir)) {
            const source = fs.readFileSync(path.join(routesDir, file), 'utf8');
            expect({ file, hits: source.match(/headers\[['"]x-(location|org|branch)[^'"]*['"]\]|headers\.origin/gi) || [] }).toEqual({ file, hits: [] });
        }
    });
});
