/**
 * The permission catalogue and the built-in role definitions.
 *
 *   User → assignments (role + scope) → permissions → branches
 *
 * A permission is a capability of the product. A role is a named set of permissions. An assignment
 * gives one role to one person, together with the scope it applies in: the entire organisation, or
 * a chosen set of branches. Effective access is the union of a person's assignments, each within
 * its own scope (services/policy.ts).
 *
 * This file is the single definition of the permission keys. The `permissions` table is seeded from
 * the same list by migration …800 and a test keeps the two identical, so a role can only ever hold
 * a key the code understands.
 *
 * Levels decide where a permission can act:
 *   branch        — acts on one branch's data; held per branch (a role's scope picks the branches)
 *   organisation  — acts on the organisation itself; only ever effective from an assignment whose
 *                   scope is the entire organisation, never from a branch-scoped one
 *   self          — the employee's own portal; only the built-in Employee role holds these
 */
export type PermissionLevel = 'branch' | 'organisation' | 'self';

export interface PermissionDef {
    key: string;
    category: string;
    label: string;
    description: string;
    level: PermissionLevel;
}

export const PERMISSION_CATEGORIES = ['Staff', 'Schedules', 'Timesheets', 'Leave', 'Reports', 'Organisation', 'Security', 'Employee portal'] as const;

const def = (key: string, category: string, level: PermissionLevel, label: string, description: string): PermissionDef =>
    ({ key, category, level, label, description });

export const PERMISSION_CATALOGUE: readonly PermissionDef[] = [
    def('employees.view', 'Staff', 'branch', 'View staff', 'See employees, their details and default rosters.'),
    def('employees.create', 'Staff', 'branch', 'Add staff', 'Add new employees to a branch, one by one or by importing a spreadsheet.'),
    def('employees.edit', 'Staff', 'branch', 'Edit staff', 'Change employee details and move them between branches.'),
    def('employees.archive', 'Staff', 'branch', 'Deactivate and delete staff', 'Deactivate, reactivate or delete employees.'),
    def('employees.manage_access', 'Staff', 'branch', 'Manage employee sign-in', 'Invite employees to the employee portal, reset their password link or remove their sign-in.'),

    def('rosters.view', 'Schedules', 'branch', 'View schedules', 'See who is rostered on each day.'),
    def('rosters.create', 'Schedules', 'branch', 'Create schedules', 'Add shifts to empty days, copy days and apply default rosters.'),
    def('rosters.edit', 'Schedules', 'branch', 'Edit schedules', 'Change or clear rostered shifts, breaks and default rosters.'),

    def('timesheets.view', 'Timesheets', 'branch', 'View timesheets', 'See worked hours and timesheet status.'),
    def('timesheets.create', 'Timesheets', 'branch', 'Create timesheets', 'Record worked hours for days that have none, including Auto-log.'),
    def('timesheets.edit', 'Timesheets', 'branch', 'Edit timesheets', 'Change or clear recorded worked hours.'),
    def('timesheets.approve', 'Timesheets', 'branch', 'Approve timesheets', 'Approve a worker’s timesheet for a pay period.'),
    def('timesheets.reopen', 'Timesheets', 'branch', 'Reopen timesheets', 'Reopen an approved timesheet so it can be corrected.'),
    def('timesheets.lock', 'Timesheets', 'branch', 'Lock pay periods', 'Lock and unlock the roster or timesheets of a branch for a pay period.'),

    def('leave.view', 'Leave', 'branch', 'View leave requests', 'See leave requests from employees.'),
    def('leave.approve', 'Leave', 'branch', 'Approve leave', 'Approve or decline leave requests.'),
    def('leave.manage', 'Leave', 'branch', 'Manage leave and timesheet rules', 'Choose whether employees can submit timesheets, whether leave needs approval and whether approved leave merges into the roster.'),

    def('payroll.view', 'Reports', 'branch', 'View reports', 'See the payroll hours report.'),
    def('payroll.export', 'Reports', 'branch', 'Export reports', 'Download the payroll report as CSV or PDF.'),

    def('organisation.view', 'Organisation', 'organisation', 'View organisation settings', 'See organisation-wide settings such as break rules.'),
    def('organisation.edit', 'Organisation', 'organisation', 'Edit organisation settings', 'Change the organisation name, break rules and public holidays.'),
    def('branches.manage', 'Organisation', 'organisation', 'Manage branches', 'Add, rename, deactivate and reactivate branches.'),
    def('users.manage', 'Organisation', 'organisation', 'Manage users', 'Invite people, assign roles and change who can access which branch.'),
    def('roles.manage', 'Organisation', 'organisation', 'Manage roles and permissions', 'Create, edit and delete roles and choose which permissions they hold.'),
    def('announcements.moderate', 'Organisation', 'organisation', 'Moderate announcements', 'Remove other people’s posts and replies from the team noticeboard.'),

    def('audit.view', 'Security', 'organisation', 'View audit logs', 'Read the organisation’s audit trail.'),
    def('security.manage', 'Security', 'organisation', 'Manage security settings', 'Sign-in link, lock passwords and other organisation security settings.'),

    def('portal.access', 'Employee portal', 'self', 'Use the employee portal', 'See your own roster, timesheet, history and leave.'),
    def('timesheets.submit', 'Employee portal', 'self', 'Submit own timesheet', 'Enter your own worked hours (when the organisation allows it).'),
    def('leave.create', 'Employee portal', 'self', 'Request leave', 'Request your own leave.'),
];

