/**
 * SimpleHours has exactly two roles: OWNER and BRANCH_ADMIN.
 * This test fails if application code (backend or frontend) refers to any removed role.
 * Historical migrations are excluded: they must keep describing the data they migrated.
 */
import fs from 'fs';
import path from 'path';

const ROOT = path.join(__dirname, '../../..');
const SCANNED = ['backend/src', 'frontend/src'];

const FORBIDDEN: Array<[string, RegExp]> = [
    ['removed role keys', /\b(ORG_ADMIN|ORG_MANAGER|ORG_OWNER|BRANCH_MANAGER|PLATFORM_ADMIN|PAYROLL|FINANCE|EMPLOYEE|STAFF)\b/],
    ['legacy role names', /\b(Platform Admin|Company Admin|Org(anisation)? Admin|Org(anisation)? Manager|Branch Manager)\b/i],
    ['legacy role string literals', /(['"`])(Manager|Employee|Admin|Owner|Payroll|Finance|Staff|manager|employee|admin)\1/],
    ['comparisons with any role other than OWNER / BRANCH_ADMIN', /role\s*[!=]==?\s*(['"`])(?!(OWNER|BRANCH_ADMIN)\1)/],
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
