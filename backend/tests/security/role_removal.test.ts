/**
 * SimpleHours has exactly three roles: OWNER, BRANCH_ADMIN and EMPLOYEE. EMPLOYEE is a
 * deliberately powerless role — ROLE_PERMISSIONS.EMPLOYEE is an empty set (see the second
 * describe block below), so every existing permission check rejects an employee exactly as
 * it would reject an unauthenticated caller. New employee-only capability is granted only by
 * routes that check `role === 'EMPLOYEE'` directly, never by adding new Permission values.
 *
 * This test fails if application code (backend or frontend) refers to any *other* removed
 * role. Historical migrations are excluded: they must keep describing the data they migrated.
 */
import fs from 'fs';
import path from 'path';
import { ROLE_PERMISSIONS } from '../../src/services/policy';

const ROOT = path.join(__dirname, '../../..');
const SCANNED = ['backend/src', 'frontend/src'];

const FORBIDDEN: Array<[string, RegExp]> = [
    ['removed role keys', /\b(ORG_ADMIN|ORG_MANAGER|ORG_OWNER|BRANCH_MANAGER|PLATFORM_ADMIN|PAYROLL|FINANCE|STAFF)\b/],
    ['legacy role names', /\b(Platform Admin|Company Admin|Org(anisation)? Admin|Org(anisation)? Manager|Branch Manager)\b/i],
    ['legacy role string literals', /(['"`])(Manager|Admin|Owner|Payroll|Finance|Staff|manager|admin)\1/],
    ['comparisons with any role other than OWNER / BRANCH_ADMIN / EMPLOYEE', /role\s*[!=]==?\s*(['"`])(?!(OWNER|BRANCH_ADMIN|EMPLOYEE)\1)/],
    ['legacy role storage', /\b(organisation_members|location_memberships|location_invitations|invitation_tokens|org_invitation_tokens)\b|users\.role\b|\bu\.role\b/],
    ['legacy guards', /\b(requireRole|requireOrgOwner|requireAnyPermission|requireAnyBranchPermission|requireLocationContext|requireTenantContext|securityContext|isPlatformAdmin)\b/],
];

function walk(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return walk(full);
        return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
    });
}

describe('Removed roles stay removed', () => {
    const files = SCANNED.flatMap(dir => walk(path.join(ROOT, dir)));

    it('scans the application source', () => {
        expect(files.length).toBeGreaterThan(40);
    });

    for (const [label, pattern] of FORBIDDEN) {
        it(`no ${label}`, () => {
            const hits: string[] = [];
            for (const file of files) {
                fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
                    if (pattern.test(line)) hits.push(`${path.relative(ROOT, file)}:${i + 1}: ${line.trim().slice(0, 120)}`);
                });
            }
            expect(hits).toEqual([]);
        });
    }
});

describe('EMPLOYEE exists but is provably powerless', () => {
    it('holds none of the Permission values, so every requirePermission/hasPermission check rejects it exactly like an unauthenticated caller', () => {
        expect(ROLE_PERMISSIONS.EMPLOYEE.size).toBe(0);
    });
});
