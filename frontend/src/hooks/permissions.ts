/**
 * The pure part of the access model: permission keys, where a permission applies, and the checks
 * built on them. No React and no network, so it runs under Node's test runner
 * (tests/access.test.ts). Used only to decide what to SHOW; the server authorises every request.
 */
export type Permission =
  | 'employees.view' | 'employees.create' | 'employees.edit' | 'employees.archive' | 'employees.manage_access'
  | 'rosters.view' | 'rosters.create' | 'rosters.edit'
  | 'timesheets.view' | 'timesheets.create' | 'timesheets.edit' | 'timesheets.approve' | 'timesheets.reopen' | 'timesheets.lock'
  | 'leave.view' | 'leave.approve' | 'leave.manage'
  | 'payroll.view' | 'payroll.export'
  | 'organisation.view' | 'organisation.edit' | 'branches.manage' | 'users.manage' | 'roles.manage' | 'announcements.moderate'
  | 'audit.view' | 'security.manage'
  | 'portal.access' | 'timesheets.submit' | 'leave.create';

/** Where one permission applies: the entire organisation, or these branches. */
export interface PermissionScope {
  all: boolean;
  branch_ids: string[];
}

export interface RoleRef {
  id: string | null;
  name: string;
  system_key: 'OWNER' | 'ADMIN' | 'EMPLOYEE' | null;
}

/**
 * Permissions that are held per branch (docs/ROLES-AND-PERMISSIONS.md §2). Everything else is
 * organisation-wide (only effective from an entire-organisation assignment) or for the employee's
 * own portal, and is asked without a branch.
 */
export const BRANCH_LEVEL_PERMISSIONS: ReadonlySet<Permission> = new Set<Permission>([
  'employees.view', 'employees.create', 'employees.edit', 'employees.archive', 'employees.manage_access',
  'rosters.view', 'rosters.create', 'rosters.edit',
  'timesheets.view', 'timesheets.create', 'timesheets.edit', 'timesheets.approve', 'timesheets.reopen', 'timesheets.lock',
  'leave.view', 'leave.approve', 'leave.manage',
  'payroll.view', 'payroll.export',
]);

export const isBranchLevel = (permission: Permission): boolean => BRANCH_LEVEL_PERMISSIONS.has(permission);

/** "Owner", or "Admin, Payroll Manager": the roles this account holds here. */
export const roleSummary = (access: { roles: Pick<RoleRef, 'name'>[] } | null): string => access?.roles.map(r => r.name).join(', ') ?? '';

/** Pure check behind `can`: does the account hold `permission` at all, or — with a branch — in that branch. */
export function holdsPermission(
  access: { scopes: Partial<Record<Permission, PermissionScope>> } | null,
  permission: Permission,
  branchId?: string | null,
): boolean {
  const scope = access?.scopes[permission];
  if (!scope) return false;
  if (branchId === undefined || branchId === null) return scope.all || scope.branch_ids.length > 0;
  return scope.all || scope.branch_ids.includes(branchId);
}

/**
 * The check a page makes when it acts on the active branch: branch-level permissions are asked for
 * that branch, everything else across the organisation. With no active branch, a branch-level
 * permission is asked in general ("anywhere").
 */
export function holdsHere(
  access: { scopes: Partial<Record<Permission, PermissionScope>> } | null,
  permission: Permission,
  activeBranchId: string | null,
): boolean {
  return holdsPermission(access, permission, isBranchLevel(permission) ? activeBranchId : undefined);
}

/** Held in some branch other than `branchId` but not in it: the person can fix this by switching branch. */
export function heldInAnotherBranch(
  access: { scopes: Partial<Record<Permission, PermissionScope>> } | null,
  permission: Permission,
  branchId: string | null,
): boolean {
  return isBranchLevel(permission) && branchId !== null
    && holdsPermission(access, permission) && !holdsPermission(access, permission, branchId);
}

/** True when the account holds at least one of the permissions (anywhere, or in the branch when given). */
export const holdsAny = (
  access: { scopes: Partial<Record<Permission, PermissionScope>> } | null,
  permissions: readonly Permission[],
  branchId?: string | null,
): boolean => permissions.some(p => holdsPermission(access, p, branchId));
