/**
 * Authorisation is permissions, not role names.
 *
 * These tests fail if application code goes back to deciding access by comparing a role, reads the
 * retired branch_admins table, or brings back a role that was removed. Historical migrations are
 * excluded: they must keep describing the data they migrated.
 */
import fs from 'fs';
import path from 'path';
import {
    ADMIN_DEFAULT_PERMISSIONS, ASSIGNABLE_PERMISSIONS, EMPLOYEE_PERMISSIONS, OWNER_PERMISSIONS, PERMISSION_CATALOGUE,
    Permission, SELF_PERMISSIONS, permissionLevel,
} from '../../src/services/permissions';

const ROOT = path.join(__dirname, '../../..');
const SCANNED = ['backend/src', 'frontend/src'];

const FORBIDDEN: Array<[string, RegExp]> = [
    ['removed role keys', /\b(ORG_ADMIN|ORG_MANAGER|ORG_OWNER|BRANCH_MANAGER|PLATFORM_ADMIN|PAYROLL|FINANCE|STAFF|BRANCH_ADMIN)\b/],
    ['legacy role names', /\b(Platform Admin|Company Admin|Org(anisation)? Admin|Org(anisation)? Manager|Branch Manager)\b/i],
    ['legacy role storage', /\b(organisation_members|location_memberships|location_invitations|invitation_tokens|org_invitation_tokens)\b|users\.role\b|\bu\.role\b/],
    ['reads of the retired branch_admins table', /\bbranch_admins\b/],
    ['legacy guards', /\b(requireRole|requireOrgOwner|requireAnyBranchPermission|requireLocationContext|requireTenantContext|securityContext|isPlatformAdmin)\b/],
    ['the old fixed-role permission table', /\bROLE_PERMISSIONS\b/],
];

function walk(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return walk(full);
        return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
    });
}

const files = SCANNED.flatMap(dir => walk(path.join(ROOT, dir)));
// The homepage tour is marketing copy about the product, not authorisation code.
const codeFiles = files.filter(f => !f.includes(`${path.sep}pages${path.sep}public${path.sep}`));

function scan(list: string[], pattern: RegExp): string[] {
    const hits: string[] = [];
    for (const file of list) {
        fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
            if (pattern.test(line)) hits.push(`${path.relative(ROOT, file)}:${i + 1}: ${line.trim().slice(0, 120)}`);
        });
    }
    return hits;
}

describe('Removed roles stay removed', () => {
    it('scans the application source', () => {
        expect(files.length).toBeGreaterThan(40);
    });

    for (const [label, pattern] of FORBIDDEN) {
        it(`no ${label}`, () => {
            expect(scan(codeFiles, pattern)).toEqual([]);
        });
    }
});

describe('Access is decided by permissions, never by comparing a role', () => {
    const routeFiles = walk(path.join(ROOT, 'backend/src/routes')).concat(walk(path.join(ROOT, 'backend/src/middleware')));
    // Role administration itself is the one place that legitimately knows about the built-in roles.
    const administration = /routes\/(roles|team)\.ts$|services\/(roleAdmin|policy|permissions)\.ts$/;

    it('no route or middleware compares a role, role name or system key', () => {
        const hits = scan(routeFiles.filter(f => !administration.test(f)), /\.(role|roles|systemKey|system_key)\b\s*(!==?|===?)|role\w*\s*(!==?|===?)\s*['"`](OWNER|ADMIN|EMPLOYEE|Owner|Admin|Employee)['"`]/);
        expect(hits).toEqual([]);
    });

    it('the frontend never compares a role either: it asks for permissions (the roles screens themselves excepted)', () => {
        const screens = /components[\\/]roles[\\/]|pages[\\/]RolesPermissions\.tsx$/;
        const hits = scan(codeFiles.filter(f => f.includes('frontend') && !screens.test(f)),
            /(access|value)\??\.role\b\s*(!==?|===?)|(system_key|systemKey|\.name)\s*(!==?|===?)\s*['"`](OWNER|ADMIN|EMPLOYEE|Owner|Admin|Employee)['"`]/);
        expect(hits).toEqual([]);
    });
});

describe('The permission catalogue and the built-in roles', () => {
    it('every permission key in the Permission constants is in the catalogue, once', () => {
        const keys = PERMISSION_CATALOGUE.map(p => p.key);
        expect(new Set(keys).size).toBe(keys.length);
        expect([...keys].sort()).toEqual(Object.values(Permission).sort());
    });

    it('the Employee role holds only employee-portal permissions, which no other role can hold', () => {
        expect([...EMPLOYEE_PERMISSIONS].sort()).toEqual([...SELF_PERMISSIONS].sort());
        for (const key of EMPLOYEE_PERMISSIONS) expect(permissionLevel(key)).toBe('self');
        for (const key of ASSIGNABLE_PERMISSIONS) expect(permissionLevel(key)).not.toBe('self');
    });

    it('the Owner holds every permission that can be handed out, and the Admin default is a subset of it', () => {
        expect([...OWNER_PERMISSIONS].sort()).toEqual([...ASSIGNABLE_PERMISSIONS].sort());
        for (const key of ADMIN_DEFAULT_PERMISSIONS) expect(OWNER_PERMISSIONS).toContain(key);
    });

    it('the default Admin role holds no organisation-level permission except reading settings (it is exactly what a Branch Admin could do)', () => {
        const orgLevel = ADMIN_DEFAULT_PERMISSIONS.filter(k => permissionLevel(k) === 'organisation');
        expect(orgLevel).toEqual(['organisation.view']);
    });
});

describe('The frontend’s copy of the catalogue matches the backend', () => {
    const source = fs.readFileSync(path.join(ROOT, 'frontend/src/hooks/permissions.ts'), 'utf8');
    const keysIn = (region: string) => [...region.matchAll(/'([a-z_]+\.[a-z_]+)'/g)].map(m => m[1]).sort();

    it('knows exactly the same permission keys', () => {
        const union = source.slice(source.indexOf('export type Permission ='), source.indexOf(';', source.indexOf('export type Permission =')));
        expect(keysIn(union)).toEqual(PERMISSION_CATALOGUE.map(p => p.key).sort());
    });

    it('agrees on which permissions are held per branch', () => {
        const start = source.indexOf('BRANCH_LEVEL_PERMISSIONS');
        const region = source.slice(start, source.indexOf(']);', start));
        expect(keysIn(region)).toEqual(PERMISSION_CATALOGUE.filter(p => p.level === 'branch').map(p => p.key).sort());
    });
});