/** Named constants for every key, so routes never spell a key as a bare string. */
export const Permission = {
    EMPLOYEES_VIEW: 'employees.view',
    EMPLOYEES_CREATE: 'employees.create',
    EMPLOYEES_EDIT: 'employees.edit',
    EMPLOYEES_ARCHIVE: 'employees.archive',
    EMPLOYEES_MANAGE_ACCESS: 'employees.manage_access',
    ROSTERS_VIEW: 'rosters.view',
    ROSTERS_CREATE: 'rosters.create',
    ROSTERS_EDIT: 'rosters.edit',
    TIMESHEETS_VIEW: 'timesheets.view',
    TIMESHEETS_CREATE: 'timesheets.create',
    TIMESHEETS_EDIT: 'timesheets.edit',
    TIMESHEETS_APPROVE: 'timesheets.approve',
    TIMESHEETS_REOPEN: 'timesheets.reopen',
    TIMESHEETS_LOCK: 'timesheets.lock',
    LEAVE_VIEW: 'leave.view',
    LEAVE_APPROVE: 'leave.approve',
    LEAVE_MANAGE: 'leave.manage',
    PAYROLL_VIEW: 'payroll.view',
    PAYROLL_EXPORT: 'payroll.export',
    ORGANISATION_VIEW: 'organisation.view',
    ORGANISATION_EDIT: 'organisation.edit',
    BRANCHES_MANAGE: 'branches.manage',
    USERS_MANAGE: 'users.manage',
    ROLES_MANAGE: 'roles.manage',
    ANNOUNCEMENTS_MODERATE: 'announcements.moderate',
    AUDIT_VIEW: 'audit.view',
    SECURITY_MANAGE: 'security.manage',
    PORTAL_ACCESS: 'portal.access',
    TIMESHEETS_SUBMIT: 'timesheets.submit',
    LEAVE_CREATE: 'leave.create',
} as const;

export type Permission = (typeof Permission)[keyof typeof Permission];

const BY_KEY: ReadonlyMap<string, PermissionDef> = new Map(PERMISSION_CATALOGUE.map(p => [p.key, p]));

export const isPermissionKey = (value: unknown): value is Permission => typeof value === 'string' && BY_KEY.has(value);
export const permissionDef = (key: string): PermissionDef | undefined => BY_KEY.get(key);
export const permissionLevel = (key: string): PermissionLevel | undefined => BY_KEY.get(key)?.level;
export const isBranchLevel = (key: string) => permissionLevel(key) === 'branch';
export const isOrganisationLevel = (key: string) => permissionLevel(key) === 'organisation';

