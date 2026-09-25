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

const MANAGER_FAQS = (isOwner: boolean): Faq[] => [
  {
    q: 'How do I add a shift?',
    a: 'Open Roster, find the worker, and click the day. Enter a start and finish, for example 9 and 5p, then Save roster. To record what they actually worked, fill in the Worked part of the same day, or use “Worked the rostered times”.',
  },
  {
    q: 'How do I enter a split day or part-day leave?',
    a: 'Use “Add time” in the day to add another line, and choose its type. For example 9–1 Work, 1–3 Sick leave, 3–5 Work. Lines can’t overlap. If your organisation merges leave with the roster (Settings → Workforce), adding leave inside a shift splits the shift around it automatically, and the day tells you it did.',
  },
  {
    q: 'How do breaks work?',
    a: `Each work line has a break. “Standard” uses your organisation’s rule (${isOwner ? 'set in Settings' : 'set by the Organisation Owner'}): for example 30 minutes once the day reaches 6 hours. The break only comes off work, never leave. To set the same break on many days, use “Apply break to all days” and untick the exceptions.`,
  },
  {
    q: 'What do Draft, Approved and Locked mean?',
    a: '',
  },
  {
    q: 'Why can’t I change this day?',
    a: 'Either the timesheet is approved (a manager can Reopen it), or the branch’s roster or timesheets are locked for that pay period. A roster lock still lets you record worked hours. A timesheet lock stops all changes until someone unlocks it with a password.',
  },
  {
    q: 'Why can’t I see a branch or a worker?',
    a: isOwner
      ? 'You can see every branch. A deactivated branch or worker is hidden from lists; reactivate it on Branches or Workers.'
      : 'You only see the branches you’ve been assigned to. Ask the Organisation Owner if you need another branch.',
  },
  {
    q: 'How do workers sign in?',
    a: 'Workers can have their own account to see their schedule and ask for leave. Give them access from Workers → Portal access, then share your organisation’s sign-in link with them. There is no general sign-in page. Everyone signs in through that link.',
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
  const { access, isOwner } = useAccess();
  const [expanded, setExpanded] = useState<number | null>(0);
  const isEmployee = access?.role === 'EMPLOYEE';
  const faqs = isEmployee ? EMPLOYEE_FAQS(Boolean(access?.employee_capabilities?.can_submit_timesheets)) : MANAGER_FAQS(isOwner);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Help" description={isEmployee ? 'Your schedule, hours and leave' : 'Short answers to common questions'} maxWidth="lg">
      <div className="space-y-4">
        <div className="p-3.5 rounded-lg bg-[var(--primary-light)] flex items-center justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <Compass className="w-4 h-4 mt-0.5 text-[var(--primary-text)] shrink-0" aria-hidden="true" />
            <div>
              <p className="text-sm font-semibold text-[var(--text)]">Show me around</p>
              <p className="text-xs text-[var(--muted)]">A short walkthrough of {isEmployee ? 'your schedule and leave' : 'the roster, shifts, breaks, leave and timesheets'}, on your real screens.</p>
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
