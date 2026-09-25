import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import api from '../services/apiClient';
import { portalLoginPath, rememberPortal } from '../services/portal';

/**
 * What the signed-in account may do, as reported by GET /api/auth/me.
 *
 * SimpleHours has three roles: the Organisation Owner, Branch Admins (each assigned to specific
 * branches), and Employees (each linked to one worker record, holding no `permissions`). This is
 * used only to decide what to SHOW; the server authorises every request itself.
 */
export type Role = 'OWNER' | 'BRANCH_ADMIN' | 'EMPLOYEE';

export type Permission =
  | 'organisation.manage' | 'security.manage' | 'branches.manage' | 'branch_admins.manage'
  | 'holidays.manage' | 'integrations.manage' | 'audit.view' | 'announcements.moderate'
  | 'branch.view' | 'workers.manage' | 'rosters.manage' | 'timesheets.manage' | 'periods.lock' | 'reports.view';

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
  role: Role;
  permissions: Permission[];
  branches: Branch[];
  /** Present only when role is EMPLOYEE. */
  employee_capabilities?: { can_submit_timesheets: boolean };
}

interface AccessValue {
  access: Access | null;
  loading: boolean;
  isOwner: boolean;
  can: (permission: Permission) => boolean;
  refresh: () => Promise<void>;
}

export const ROLE_LABEL: Record<Role, string> = {
  OWNER: 'Organisation Owner',
  BRANCH_ADMIN: 'Branch Admin',
  EMPLOYEE: 'Employee',
};

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

  const can = useCallback((permission: Permission) => Boolean(access?.permissions.includes(permission)), [access]);

  return (
    <AccessContext.Provider value={{ access, loading, isOwner: access?.role === 'OWNER', can, refresh }}>
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
  window.location.replace(portalLoginPath(reason));
}
