import { useState } from 'react';
import { Link } from 'react-router-dom';
import { holdsPermission, isBranchLevel, type Permission } from '../hooks/permissions';
import { landingPath } from '../utils/landing';
import { useAccess } from '../hooks/useAccess';
import { useActiveBranch } from '../hooks/useActiveBranch';
import { BranchSwitchModal } from './modals/BranchSwitchModal';

/** What each permission lets a person do, as the end of "…needs permission to ___". Never shown as a raw key. */
const PERMISSION_PHRASE: Record<Permission, string> = {
  'employees.view': 'see workers',
  'employees.create': 'add workers',
  'employees.edit': 'edit workers',
  'employees.archive': 'deactivate workers',
  'employees.manage_access': 'manage workers’ sign-in',
  'rosters.view': 'see rosters',
  'rosters.create': 'create rosters',
  'rosters.edit': 'change rosters',
  'timesheets.view': 'see timesheets',
  'timesheets.create': 'enter worked hours',
  'timesheets.edit': 'change worked hours',
  'timesheets.approve': 'approve timesheets',
  'timesheets.reopen': 'reopen timesheets',
  'timesheets.lock': 'lock pay periods',
  'leave.view': 'see leave requests',
  'leave.approve': 'approve leave',
  'leave.manage': 'manage leave and timesheet settings',
  'payroll.view': 'see payroll reports',
  'payroll.export': 'export payroll reports',
  'organisation.view': 'see organisation settings',
  'organisation.edit': 'change organisation settings',
  'branches.manage': 'manage branches',
  'users.manage': 'manage the team',
  'roles.manage': 'manage roles',
  'announcements.moderate': 'moderate team chat',
  'audit.view': 'see the audit log',
  'security.manage': 'manage security settings',
  'portal.access': 'use the employee portal',
  'timesheets.submit': 'submit your own timesheet',
  'leave.create': 'request leave',
};

export const permissionPhrase = (permission: Permission): string => PERMISSION_PHRASE[permission];

interface NoAccessProps {
  /** Any one of these would have been enough. Omitted for pages that are for managers in general. */
  needs?: readonly Permission[];
  /** The page is only for people who work in the employee portal. */
  employeePortal?: boolean;
}

/**
 * The page a person landed on isn't theirs. Says what is missing in plain language and what they
 * can do about it. When they hold the permission in another branch but not in the one they are
 * working in, they are told to switch branch (and offered the switcher) instead of being told
 * to ask for access they already have.
 */
export default function NoAccess({ needs, employeePortal }: NoAccessProps) {
  const { access } = useAccess();
  const { activeBranch, activeBranchId, branches, setActiveBranch } = useActiveBranch();
  const [switching, setSwitching] = useState(false);

  const branchNeeds = (needs ?? []).filter(isBranchLevel);
  const holdsElsewhere = branchNeeds.length > 0 && activeBranchId !== null
    && branchNeeds.some(p => holdsPermission(access, p) && !holdsPermission(access, p, activeBranchId));
  const branchesWhereAllowed = branches.filter(b => branchNeeds.some(p => holdsPermission(access, p, b.id)));

  const start = landingPath(access);
  const goHome = start ? { to: start, label: start === '/my/schedule' ? 'Go to my schedule' : 'Go to my start page' } : null;

  const what = needs && needs.length > 0 ? `This page needs permission to ${needs.map(permissionPhrase).join(' or ')}.` : null;

  let message: string;
  if (holdsElsewhere) message = `You don’t have access to this in ${activeBranch?.name ?? 'this branch'}. Switch to a branch where you do.`;
  else if (employeePortal) message = 'This page is for employees. Your account isn’t linked to an employee record here.';
  else if (!needs) message = 'This area is for the people who manage the organisation. If you need it, ask your organisation owner to change your access.';
  else message = 'Your roles don’t include this. Ask your organisation owner to change your access.';

  return (
    <div className="max-w-md mx-auto mt-16 p-8 bg-[var(--panel)] border border-[var(--border)] rounded-2xl text-center space-y-3">
      <h1 className="text-lg font-bold text-[var(--text)]">You don’t have access to this page</h1>
      {what && !employeePortal && <p className="text-sm text-[var(--muted)]">{what}</p>}
      <p className="text-sm text-[var(--text)]" role="status">{message}</p>
      {holdsElsewhere && (
        <>
          <button
            type="button"
            onClick={() => setSwitching(true)}
            className="inline-flex items-center justify-center h-10 px-4 rounded-lg text-sm font-semibold bg-[var(--primary)] text-white hover:bg-[var(--primary-h)]"
          >
            Switch branch
          </button>
          <BranchSwitchModal
            isOpen={switching}
            onClose={() => setSwitching(false)}
            branches={branchesWhereAllowed}
            currentBranchId={activeBranchId}
            onSwitch={setActiveBranch}
          />
        </>
      )}
      {goHome && (
        <div>
          <Link to={goHome.to} className="inline-block text-sm font-semibold text-[var(--primary-text)] hover:underline">{goHome.label}</Link>
        </div>
      )}
    </div>
  );
}
