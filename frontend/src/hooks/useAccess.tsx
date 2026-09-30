import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import api from '../services/apiClient';
import { portalLoginPath, rememberPortal } from '../services/portal';
import { forgetOrganisationState } from '../services/sessionCache';
import { holdsPermission, type Permission, type PermissionScope, type RoleRef } from './permissions';

export { BRANCH_LEVEL_PERMISSIONS, holdsAny, holdsHere, heldInAnotherBranch, holdsPermission, isBranchLevel, roleSummary } from './permissions';
export type { Permission, PermissionScope, RoleRef } from './permissions';

/**
 * What the signed-in account may do, as reported by GET /api/auth/me.
 *
 * Access is a set of permissions, each held either across the entire organisation or in chosen
 * branches (`scopes`). A person can hold several roles; what they can do is the union. This is used
 * only to decide what to SHOW; the server authorises every request itself, from the database.
 */
export interface Branch {
  id: string;
  name: string;
  address: string | null;
  timezone: string | null;
  is_active: boolean;
}

export interface Access {
  user: { id: string; email: string; full_name: string | null; two_factor_enabled: boolean; tutorial_version?: number | null };
  organisation: { id: string; name: string };
  roles: RoleRef[];
  is_owner: boolean;
  /** A worker record is linked to this login: the employee portal is available. */
  is_employee: boolean;
  /** Holds at least one management permission (anything beyond the employee's own portal). */
  is_manager: boolean;
  permissions: Permission[];
  scopes: Partial<Record<Permission, PermissionScope>>;
  branches: Branch[];
  /** Whether "Switch organisation" is worth offering. The list itself is only shown after the password is re-entered. */
  has_other_organisations: boolean;
  /** Present only for an employee login. */
  employee_capabilities?: { can_submit_timesheets: boolean };
}

interface AccessValue {
  access: Access | null;
  loading: boolean;
  isOwner: boolean;
  /** The employee portal only (no management permission at all). */
  isEmployeeOnly: boolean;
  /** Holds `permission` at all, or — with a branch — in that branch. */
  can: (permission: Permission, branchId?: string | null) => boolean;
  refresh: () => Promise<void>;
}

const AccessContext = createContext<AccessValue | null>(null);

export function AccessProvider({ children }: { children: ReactNode }) {
  const [access, setAccess] = useState<Access | null>(null);
  const [loading, setLoading] = useState<boolean>(Boolean(localStorage.getItem('token')));
  const current = useRef<Access | null>(null);

  const refresh = useCallback(async () => {
    if (!localStorage.getItem('token')) {
      current.current = null;
      setAccess(null);
      setLoading(false);
      return;
    }
    // Only a first load (or a fresh sign-in) shows the loading state; a refresh keeps the page mounted.
    if (!current.current) setLoading(true);
    try {
      const res = await api.get('/auth/me');
      current.current = res.data.data;
      setAccess(res.data.data);
    } catch {
      current.current = null;
      setAccess(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    window.addEventListener('auth-change', refresh);
    return () => window.removeEventListener('auth-change', refresh);
  }, [refresh]);

  // A company setting (e.g. "employees can submit timesheets") must take effect in an already-open
  // tab without a manual reload or re-login. Access is re-read from the server — never guessed —
  // whenever it can have changed from the user's point of view: when the tab regains focus or
  // becomes visible, on every in-app navigation (AccessSync in App.tsx), and as soon as the API
  // refuses a request because a feature was switched off (see apiClient's 'access-stale' event).
  // There is deliberately no timer: nothing is polled while the user is not doing anything.
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') refresh(); };
    window.addEventListener('focus', refresh);
    window.addEventListener('access-stale', refresh);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('focus', refresh);
      window.removeEventListener('access-stale', refresh);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refresh]);

  const can = useCallback((permission: Permission, branchId?: string | null) => holdsPermission(access, permission, branchId), [access]);

  return (
    <AccessContext.Provider value={{ access, loading, isOwner: access?.is_owner === true, isEmployeeOnly: access?.is_employee === true && access?.is_manager !== true, can, refresh }}>
      {children}
    </AccessContext.Provider>
  );
}

export function useAccess(): AccessValue {
  const value = useContext(AccessContext);
  if (!value) throw new Error('useAccess must be used inside <AccessProvider>');
  return value;
}

/**
 * Stores the session token from a successful sign-in (or organisation switch) response and loads
 * the account's access. `portalPath` is that organisation's sign-in page, remembered so sign-out
 * and timeouts return there. The server only includes it in sign-in responses.
 */
export function storeSession(token: string, portalPath?: string | null) {
  rememberPortal(portalPath);
  localStorage.setItem('token', token);
  localStorage.setItem('session_last_active', Date.now().toString());
  window.dispatchEvent(new Event('auth-change'));
}

/**
 * Ends the session on the server first, forgets it locally, then loads the organisation's own
 * sign-in page (or the home page if none is known) with a full page load, so nothing from the
 * signed-in session survives in memory. Never goes to a generic sign-in page — there isn't one.
 */
export async function signOut(reason: 'logout' | 'inactivity' = 'logout'): Promise<void> {
  try {
    if (localStorage.getItem('token')) await api.post('/auth/logout');
  } catch {
    // The session may already have ended; the local copy is cleared regardless.
  }
  localStorage.removeItem('token');
  localStorage.removeItem('session_last_active');
  forgetOrganisationState();
  window.location.replace(portalLoginPath(reason));
}
