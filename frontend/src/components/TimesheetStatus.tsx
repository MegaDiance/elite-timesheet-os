import { CheckCircle2, Lock, PencilLine } from 'lucide-react';
import { Badge } from './ui/Badge';
import { HelpTip } from './ui/HelpTip';

export type TimesheetState = 'Draft' | 'Approved' | 'Locked';

/**
 * The one definition of what a timesheet status means, used on every page that shows one.
 * Each status has its own icon and words, so it never depends on colour alone.
 */
export const TIMESHEET_STATE: Record<TimesheetState, { label: string; variant: 'outline' | 'success' | 'info'; meaning: string; employeeMeaning: string }> = {
  Draft: {
    label: 'Draft',
    variant: 'outline',
    meaning: 'Hours can still be added or changed. A manager approves the timesheet once the pay period’s hours are right.',
    employeeMeaning: 'Your hours can still be changed. Your manager approves them at the end of the pay period.',
  },
  Approved: {
    label: 'Approved',
    variant: 'success',
    meaning: 'A manager has checked and approved these hours. They can’t be changed unless a manager reopens the timesheet.',
    employeeMeaning: 'Your manager has approved these hours. If something is wrong, ask your manager to reopen it.',
  },
  Locked: {
    label: 'Locked',
    variant: 'info',
    meaning: 'Approved and closed for payroll. Nobody can change, reopen or re-approve it while the branch’s timesheets are locked.',
    employeeMeaning: 'These hours are approved and closed for payroll. They can no longer be changed.',
  },
};

const ICON: Record<TimesheetState, typeof Lock> = { Draft: PencilLine, Approved: CheckCircle2, Locked: Lock };

export function TimesheetStatusBadge({ status, size = 'sm' }: { status: TimesheetState; size?: 'sm' | 'md' }) {
  const state = TIMESHEET_STATE[status] ?? TIMESHEET_STATE.Draft;
  const Icon = ICON[status] ?? PencilLine;
  return (
    <Badge variant={state.variant} size={size} title={state.meaning}>
      <Icon className="w-3 h-3" aria-hidden="true" />
      {state.label}
    </Badge>
  );
}

/** "Draft → Approved → Locked" with a one-line meaning for each — for help and empty states. */
export function TimesheetStatusGuide({ audience = 'reviewer' }: { audience?: 'reviewer' | 'employee' }) {
  return (
    <dl className="space-y-2">
      {(Object.keys(TIMESHEET_STATE) as TimesheetState[]).map(s => (
        <div key={s} className="flex items-start gap-2">
          <dt className="shrink-0 w-24"><TimesheetStatusBadge status={s} /></dt>
          <dd className="text-xs text-[var(--muted)] leading-relaxed">
            {audience === 'employee' ? TIMESHEET_STATE[s].employeeMeaning : TIMESHEET_STATE[s].meaning}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** A "?" that explains all three statuses; placed beside a Status heading. */
export function TimesheetStatusHelp({ audience = 'reviewer', align }: { audience?: 'reviewer' | 'employee'; align?: 'left' | 'right' }) {
  return (
    <HelpTip label="Status" align={align}>
      <span className="block font-semibold mb-2">Timesheet status</span>
      {(Object.keys(TIMESHEET_STATE) as TimesheetState[]).map(s => (
        <span key={s} className="flex items-start gap-2 mb-2 last:mb-0">
          <span className="shrink-0 w-20"><TimesheetStatusBadge status={s} /></span>
          <span className="text-[var(--muted)]">{audience === 'employee' ? TIMESHEET_STATE[s].employeeMeaning : TIMESHEET_STATE[s].meaning}</span>
        </span>
      ))}
    </HelpTip>
  );
}
