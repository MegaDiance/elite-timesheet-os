import { useState, type FC, type ReactNode } from 'react';
import { HelpCircle, Sparkles, Lock, Clock, ChevronDown, ChevronUp, X, ShieldCheck, Layers, CheckSquare, Building2, BarChart3 } from 'lucide-react';
import { Button } from './ui/Button';
import { useAccess } from '../hooks/useAccess';

interface ContextHelpModalProps {
  isOpen: boolean;
  onClose: () => void;
  onStartTutorial?: () => void;
}

interface Faq {
  q: string;
  icon: ReactNode;
  a: string;
}

export const ContextHelpModal: FC<ContextHelpModalProps> = ({ isOpen, onClose, onStartTutorial }) => {
  const { isOwner } = useAccess();
  const [expandedIndex, setExpandedIndex] = useState<number | null>(0);

  if (!isOpen) return null;

  const faqs: Faq[] = [
    isOwner
      ? {
          q: 'How do I set up branches and Branch Admins?',
          icon: <Building2 className="w-4 h-4 text-[var(--primary)]" />,
          a: 'Create branches on the Branches page. Then open Branch Admins, enter the person’s email and choose the branches they look after. They receive an email invitation; after accepting they sign in with your organisation’s sign-in link and can only work in those branches. You can change their branches or remove their access at any time.',
        }
      : {
          q: 'What can I do as a Branch Admin?',
          icon: <Building2 className="w-4 h-4 text-[var(--primary)]" />,
          a: 'You manage the workers, roster and timesheets of the branches you have been assigned, and see reports for them. The Organisation Owner creates branches and decides who is a Branch Admin, so ask them if you need access to another branch.',
        },
    {
      q: 'How do I roster a split shift or part-day leave?',
      icon: <Layers className="w-4 h-4 text-[var(--primary)]" />,
      a: 'A day is a list of segments. Open the day on the Roster and use “+ Add segment” to add another one, for example Normal Work 08:00–12:00 and Annual Leave 13:00–16:00. Segments on the same day can’t overlap. An end time earlier than the start is treated as an overnight shift.',
    },
    {
      q: 'How do I approve or reopen a timesheet?',
      icon: <CheckSquare className="w-4 h-4 text-[var(--success)]" />,
      a: 'On Timesheets, record the hours actually worked, then select Approve for a worker’s fortnight (or approve several at once). An approved timesheet can’t be edited. To correct it, select Reopen, make the change and approve it again.',
    },
    {
      q: 'Why can’t I change this roster or timesheet?',
      icon: <Lock className="w-4 h-4 text-[var(--warn)]" />,
      a: 'Locks are set per branch for each fortnight. A roster lock stops changes to rostered shifts, but worked hours can still be entered. A timesheet lock stops all timesheet changes. An approved timesheet also can’t be changed until it is reopened. To unlock, enter your own password or the organisation lock password for that lock.',
    },
    {
      q: 'How is the unpaid break worked out?',
      icon: <Clock className="w-4 h-4 text-[var(--primary)]" />,
      a: `The organisation’s break (weekday and weekend lengths and a threshold in hours, ${isOwner ? 'which you set in Settings' : 'set by the Organisation Owner'}) is taken once per day when the day’s segments add up to at least the threshold and the gaps between them are shorter than the break. It comes off the longest Normal Work segment. SimpleHours calculates the hours for you.`,
    },
    {
      q: 'What’s in the payroll report?',
      icon: <BarChart3 className="w-4 h-4 text-[var(--primary)]" />,
      a: 'Reports totals each worker’s fortnight: normal, Saturday, Sunday and public holiday hours, Sick Leave, Annual Leave, TIL, LWIP (leave without pay), Other and unplanned hours, next to rostered, worked and contracted hours. Export it as CSV or PDF.',
    },
    {
      q: 'Do workers sign in?',
      icon: <ShieldCheck className="w-4 h-4 text-[var(--primary)]" />,
      a: 'No. Workers are records that you roster, timesheet and report on. Only the Organisation Owner and Branch Admins sign in to SimpleHours.',
    },
  ];

  const handleStartTour = () => {
    onClose();
    if (onStartTutorial) onStartTutorial();
    else window.dispatchEvent(new Event('start-simplehours-tutorial'));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div
        className="w-full max-w-lg bg-[var(--panel)] border border-[var(--border)] rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="help-modal-title"
      >
        <div className="px-6 py-5 border-b border-[var(--border)] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-[var(--primary-light)] text-[var(--primary)]">
              <HelpCircle className="w-5 h-5" />
            </div>
            <div>
              <h2 id="help-modal-title" className="text-base font-bold text-[var(--text)]">Help & guide</h2>
              <p className="text-xs text-[var(--muted)]">Quick answers to common questions</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--panel-subtle)] transition-colors"
            aria-label="Close help"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-6 py-4 overflow-y-auto flex-1 space-y-3">
          <div className="p-3.5 rounded-xl bg-[var(--primary-light)]/40 border border-[var(--primary)]/25 flex items-center justify-between gap-3">
            <div>
              <div className="font-semibold text-xs text-[var(--text)] flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-[var(--primary)]" />
                Need a quick refresher?
              </div>
              <p className="text-[11px] text-[var(--muted)] mt-0.5">Take the one-minute tour of how SimpleHours works.</p>
            </div>
            <Button variant="primary" size="sm" onClick={handleStartTour} className="shrink-0">
              Start tour
            </Button>
          </div>

          <div className="space-y-2 pt-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">Frequently asked questions</h3>

            {faqs.map((faq, idx) => {
              const isExpanded = expandedIndex === idx;
              return (
                <div key={faq.q} className="rounded-xl border border-[var(--border)] bg-[var(--panel)] overflow-hidden transition-colors">
                  <button
                    type="button"
                    onClick={() => setExpandedIndex(isExpanded ? null : idx)}
                    aria-expanded={isExpanded}
                    className="w-full px-4 py-3 text-left flex items-center justify-between gap-3 hover:bg-[var(--panel-subtle)] transition-colors text-xs font-semibold text-[var(--text)]"
                  >
                    <div className="flex items-center gap-2.5">
                      {faq.icon}
                      <span>{faq.q}</span>
                    </div>
                    {isExpanded ? (
                      <ChevronUp className="w-4 h-4 text-[var(--muted)] shrink-0" />
                    ) : (
                      <ChevronDown className="w-4 h-4 text-[var(--muted)] shrink-0" />
                    )}
                  </button>
                  {isExpanded && (
                    <div className="px-4 pb-3.5 pt-1 text-xs text-[var(--muted)] leading-relaxed border-t border-[var(--border)]/50 bg-[var(--panel-subtle)]/40">
                      {faq.a}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="px-6 py-3.5 bg-[var(--panel-subtle)] border-t border-[var(--border)] flex items-center justify-between gap-3 text-xs text-[var(--muted)]">
          <span>{isOwner ? 'Still stuck? Ask the help assistant.' : 'Still stuck? Ask the help assistant or your Organisation Owner.'}</span>
          <Button variant="outline" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
};

export default ContextHelpModal;
