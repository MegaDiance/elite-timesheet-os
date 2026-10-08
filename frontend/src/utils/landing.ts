import { holdsHere, type Access, type Permission } from '../hooks/useAccess';

/**
 * Where someone starts after signing in. There is no dashboard: everyone lands on the page they
 * work in. People who manage land on the first daily-work page they can use (Timesheets first),
 * someone who is only an employee lands on their schedule, and a manager with none of those (say,
 * only roles or security) lands on Settings.
 */
const MANAGER_LANDING: Array<{ path: string; permission: Permission }> = [
  { path: '/timesheets', permission: 'timesheets.view' },
  { path: '/schedule', permission: 'rosters.view' },
  { path: '/leave', permission: 'leave.view' },
  { path: '/staff', permission: 'employees.view' },
  { path: '/reports', permission: 'payroll.view' },
];

export function landingPath(access: Access | null): string | null {
  if (!access) return null;
  if (access.is_manager) {
    const first = MANAGER_LANDING.find(l => holdsHere(access, l.permission, null));
    if (first) return first.path;
  }
  if (access.is_employee) return '/my/schedule';
  return access.is_manager ? '/settings' : null;
}
