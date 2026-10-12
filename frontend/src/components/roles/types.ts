/** Shapes returned by GET /roles, GET /roles/:id, GET /roles/permissions and GET /team, plus small helpers. */

export type SystemKey = 'OWNER' | 'ADMIN' | 'EMPLOYEE';

export interface PermissionInfo {
  key: string;
  label: string;
  description: string;
  level: 'branch' | 'organisation' | 'self';
  assignable: boolean;
}

export interface PermissionGroup {
  category: string;
  permissions: PermissionInfo[];
}

export interface RoleSummary {
  id: string;
  name: string;
  description: string | null;
  system_key: SystemKey | null;
  is_system: boolean;
  permissions: string[];
  member_count: number;
  can_edit_permissions: boolean;
  can_edit_details: boolean;
  can_delete: boolean;
  can_duplicate?: boolean;
}

export interface RolesData {
  can_manage: boolean;
  roles: RoleSummary[];
}

export interface ScopeBranch {
  id: string;
  name: string;
  is_active?: boolean;
}

export interface Scope {
  all: boolean;
  branches: ScopeBranch[];
}

export interface RoleMember {
  user_id: string;
  email: string;
  full_name: string | null;
  is_active: boolean;
  assignment_id: string | null;
  scope: Scope;
}

export interface RoleDetail extends RoleSummary {
  members: RoleMember[];
}

export interface Assignment {
  id: string;
  role_id: string;
  role_name: string;
  system_key: SystemKey | null;
  scope: Scope;
}

export interface TeamMember {
  user_id: string;
  email: string;
  full_name: string | null;
  is_owner: boolean;
  is_self: boolean;
  status: 'active' | 'disabled';
  two_factor_enabled: boolean;
  worker: { id: string; branch_id: string; branch_name: string } | null;
  assignments: Assignment[];
}

export interface Invitation {
  id: string;
  email: string;
  full_name: string | null;
  expires_at: string;
  delivery_status: string | null;
  created_at: string;
  role_id: string;
  role_name: string;
  scope_all: boolean;
  branches: Array<{ id: string; name: string }>;
}

export interface TeamData {
  members: TeamMember[];
  invitations: Invitation[];
  branches: Array<{ id: string; name: string }>;
}

/** What the API accepts for "where does this apply". */
export type ScopeBody = { all: true } | { branch_ids: string[] };

export interface ScopeChoice {
  /** null until the person has chosen. */
  mode: 'all' | 'branches' | null;
  branchIds: string[];
}

export const scopeBody = (choice: ScopeChoice): ScopeBody =>
  choice.mode === 'all' ? { all: true } : { branch_ids: choice.branchIds };

/** "Entire organisation", "Melbourne", "Melbourne, Geelong", or "4 branches" when the list is long. */
export function scopeText(scope: Scope | { all: boolean; branches: Array<{ name: string }> }, maxNames = 3): string {
  if (scope.all) return 'Entire organisation';
  const names = scope.branches.map(b => b.name);
  if (names.length === 0) return 'No branches';
  return names.length <= maxNames ? names.join(', ') : `${names.length} branches`;
}

/** The full list, for screen readers and tooltips. */
export const scopeFullText = (scope: Scope): string =>
  scope.all ? 'Entire organisation' : scope.branches.map(b => b.name).join(', ') || 'No branches';

export const personName = (p: { full_name: string | null; email: string }): string => p.full_name || p.email;

/** A role (built-in or custom) that can be given to a person. Owner and Employee come from ownership and worker records. */
export const isAssignable = (role: Pick<RoleSummary, 'system_key'>): boolean =>
  role.system_key !== 'OWNER' && role.system_key !== 'EMPLOYEE';

/** One line about a role. Built-in roles always use the standard wording; custom ones show their own. */
export function roleDescription(role: Pick<RoleSummary, 'system_key' | 'description'>): string {
  if (role.system_key === 'OWNER') return 'Full organisation access';
  if (role.system_key === 'ADMIN') return role.description?.trim() || 'Day-to-day management';
  if (role.system_key === 'EMPLOYEE') return 'Employee portal access';
  return role.description && role.description.trim() ? role.description : 'No description';
}

/** True when every permission in the role only works across the entire organisation. */
export function isOrganisationOnly(permissionKeys: string[], catalogue: PermissionGroup[]): boolean {
  if (permissionKeys.length === 0) return false;
  const level = new Map<string, string>();
  for (const group of catalogue) for (const p of group.permissions) level.set(p.key, p.level);
  return permissionKeys.every(key => level.get(key) === 'organisation');
}

export const formatDate = (iso: string): string =>
  new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });

export const pluralPeople = (n: number): string => `${n} ${n === 1 ? 'person' : 'people'}`;

/** What a role means for choosing where it applies. */
export function roleScopeTraits(role: Pick<RoleSummary, 'permissions'>, catalogue: PermissionGroup[]): { entireOnly: boolean; mixed: boolean } {
  const level = new Map<string, string>();
  for (const group of catalogue) for (const p of group.permissions) level.set(p.key, p.level);
  const entireOnly = isOrganisationOnly(role.permissions, catalogue);
  const hasOrg = role.permissions.some(key => level.get(key) === 'organisation');
  return { entireOnly, mixed: hasOrg && !entireOnly };
}
