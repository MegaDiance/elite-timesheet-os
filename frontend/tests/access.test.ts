/**
 * The pure access checks behind what the app shows (which pages, buttons and branches a person
 * sees). Display only — the server authorises every request. Runs with Node's own test runner.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  BRANCH_LEVEL_PERMISSIONS,
  heldInAnotherBranch,
  holdsAny,
  holdsHere,
  holdsPermission,
  isBranchLevel,
  roleSummary,
  type Permission,
  type PermissionScope,
} from '../src/hooks/permissions.ts';

const MELB = 'branch-melbourne';
const SYD = 'branch-sydney';
const PER = 'branch-perth';

const access = (scopes: Partial<Record<Permission, PermissionScope>>) => ({ scopes });
const everywhere: PermissionScope = { all: true, branch_ids: [] };
const only = (...ids: string[]): PermissionScope => ({ all: false, branch_ids: ids });

describe('holdsPermission', () => {
  it('denies everything without access', () => {
    assert.equal(holdsPermission(null, 'rosters.view'), false);
    assert.equal(holdsPermission(access({}), 'rosters.view'), false);
    assert.equal(holdsPermission(access({}), 'rosters.view', MELB), false);
  });

  it('an entire-organisation grant applies in every branch and in general', () => {
    const a = access({ 'timesheets.approve': everywhere });
    assert.equal(holdsPermission(a, 'timesheets.approve'), true);
    assert.equal(holdsPermission(a, 'timesheets.approve', MELB), true);
    assert.equal(holdsPermission(a, 'timesheets.approve', PER), true);
  });

  it('a branch-scoped grant applies only in those branches', () => {
    const a = access({ 'timesheets.approve': only(MELB, SYD) });
    assert.equal(holdsPermission(a, 'timesheets.approve'), true, 'held somewhere');
    assert.equal(holdsPermission(a, 'timesheets.approve', MELB), true);
    assert.equal(holdsPermission(a, 'timesheets.approve', SYD), true);
    assert.equal(holdsPermission(a, 'timesheets.approve', PER), false);
  });

  it('a grant with no branches and not organisation-wide holds nothing', () => {
    const a = access({ 'payroll.view': only() });
    assert.equal(holdsPermission(a, 'payroll.view'), false);
    assert.equal(holdsPermission(a, 'payroll.view', MELB), false);
  });

  it('does not treat a different permission as held', () => {
    const a = access({ 'payroll.view': everywhere });
    assert.equal(holdsPermission(a, 'payroll.export'), false);
  });

  it('a missing branch id (null / undefined) asks "anywhere"', () => {
    const a = access({ 'rosters.view': only(MELB) });
    assert.equal(holdsPermission(a, 'rosters.view', null), true);
    assert.equal(holdsPermission(a, 'rosters.view', undefined), true);
  });
});

describe('BRANCH_LEVEL_PERMISSIONS', () => {
  it('covers employees, rosters, timesheets, leave and payroll', () => {
    const expected: Permission[] = [
      'employees.view', 'employees.create', 'employees.edit', 'employees.archive', 'employees.manage_access',
      'rosters.view', 'rosters.create', 'rosters.edit',
      'timesheets.view', 'timesheets.create', 'timesheets.edit', 'timesheets.approve', 'timesheets.reopen', 'timesheets.lock',
      'leave.view', 'leave.approve', 'leave.manage',
      'payroll.view', 'payroll.export',
    ];
    assert.deepEqual([...BRANCH_LEVEL_PERMISSIONS].sort(), [...expected].sort());
  });

  it('leaves organisation-wide, security and self permissions out', () => {
    const others: Permission[] = [
      'organisation.view', 'organisation.edit', 'branches.manage', 'users.manage', 'roles.manage',
      'announcements.moderate', 'audit.view', 'security.manage', 'portal.access', 'timesheets.submit', 'leave.create',
    ];
    for (const p of others) assert.equal(isBranchLevel(p), false, p);
  });
});

describe('holdsHere (the active branch)', () => {
  const a = access({
    'timesheets.approve': only(MELB),
    'payroll.view': only(MELB),
    'users.manage': everywhere,
  });

  it('asks branch-level permissions for the active branch', () => {
    assert.equal(holdsHere(a, 'timesheets.approve', MELB), true);
    assert.equal(holdsHere(a, 'timesheets.approve', SYD), false);
  });

  it('asks organisation-level permissions across the organisation, whatever the branch', () => {
    assert.equal(holdsHere(a, 'users.manage', SYD), true);
    assert.equal(holdsHere(a, 'roles.manage', MELB), false);
  });

  it('with no active branch a branch-level permission is asked "anywhere"', () => {
    assert.equal(holdsHere(a, 'timesheets.approve', null), true);
    assert.equal(holdsHere(a, 'rosters.view', null), false);
  });
});

describe('heldInAnotherBranch', () => {
  const a = access({ 'timesheets.view': only(MELB), 'audit.view': everywhere });

  it('is true when held elsewhere but not in the active branch', () => {
    assert.equal(heldInAnotherBranch(a, 'timesheets.view', SYD), true);
  });
  it('is false when held in the active branch, or not held at all', () => {
    assert.equal(heldInAnotherBranch(a, 'timesheets.view', MELB), false);
    assert.equal(heldInAnotherBranch(a, 'rosters.view', SYD), false);
  });
  it('is false for organisation-level permissions and with no active branch', () => {
    assert.equal(heldInAnotherBranch(a, 'roles.manage', SYD), false);
    assert.equal(heldInAnotherBranch(a, 'audit.view', SYD), false);
    assert.equal(heldInAnotherBranch(a, 'timesheets.view', null), false);
  });
});

describe('holdsAny', () => {
  const a = access({ 'roles.manage': everywhere, 'leave.view': only(PER) });
  it('is true when any one is held', () => {
    assert.equal(holdsAny(a, ['users.manage', 'roles.manage']), true);
  });
  it('is false when none is held', () => {
    assert.equal(holdsAny(a, ['users.manage', 'audit.view']), false);
    assert.equal(holdsAny(null, ['users.manage']), false);
  });
  it('respects a branch', () => {
    assert.equal(holdsAny(a, ['leave.view'], PER), true);
    assert.equal(holdsAny(a, ['leave.view'], MELB), false);
  });
});

describe('roleSummary', () => {
  it('lists the roles a person holds', () => {
    const roles = [
      { id: null, name: 'Owner', system_key: 'OWNER' as const },
      { id: 'r1', name: 'Payroll Manager', system_key: null },
    ];
    assert.equal(roleSummary({ roles }), 'Owner, Payroll Manager');
  });
  it('is empty without access or roles', () => {
    assert.equal(roleSummary(null), '');
    assert.equal(roleSummary({ roles: [] }), '');
  });
});
