import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import api from '../services/apiClient';

/**
 * What the signed-in account may do, as reported by GET /api/auth/me.
 *
 * SimpleHours has two roles: the Organisation Owner and Branch Admins (each assigned to specific
 * branches). This is used only to decide what to SHOW; the server authorises every request itself.
 */
export type Role = 'OWNER' | 'BRANCH_ADMIN';

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
  user: { id: string; email: string; full_name: string | null; two_factor_enabled: boolean };
  organisation: { id: string; name: string; portal_slug: string };
  role: Role;
  permissions: Permission[];
  branches: Branch[];
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
      localStorage.setItem('last_org_slug', res.data.data.organisation.portal_slug);
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

/** Stores the session token from a successful sign-in response and loads the account's access. */
export function storeSession(token: string) {
  localStorage.setItem('token', token);
  localStorage.setItem('session_last_active', Date.now().toString());
  window.dispatchEvent(new Event('auth-change'));
}

/** Ends the session on the server first, then forgets it locally. */
export async function signOut(): Promise<string> {
  const slug = localStorage.getItem('last_org_slug');
  try {
    if (localStorage.getItem('token')) await api.post('/auth/logout');
  } catch {
    // The session may already have ended; the local copy is cleared regardless.
  }
  localStorage.removeItem('token');
  localStorage.removeItem('session_last_active');
  window.dispatchEvent(new Event('auth-change'));
  return slug ? `/login/${slug}?reason=logout` : '/login?reason=logout';
}
