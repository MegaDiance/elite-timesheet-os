import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useAccess, type Branch } from './useAccess';
import { forgetOrganisationState } from '../services/sessionCache';
import { holdsHere, type Permission } from './permissions';

/**
 * The one branch the app is currently working inside, shared by every page (Dashboard, Workers,
 * Roster, Timesheets, Reports default to it) and always visible next to the organisation in the
 * sidebar. Remembered per organisation, so switching organisations always lands on a branch that
 * actually belongs to it, and switching branches never needs signing out.
 */
interface ActiveBranchValue {
  activeBranchId: string | null;
  activeBranch: Branch | null;
  /** Every active branch the signed-in account can use in this organisation. */
  branches: Branch[];
  canSwitchBranch: boolean;
  setActiveBranch: (id: string) => void;
}

const ActiveBranchContext = createContext<ActiveBranchValue | null>(null);
const storageKey = (orgId: string) => `active_branch_${orgId}`;

export function ActiveBranchProvider({ children }: { children: ReactNode }) {
  const { access } = useAccess();
  const orgId = access?.organisation.id ?? null;
  const branches = useMemo(() => (access?.branches ?? []).filter(b => b.is_active), [access]);

  const [activeBranchId, setActiveBranchIdState] = useState<string | null>(null);

  // Picks a valid active branch whenever the organisation (or its branch list) changes: the one
  // remembered for this organisation, if it still exists and is active, else the first branch.
  useEffect(() => {
    if (!orgId || branches.length === 0) {
      setActiveBranchIdState(null);
      return;
    }
    const remembered = localStorage.getItem(storageKey(orgId));
    const next = remembered && branches.some(b => b.id === remembered) ? remembered : branches[0].id;
    setActiveBranchIdState(next);
    localStorage.setItem(storageKey(orgId), next);
  }, [orgId, branches]);

  const setActiveBranch = (id: string) => {
    if (!orgId || !branches.some(b => b.id === id) || id === activeBranchId) return;
    localStorage.setItem(storageKey(orgId), id);
    setActiveBranchIdState(id);
  };

  const activeBranch = branches.find(b => b.id === activeBranchId) ?? null;

  return (
    <ActiveBranchContext.Provider value={{ activeBranchId, activeBranch, branches, canSwitchBranch: branches.length > 1, setActiveBranch }}>
      {children}
    </ActiveBranchContext.Provider>
  );
}

export function useActiveBranch(): ActiveBranchValue {
  const value = useContext(ActiveBranchContext);
  if (!value) throw new Error('useActiveBranch must be used inside <ActiveBranchProvider>');
  return value;
}

/** Clears every organisation's remembered branch (used on sign-out and organisation switch, so the next session starts fresh). */
export function forgetActiveBranches() {
  forgetOrganisationState();
}

/**
 * `can(permission)` for a page that acts on the active branch: branch-level permissions (employees,
 * rosters, timesheets, leave, payroll) are asked for the active branch, everything else across the
 * organisation. Display only; the server authorises each request against the record's own branch.
 */
export function useCan(): (permission: Permission) => boolean {
  const { access } = useAccess();
  const { activeBranchId } = useActiveBranch();
  return useCallback((permission: Permission) => holdsHere(access, permission, activeBranchId), [access, activeBranchId]);
}
