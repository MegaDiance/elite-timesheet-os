import { CheckCircle2, Clock, XCircle } from 'lucide-react';
import { Badge } from './ui/Badge';

export type LeaveState = 'Pending' | 'Approved' | 'Rejected';

const LEAVE_STATE: Record<LeaveState, { label: string; variant: 'warning' | 'success' | 'danger'; Icon: typeof Clock }> = {
  Pending: { label: 'Waiting for a decision', variant: 'warning', Icon: Clock },
  Approved: { label: 'Approved', variant: 'success', Icon: CheckCircle2 },
  Rejected: { label: 'Declined', variant: 'danger', Icon: XCircle },
};

/** A leave request's status in words, with an icon, so it never depends on colour alone. */
export function LeaveStatusBadge({ status }: { status: LeaveState }) {
  const { label, variant, Icon } = LEAVE_STATE[status] ?? LEAVE_STATE.Pending;
  return (
    <Badge variant={variant}>
      <Icon className="w-3 h-3" aria-hidden="true" />
      {label}
    </Badge>
  );
}

/** What each leave type is for — shown next to the leave type chooser. */
export const LEAVE_TYPE_HELP = 'Annual leave: paid holidays. Sick leave: when you (or someone you care for) are unwell. Time in lieu: time off instead of pay for extra hours already worked. Leave without pay: approved time off that isn’t paid. Other: anything else your manager has agreed to.';
