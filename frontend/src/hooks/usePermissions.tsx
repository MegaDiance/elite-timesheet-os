/**
 * Permission surface for the SimpleHours frontend.
 *
 * The backend exposes the authenticated user's authorisation state on
 * `GET /api/auth/me` under `data.security_context`:
 *
 *   { org_role, active_branch_id, active_branch_role, permissions[], branch_memberships[] }
 *
 * CRITICAL MODEL RULE reflected here: organisation roles
 * (OWNER / ORG_ADMIN / ORG_MANAGER) carry **zero** branch timesheet, roster or
 * leave access. Those capabilities only ever come from an *active* branch
 * membership (BRANCH_ADMIN or BRANCH_MANAGER) in a specific branch.
 *
 * Older tokens may not produce a `security_context`. In that case `isLegacy` is
 * true and every permission check falls back to the historical coarse role
 * behaviour so existing deployments keep working unchanged.
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { jwtDecode } from 'jwt-decode';
import api from '../services/apiClient';

/* -------------------------------------------------------------------------- */
/* Canonical vocabulary                                                        */
/* -------------------------------------------------------------------------- */

export const PERMISSIONS = [
  'ORGANISATION_VIEW',
  'ORGANISATION_UPDATE',
  'ORGANISATION_MANAGE_USERS',
  'ORGANISATION_MANAGE_BRANCHES',
  'BRANCH_VIEW',
  'BRANCH_UPDATE',
  'BRANCH_MANAGE_USERS',
  'BRANCH_MANAGE_STAFF',
  'ROSTER_VIEW',
  'ROSTER_CREATE',
  'ROSTER_UPDATE',
  'ROSTER_DELETE',
  'TIMESHEET_VIEW',
  'TIMESHEET_REVIEW',
  'TIMESHEET_APPROVE',
  'TIMESHEET_LOCK',
  'LEAVE_VIEW',
  'LEAVE_REVIEW',
  'LEAVE_APPROVE',
  'REPORT_VIEW',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export type OrgRole = 'OWNER' | 'ORG_ADMIN' | 'ORG_MANAGER';
export type BranchRole = 'BRANCH_ADMIN' | 'BRANCH_MANAGER' | 'EMPLOYEE';

export interface BranchMembership {
  branchId: string;
  branchName: string;
  role: BranchRole;
  isActive: boolean;
}

export interface SecurityContext {
  org_role: OrgRole | null;
  active_branch_id: string | null;
  active_branch_role: BranchRole | null;
  permissions: Permission[];
  branch_memberships: BranchMembership[];
}

const STORAGE_KEY = 'simplehours_security_context';

/* -------------------------------------------------------------------------- */
/* Branch-role → permission derivation                                         */
/* -------------------------------------------------------------------------- */

const BRANCH_MANAGER_PERMISSIONS: Permission[] = [
  'BRANCH_VIEW',
  'BRANCH_MANAGE_STAFF',
  'ROSTER_VIEW',
  'ROSTER_CREATE',
  'ROSTER_UPDATE',
  'TIMESHEET_VIEW',
  'TIMESHEET_REVIEW',
  'TIMESHEET_APPROVE',
  'LEAVE_VIEW',
  'LEAVE_REVIEW',
  'LEAVE_APPROVE',
  'REPORT_VIEW',
];

const BRANCH_ROLE_PERMISSIONS: Record<BranchRole, Permission[]> = {
  BRANCH_ADMIN: [
    ...BRANCH_MANAGER_PERMISSIONS,
    'BRANCH_UPDATE',
    'BRANCH_MANAGE_USERS',
    'ROSTER_DELETE',
    'TIMESHEET_LOCK',
  ],
  BRANCH_MANAGER: BRANCH_MANAGER_PERMISSIONS,
  EMPLOYEE: [],
};

/* -------------------------------------------------------------------------- */
/* Legacy fallback (no security_context on the /me payload)                     */
/* -------------------------------------------------------------------------- */

const LEGACY_ADMIN_ROLES = ['Admin', 'Company Admin', 'Platform Admin', 'Owner'];
const LEGACY_MANAGER_ROLES = ['Manager'];

/** Mirrors the pre-revamp nav visibility so old tokens behave exactly as before. */
function legacyPermissions(role: string | null): Permission[] {
  if (!role) return [];
  if (LEGACY_ADMIN_ROLES.includes(role)) {
    return [...PERMISSIONS];
  }
  if (LEGACY_MANAGER_ROLES.includes(role)) {
    return [
      'BRANCH_VIEW',
      'BRANCH_MANAGE_STAFF',
      'ORGANISATION_VIEW',
      ...BRANCH_ROLE_PERMISSIONS.BRANCH_MANAGER,
    ];
  }
  return [];
}

interface LegacyToken {
  role?: string;
}

function decodeLegacyRole(): string | null {
  const token = localStorage.getItem('token');
  if (!token) return null;
  try {
    return jwtDecode<LegacyToken>(token).role ?? null;
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/* Normalisation                                                               */
/* -------------------------------------------------------------------------- */

function normaliseSecurityContext(raw: unknown): SecurityContext | null {
  if (!raw || typeof raw !== 'object') return null;
  const src = raw as Record<string, unknown>;

  const permissions = Array.isArray(src.permissions)
    ? (src.permissions.filter((p): p is Permission =>
        typeof p === 'string' && (PERMISSIONS as readonly string[]).includes(p)
      ))
    : [];

  const memberships = Array.isArray(src.branch_memberships)
    ? src.branch_memberships.reduce<BranchMembership[]>((acc, entry) => {
        if (!entry || typeof entry !== 'object') return acc;
        const m = entry as Record<string, unknown>;
        if (typeof m.branchId !== 'string') return acc;
        acc.push({
          branchId: m.branchId,
          branchName: typeof m.branchName === 'string' ? m.branchName : 'Branch',
          role: (m.role as BranchRole) ?? 'EMPLOYEE',
          isActive: m.isActive !== false,
        });
        return acc;
      }, [])
    : [];

  return {
    org_role: (src.org_role as OrgRole) ?? null,
    active_branch_id: typeof src.active_branch_id === 'string' ? src.active_branch_id : null,
    active_branch_role: (src.active_branch_role as BranchRole) ?? null,
    permissions,
    branch_memberships: memberships,
  };
}

function readCachedContext(): SecurityContext | null {
  try {
    const cached = localStorage.getItem(STORAGE_KEY);
    if (!cached) return null;
    return normaliseSecurityContext(JSON.parse(cached));
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/* Context value                                                               */
/* -------------------------------------------------------------------------- */

export interface PermissionsValue {
  /** True while the first /auth/me round trip is still in flight. */
  loading: boolean;
  /** True when the backend returned no `security_context` (older token). */
  isLegacy: boolean;
  /** Coarse legacy role from the JWT — still used for display and platform admin. */
  legacyRole: string | null;
  orgRole: OrgRole | null;
  activeBranchId: string | null;
  activeBranchRole: BranchRole | null;
  permissions: Permission[];
  branchMemberships: BranchMembership[];
  /** Branch memberships the user can actually act in (active only). */
  activeBranchMemberships: BranchMembership[];
  /** Does the user hold this permission in the *current* (active) context? */
  hasPermission: (permission: Permission) => boolean;
  /** Any one of these in the current context? */
  hasAnyPermission: (...permissions: Permission[]) => boolean;
  /** All of these in the current context? */
  hasAllPermissions: (...permissions: Permission[]) => boolean;
  /**
   * Held in the active context, or implied by any *active* branch membership.
   * Use this for nav visibility, so a manager of another branch can still reach
   * the page and switch branches.
   */
  hasPermissionInAnyBranch: (permission: Permission) => boolean;
  /** Does the user hold this permission inside one specific branch? */
  hasPermissionInBranch: (branchId: string, permission: Permission) => boolean;
  /** Re-fetch /auth/me. */
  refresh: () => Promise<void>;
}

const PermissionsContext = createContext<PermissionsValue | undefined>(undefined);

export const PermissionsProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [security, setSecurity] = useState<SecurityContext | null>(() => readCachedContext());
  const [legacyRole, setLegacyRole] = useState<string | null>(() => decodeLegacyRole());
  const [isLegacy, setIsLegacy] = useState<boolean>(() => readCachedContext() === null);
  const [loading, setLoading] = useState<boolean>(() => !!localStorage.getItem('token'));

  const load = useCallback(async () => {
    const token = localStorage.getItem('token');
    setLegacyRole(decodeLegacyRole());

    if (!token) {
      setSecurity(null);
      setIsLegacy(true);
      setLoading(false);
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch {
        /* storage unavailable — nothing to clean up */
      }
      return;
    }

    setLoading(true);
    try {
      const res = await api.get('/auth/me');
      const data = res.data?.data ?? {};
      const ctx = normaliseSecurityContext(data.security_context);
      if (ctx) {
        setSecurity(ctx);
        setIsLegacy(false);
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(ctx));
        } catch {
          /* storage unavailable — in-memory context still works */
        }
      } else {
        // Older token: derive nothing, fall back to legacy role behaviour.
        setSecurity(null);
        setIsLegacy(true);
        try {
          localStorage.removeItem(STORAGE_KEY);
        } catch {
          /* ignore */
        }
      }
    } catch {
      // Network/permission failure: keep whatever cached context we have and
      // degrade to legacy behaviour if we have none.
      if (!readCachedContext()) setIsLegacy(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const onAuthChange = () => {
      void load();
    };
    window.addEventListener('auth-change', onAuthChange);
    return () => window.removeEventListener('auth-change', onAuthChange);
  }, [load]);

  const value = useMemo<PermissionsValue>(() => {
    const effective: Permission[] = security
      ? security.permissions
      : legacyPermissions(legacyRole);

    const activeMemberships = (security?.branch_memberships ?? []).filter((m) => m.isActive);

    const anyBranch = new Set<Permission>(effective);
    if (security) {
      for (const m of activeMemberships) {
        for (const p of BRANCH_ROLE_PERMISSIONS[m.role] ?? []) anyBranch.add(p);
      }
    }

    const hasPermission = (permission: Permission) => effective.includes(permission);

    return {
      loading,
      isLegacy,
      legacyRole,
      orgRole: security?.org_role ?? null,
      activeBranchId: security?.active_branch_id ?? null,
      activeBranchRole: security?.active_branch_role ?? null,
      permissions: effective,
      branchMemberships: security?.branch_memberships ?? [],
      activeBranchMemberships: activeMemberships,
      hasPermission,
      hasAnyPermission: (...permissions: Permission[]) => permissions.some(hasPermission),
      hasAllPermissions: (...permissions: Permission[]) => permissions.every(hasPermission),
      hasPermissionInAnyBranch: (permission: Permission) => anyBranch.has(permission),
      hasPermissionInBranch: (branchId: string, permission: Permission) => {
        if (!security) return hasPermission(permission);
        if (security.active_branch_id === branchId && hasPermission(permission)) return true;
        const membership = activeMemberships.find((m) => m.branchId === branchId);
        if (!membership) return false;
        return (BRANCH_ROLE_PERMISSIONS[membership.role] ?? []).includes(permission);
      },
      refresh: load,
    };
  }, [security, legacyRole, isLegacy, loading, load]);

  return <PermissionsContext.Provider value={value}>{children}</PermissionsContext.Provider>;
};

/**
 * Read the current user's permission surface. Safe to call outside the
 * provider: it then degrades to the legacy JWT role so nothing crashes.
 */
export function usePermissions(): PermissionsValue {
  const ctx = useContext(PermissionsContext);
  if (ctx) return ctx;

  const role = decodeLegacyRole();
  const effective = legacyPermissions(role);
  const hasPermission = (permission: Permission) => effective.includes(permission);
  return {
    loading: false,
    isLegacy: true,
    legacyRole: role,
    orgRole: null,
    activeBranchId: null,
    activeBranchRole: null,
    permissions: effective,
    branchMemberships: [],
    activeBranchMemberships: [],
    hasPermission,
    hasAnyPermission: (...permissions: Permission[]) => permissions.some(hasPermission),
    hasAllPermissions: (...permissions: Permission[]) => permissions.every(hasPermission),
    hasPermissionInAnyBranch: hasPermission,
    hasPermissionInBranch: (_branchId: string, permission: Permission) => hasPermission(permission),
    refresh: async () => {},
  };
}
