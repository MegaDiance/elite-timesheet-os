import { useState } from 'react';
import { HelpCircle, Sparkles, Lock, Clock, Send, ChevronDown, ChevronUp, X, ShieldCheck } from 'lucide-react';
import { Button } from './ui/Button';

interface ContextHelpModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultTopic?: string;
  onStartTutorial?: () => void;
}

export const ContextHelpModal: React.FC<ContextHelpModalProps> = ({
  isOpen,
  onClose,
  onStartTutorial
}) => {
  const [expandedIndex, setExpandedIndex] = useState<number | null>(0);

  if (!isOpen) return null;

  const faqs = [
    {
      q: 'Why is my timesheet locked or disabled?',
      icon: <Lock className="w-4 h-4 text-[var(--warn)]" />,
      a: 'Your timesheet is locked once your manager has approved it or sealed the fortnight payroll cycle. This ensures payroll accuracy and prevents accidental changes. If you need to fix a past error, ask your manager to unlock or return it for changes.',
    },
    {
      q: 'How do I enter and save my hours?',
      icon: <Clock className="w-4 h-4 text-[var(--primary)]" />,
      a: 'Go to the Timesheet page. For each day you worked, verify your Start and Finish times. You can tap "Match Schedule" if your hours matched your rostered shift, or type in the exact times. Tap "Save" on that day. Once all 14 days are recorded, tap "Submit timesheet".',
    },
    {
      q: 'When should I submit my timesheet?',
      icon: <Send className="w-4 h-4 text-[var(--success)]" />,
      a: 'Submit your timesheet at the end of every 14-day pay fortnight, once your last shift of the cycle is completed. Submitting notifies your manager that your hours are ready for review.',
    },
    {
      q: 'How do automatic meal break deductions work?',
      icon: <ShieldCheck className="w-4 h-4 text-[var(--primary)]" />,
      a: 'Under standard employment rules, when a shift exceeds 6 hours, an automatic 30-minute unpaid meal break is deducted from total hours. You can adjust the break time if your actual break duration differed.',
    },
    {
      q: 'What should I do if my manager returns my timesheet?',
      icon: <HelpCircle className="w-4 h-4 text-[var(--danger)]" />,
      a: 'If a timesheet needs changes, your manager will return it with a note explaining what to correct (for example, a missing finish time). Simply make the requested correction on that day and tap "Resubmit timesheet".',
    },
  ];

  const handleRestartTutorial = () => {
    onClose();
    if (onStartTutorial) {
      onStartTutorial();
    } else {
      window.dispatchEvent(new CustomEvent('start-simplehours-tutorial'));
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div 
        className="w-full max-w-lg bg-[var(--panel)] border border-[var(--border)] rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="help-modal-title"
      >
        {/* Header */}
        <div className="px-6 py-5 border-b border-[var(--border)] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-[var(--primary-light)] text-[var(--primary)]">
              <HelpCircle className="w-5 h-5" />
            </div>
            <div>
              <h2 id="help-modal-title" className="text-base font-bold text-[var(--text)]">
                SimpleHours Help & Guidance
              </h2>
              <p className="text-xs text-[var(--muted)]">
                Quick answers for common questions
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--panel-subtle)] transition-colors"
            aria-label="Close help modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body FAQs */}
        <div className="px-6 py-4 overflow-y-auto flex-1 space-y-3">
          {/* Quick Tour Banner */}
          <div className="p-3.5 rounded-xl bg-[var(--primary-light)]/40 border border-[var(--primary)]/25 flex items-center justify-between gap-3">
            <div>
              <div className="font-semibold text-xs text-[var(--text)] flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-[var(--primary)]" />
                Need a quick refresher?
              </div>
              <p className="text-[11px] text-[var(--muted)] mt-0.5">
                Take the 1-minute visual tour of how SimpleHours works.
              </p>
            </div>
            <Button
              variant="primary"
              size="sm"
              onClick={handleRestartTutorial}
              className="shrink-0"
            >
              Start Tour
            </Button>
          </div>

          <div className="space-y-2 pt-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
              Frequently Asked Questions
            </h3>

            {faqs.map((faq, idx) => {
              const isExpanded = expandedIndex === idx;
              return (
                <div
                  key={idx}
                  className="rounded-xl border border-[var(--border)] bg-[var(--panel)] overflow-hidden transition-colors"
                >
                  <button
                    type="button"
                    onClick={() => setExpandedIndex(isExpanded ? null : idx)}
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

        {/* Footer */}
        <div className="px-6 py-3.5 bg-[var(--panel-subtle)] border-t border-[var(--border)] flex items-center justify-between text-xs text-[var(--muted)]">
          <span>Need further assistance? Ask your manager.</span>
          <Button variant="outline" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
};

export default ContextHelpModal;
