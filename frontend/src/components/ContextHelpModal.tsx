import { useState, type FC } from 'react';
import { ChevronDown, Compass } from 'lucide-react';
import { Modal } from './ui/Modal';
import { Button } from './ui/Button';
import { useAccess } from '../hooks/useAccess';
import { TimesheetStatusGuide } from './TimesheetStatus';
import { startTour } from './tour/tourSignals';

interface ContextHelpModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface Faq { q: string; a: string }

const MANAGER_FAQS = (isOwner: boolean, canEditOrganisation: boolean): Faq[] => [
  {
    q: 'How do I add a shift?',
    a: 'On Schedule, click the employee’s day. Enter a start and finish (for example 9 and 5p), then Save roster. To record actual hours, fill in Worked for that day or use “Same as rostered”.',
  },
  {
    q: 'How do I enter a split day or part-day leave?',
    a: 'Use “Add time” in the day to add another line and choose its type, for example 9–1 Work, 1–3 Sick leave, 3–5 Work. Lines can’t overlap. If leave merging is on (Settings → Timesheets & leave), leave added inside a shift splits it automatically.',
  },
  {
    q: 'How do breaks work?',
    a: `Each work line has a break. “Standard” follows the organisation’s break rule${canEditOrganisation ? ' (Settings → Organisation)' : ''}, for example 30 minutes once the day reaches 6 hours. Breaks only come off work, never leave. To set the same break on many days, use “Apply break to all days” and untick the exceptions.`,
  },
  {
    q: 'What do Draft, Approved and Locked mean?',
    a: '',
  },
  {
    q: 'Why can’t I change this day?',
    a: 'The timesheet is approved (a manager can Reopen it), or the roster or timesheets are locked for that pay period. A roster lock still allows worked hours. A timesheet lock stops all changes until it is unlocked.',
  },
  {
    q: 'Why can’t I see a branch or an employee?',
    a: isOwner
      ? 'Deactivated branches and employees are hidden from lists. Reactivate them under Settings → Branches or on Staff.'
      : 'You only see the branches your roles cover. Ask the owner if you need another.',
  },
  {
    q: 'How do employees sign in?',
    a: 'Give them Portal access on Staff, then share your private link with them. There is no general sign-in page: everyone signs in through that link.',
  },
];

const EMPLOYEE_FAQS = (canSubmit: boolean): Faq[] => [
  {
    q: 'Where do I see my shifts?',
    a: 'On My schedule. Today is at the top, then the rest of the fortnight. Use the arrows to look ahead.',
  },
  ...(canSubmit ? [{
    q: 'How do I record my hours?',
    a: 'Open My timesheet, choose the day and enter when you started and finished. Your manager approves the fortnight at the end of the pay period.',
  }, {
    q: 'What do Draft, Approved and Locked mean?',
    a: '',
  }] : []),
  {
    q: 'How do I ask for leave?',
    a: 'Open Leave, choose the type and dates, and send the request. It shows as Pending until your manager decides, then Approved or Rejected.',
  },
  {
    q: 'Something on my schedule is wrong',
    a: 'Only your manager can change the roster. Let them know what needs fixing.',
  },
];

/** Help for the signed-in role: the tour, and short answers written for that role. */
export const ContextHelpModal: FC<ContextHelpModalProps> = ({ isOpen, onClose }) => {
  const { access, isOwner, isEmployeeOnly, can } = useAccess();
  const [expanded, setExpanded] = useState<number | null>(0);
  const isEmployee = isEmployeeOnly;
  const faqs = isEmployee ? EMPLOYEE_FAQS(Boolean(access?.employee_capabilities?.can_submit_timesheets)) : MANAGER_FAQS(isOwner, can('organisation.edit'));

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Help" maxWidth="lg">
      <div className="space-y-4">
        <div className="p-3.5 rounded-lg bg-[var(--primary-light)] flex items-center justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <Compass className="w-4 h-4 mt-0.5 text-[var(--primary-text)] shrink-0" aria-hidden="true" />
            <div>
              <p className="text-sm font-semibold text-[var(--text)]">Take the tour</p>
              <p className="text-xs text-[var(--muted)]">{isEmployee ? 'Your schedule and leave.' : 'Schedule, shifts, breaks, leave and timesheets.'}</p>
            </div>
          </div>
          <Button variant="primary" size="md" className="shrink-0" onClick={() => { onClose(); startTour(); }}>
            Start
          </Button>
        </div>

        <ul className="space-y-2">
          {faqs.map((faq, i) => {
            const open = expanded === i;
            const panelId = `help-answer-${i}`;
            return (
              <li key={faq.q} className="rounded-lg border border-[var(--border)] overflow-hidden">
                <button
                  type="button"
                  onClick={() => setExpanded(open ? null : i)}
                  aria-expanded={open}
                  aria-controls={panelId}
                  className="w-full min-h-11 px-4 py-2.5 text-left flex items-center justify-between gap-3 text-sm font-semibold text-[var(--text)] hover:bg-[var(--panel-subtle)]"
                >
                  <span>{faq.q}</span>
                  <ChevronDown className={`w-4 h-4 text-[var(--muted)] shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
                </button>
                {open && (
                  <div id={panelId} className="px-4 pb-3.5 pt-1 text-sm text-[var(--muted)] leading-relaxed">
                    {faq.a || <TimesheetStatusGuide audience={isEmployee ? 'employee' : 'reviewer'} />}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </Modal>
  );
};

export default ContextHelpModal;