/** Permissions that can be put in a role by an administrator. The self-service ones belong to the Employee role alone. */
export const ASSIGNABLE_PERMISSIONS: readonly Permission[] = PERMISSION_CATALOGUE.filter(p => p.level !== 'self').map(p => p.key as Permission);
export const SELF_PERMISSIONS: readonly Permission[] = PERMISSION_CATALOGUE.filter(p => p.level === 'self').map(p => p.key as Permission);

export type SystemRoleKey = 'OWNER' | 'ADMIN' | 'EMPLOYEE';

export interface SystemRoleDef {
    key: SystemRoleKey;
    name: string;
    description: string;
}

export const SYSTEM_ROLES: readonly SystemRoleDef[] = [
    { key: 'OWNER', name: 'Owner', description: 'Full access to the whole organisation. Can’t be removed or changed.' },
    { key: 'ADMIN', name: 'Manager', description: 'Runs the day-to-day: staff, schedules, timesheets, leave and payroll.' },
    { key: 'EMPLOYEE', name: 'Employee', description: 'Uses the employee portal for their own roster, timesheet and leave.' },
];

/**
 * What a new organisation's Manager role (system key ADMIN) holds. It is exactly what a Branch Admin could always do,
 * plus reading organisation settings; the Owner can add or remove permissions from it afterwards.
 * Migration …800 and the organisations trigger use the same list (a test compares them).
 */
export const ADMIN_DEFAULT_PERMISSIONS: readonly Permission[] = [
    'employees.view', 'employees.create', 'employees.edit', 'employees.archive', 'employees.manage_access',
    'rosters.view', 'rosters.create', 'rosters.edit',
    'timesheets.view', 'timesheets.create', 'timesheets.edit', 'timesheets.approve', 'timesheets.reopen', 'timesheets.lock',
    'leave.view', 'leave.approve', 'leave.manage',
    'payroll.view', 'payroll.export',
    'organisation.view',
];

/**
 * Ordinary roles every new organisation starts with, so most businesses never build one from
 * scratch. Unlike the built-in roles they can be renamed, edited, duplicated or deleted.
 * Migration …801 creates them with the same lists (a test compares them).
 */
export const ROLE_PRESETS: ReadonlyArray<{ name: string; description: string; permissions: readonly Permission[] }> = [
    {
        name: 'Branch Manager',
        description: 'Runs the branches they’re given: staff, schedules, timesheets and leave.',
        permissions: [
            'employees.view', 'employees.create', 'employees.edit', 'employees.manage_access',
            'rosters.view', 'rosters.create', 'rosters.edit',
            'timesheets.view', 'timesheets.create', 'timesheets.edit', 'timesheets.approve', 'timesheets.reopen',
            'leave.view', 'leave.approve',
            'payroll.view',
        ],
    },
    {
        name: 'Payroll',
        description: 'Records and checks hours, and exports the payroll report.',
        permissions: ['employees.view', 'timesheets.view', 'timesheets.create', 'timesheets.edit', 'payroll.view', 'payroll.export'],
    },
];

/**
 * Permissions that hand out organisation-wide control. Giving them to someone (through a role or a
 * change to a role people already hold) needs the caller's password again.
 */
export const HIGH_PRIVILEGE_PERMISSIONS: readonly Permission[] = ['users.manage', 'roles.manage', 'security.manage', 'organisation.edit', 'branches.manage'];

/** The Employee role is fixed: it is what the portal needs and nothing more. */
export const EMPLOYEE_PERMISSIONS: readonly Permission[] = ['portal.access', 'timesheets.submit', 'leave.create'];

/** The Owner holds every permission that is not employee self-service. It is defined here, not stored, so it can never be edited. */
export const OWNER_PERMISSIONS: readonly Permission[] = ASSIGNABLE_PERMISSIONS;
