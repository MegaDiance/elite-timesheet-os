import { useState, useEffect, type FC, type ReactNode } from 'react';
import {
  Building2,
  Calendar,
  CheckCircle2,
  ArrowRight,
  ArrowLeft,
  X,
  Sparkles,
  ClipboardCheck,
  BarChart3,
  Plus,
  Lock,
} from 'lucide-react';
import { Button } from './ui/Button';
import { useAccess } from '../hooks/useAccess';

interface OnboardingTutorialProps {
  forceOpen?: boolean;
  onClose?: () => void;
}

interface Step {
  title: string;
  subtitle: string;
  icon: ReactNode;
  content: ReactNode;
  primaryAction: string;
}

const SEEN_KEY = 'simplehours_tutorial_seen';

/** Dispatch this event on `window` to open the tour from anywhere (help modal, dashboard, assistant). */
const START_EVENT = 'start-simplehours-tutorial';

const panel = 'p-3.5 rounded-xl bg-[var(--panel-subtle)] border border-[var(--border)]';

export const OnboardingTutorial: FC<OnboardingTutorialProps> = ({ forceOpen = false, onClose }) => {
  const { access, isOwner } = useAccess();
  const [isOpen, setIsOpen] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);

  useEffect(() => {
    if (!localStorage.getItem(SEEN_KEY) || forceOpen) {
      setIsOpen(true);
      setCurrentStep(0);
    }
  }, [forceOpen]);

  useEffect(() => {
    const handleStart = () => {
      setIsOpen(true);
      setCurrentStep(0);
    };
    window.addEventListener(START_EVENT, handleStart);
    return () => window.removeEventListener(START_EVENT, handleStart);
  }, []);

  const close = () => {
    localStorage.setItem(SEEN_KEY, 'true');
    setIsOpen(false);
    onClose?.();
  };

  if (!isOpen) return null;

  const orgName = access?.organisation.name || 'your organisation';
  const branchNames = (access?.branches ?? []).map(b => b.name);

  const steps: Step[] = [
    {
      title: 'Welcome to SimpleHours',
      subtitle: 'A one-minute tour of how rosters and timesheets work here.',
      icon: <Sparkles className="w-8 h-8 text-[var(--primary)]" />,
      content: (
        <div className="space-y-4 py-2 text-center">
          <p className="text-sm text-[var(--muted)] leading-relaxed max-w-sm mx-auto">
            {isOwner
              ? <>You're the <strong className="text-[var(--text)]">Organisation Owner</strong> of {orgName}. You can see and manage every branch.</>
              : <>You're a <strong className="text-[var(--text)]">Branch Admin</strong> at {orgName}. You manage the branches you've been assigned.</>}
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 text-xs">
            {[
              { icon: <Building2 className="w-4 h-4 text-[var(--primary)] mx-auto" />, label: 'Branches', hint: isOwner ? 'Set up & assign' : 'Your scope' },
              { icon: <Calendar className="w-4 h-4 text-[var(--primary)] mx-auto" />, label: 'Roster', hint: 'Plan shifts' },
              { icon: <ClipboardCheck className="w-4 h-4 text-[var(--primary)] mx-auto" />, label: 'Timesheets', hint: 'Record & approve' },
              { icon: <BarChart3 className="w-4 h-4 text-[var(--primary)] mx-auto" />, label: 'Reports', hint: 'Payroll hours' },
            ].map(card => (
              <div key={card.label} className="p-3 rounded-lg bg-[var(--panel-subtle)] border border-[var(--border)] space-y-1 text-center">
                {card.icon}
                <div className="font-semibold text-[var(--text)]">{card.label}</div>
                <div className="text-[10px] text-[var(--muted)]">{card.hint}</div>
              </div>
            ))}
          </div>
        </div>
      ),
      primaryAction: 'Start the tour',
    },
    isOwner
      ? {
          title: 'Branches and Branch Admins',
          subtitle: 'Set up where people work and who looks after each branch.',
          icon: <Building2 className="w-8 h-8 text-[var(--primary)]" />,
          content: (
            <div className="space-y-3 py-1 text-xs sm:text-sm text-[var(--muted)] leading-relaxed">
              <p>
                Create your branches on the <strong className="text-[var(--text)]">Branches</strong> page. Then invite a
                Branch Admin from the <strong className="text-[var(--text)]">Branch Admins</strong> page and choose the
                branches they look after. They get an email invitation and can only see and change those branches.
              </p>
              <div className={`${panel} space-y-2 text-xs`}>
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-[var(--text)]">Branch Admin invitation</span>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[var(--primary-light)] text-[var(--primary)]">Sent</span>
                </div>
                <div className="text-[var(--muted)]">sam@example.com.au → Richmond, Footscray</div>
              </div>
              <p>Workers don't sign in. They are records you roster, timesheet and report on.</p>
            </div>
          ),
          primaryAction: 'Next: the roster',
        }
      : {
          title: 'Your branches',
          subtitle: 'Everything you do is limited to the branches you look after.',
          icon: <Building2 className="w-8 h-8 text-[var(--primary)]" />,
          content: (
            <div className="space-y-3 py-1 text-xs sm:text-sm text-[var(--muted)] leading-relaxed">
              <p>
                You manage the workers, roster and timesheets of{' '}
                <strong className="text-[var(--text)]">{branchNames.length ? branchNames.join(', ') : 'your branches'}</strong>.
                If you look after more than one branch, use the branch filter on each page to focus on one.
              </p>
              <p>
                The Organisation Owner creates branches and decides who is a Branch Admin. Ask them if you need access to
                another branch. Workers don't sign in; you record their hours for them.
              </p>
            </div>
          ),
          primaryAction: 'Next: the roster',
        },
    {
      title: 'Build the roster',
      subtitle: 'Plan each fortnight, one day at a time.',
      icon: <Calendar className="w-8 h-8 text-[var(--primary)]" />,
      content: (
        <div className="space-y-3 py-1">
          <p className="text-xs sm:text-sm text-[var(--muted)] leading-relaxed">
            Add workers on the <strong className="text-[var(--text)]">Workers</strong> page, then plan their shifts on the{' '}
            <strong className="text-[var(--text)]">Roster</strong>. A day can have several segments, such as a split shift
            or a morning of work and an afternoon of leave. Use <strong className="text-[var(--text)]">+ Add segment</strong> to
            add another one.
          </p>
          <div className={`${panel} space-y-2 text-xs`}>
            <div className="font-semibold text-[var(--text)]">Monday 30 March</div>
            {[
              { type: 'Normal Work', time: '08:00 – 12:00' },
              { type: 'Annual Leave', time: '13:00 – 16:00' },
            ].map(seg => (
              <div key={seg.type} className="flex items-center justify-between bg-[var(--panel)] p-2 rounded-lg border border-[var(--border)]">
                <span className="text-[var(--text)] font-medium">{seg.type}</span>
                <span className="font-mono text-[var(--muted)]">{seg.time}</span>
              </div>
            ))}
            <div className="inline-flex items-center gap-1 text-[var(--primary)] font-semibold">
              <Plus className="w-3.5 h-3.5" /> Add segment
            </div>
          </div>
          <p className="text-[11px] text-[var(--muted)]">
            Hours are calculated for you, and the organisation's unpaid break comes off once per day.
          </p>
        </div>
      ),
      primaryAction: 'Next: timesheets',
    },
    {
      title: 'Record and approve timesheets',
      subtitle: 'Enter the hours actually worked, then approve them.',
      icon: <ClipboardCheck className="w-8 h-8 text-[var(--primary)]" />,
      content: (
        <div className="space-y-3 py-1">
          <p className="text-xs sm:text-sm text-[var(--muted)] leading-relaxed">
            Record worked hours against the roster on the <strong className="text-[var(--text)]">Timesheets</strong> page.
            When a worker's fortnight is right, <strong className="text-[var(--text)]">Approve</strong> it. If something needs
            fixing later, <strong className="text-[var(--text)]">Reopen</strong> it, correct it and approve it again.
          </p>
          <div className={`${panel} space-y-2 text-xs`}>
            <div className="flex items-center justify-between">
              <span className="text-[var(--muted)]">Still being entered</span>
              <span className="px-2 py-0.5 rounded-md text-[11px] font-semibold bg-[var(--panel)] border border-[var(--border)] text-[var(--muted)]">Draft</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[var(--muted)]">Checked and signed off</span>
              <span className="px-2 py-0.5 rounded-md text-[11px] font-semibold bg-[var(--success-light)] text-[var(--success)]">Approved</span>
            </div>
          </div>
          <div className="flex items-start gap-2 text-[11px] text-[var(--muted)] leading-relaxed">
            <Lock className="w-3.5 h-3.5 shrink-0 mt-0.5 text-[var(--warn)]" />
            <span>
              Each branch can lock its roster and its timesheets for a fortnight. Locking needs your password or the
              organisation's lock password, and stops further changes until it is unlocked.
            </span>
          </div>
        </div>
      ),
      primaryAction: 'Next: reports',
    },
    {
      title: 'Reports for payroll',
      subtitle: 'Hours by category, ready for whoever runs your pays.',
      icon: <BarChart3 className="w-8 h-8 text-[var(--primary)]" />,
      content: (
        <div className="space-y-3 py-1">
          <p className="text-xs sm:text-sm text-[var(--muted)] leading-relaxed">
            The <strong className="text-[var(--text)]">Reports</strong> page totals each worker's fortnight: normal,
            Saturday, Sunday and public holiday hours, Sick Leave, Annual Leave, TIL, LWIP (leave without pay) and more.
            Export it as CSV or PDF.
          </p>
          <div className={`${panel} grid grid-cols-3 gap-2 text-center text-xs`}>
            {[
              { label: 'Normal', value: '68.50' },
              { label: 'Annual', value: '7.60' },
              { label: 'LWIP', value: '0.00' },
            ].map(cell => (
              <div key={cell.label} className="bg-[var(--panel)] p-2 rounded-lg border border-[var(--border)]">
                <div className="text-[10px] uppercase text-[var(--muted)] font-semibold">{cell.label}</div>
                <div className="font-mono font-bold text-[var(--text)]">{cell.value}</div>
              </div>
            ))}
          </div>
        </div>
      ),
      primaryAction: 'Almost done',
    },
    {
      title: "You're ready to go",
      subtitle: 'You can restart this tour at any time from Help.',
      icon: <CheckCircle2 className="w-8 h-8 text-[var(--success)]" />,
      content: (
        <div className="space-y-3 py-3 text-center">
          <p className="text-sm text-[var(--text)] leading-relaxed max-w-sm mx-auto">
            {isOwner
              ? 'Start by checking your branches, then invite a Branch Admin or add your first workers.'
              : 'Start with the Roster for your branch, then record worked hours on Timesheets.'}
          </p>
          <div className={`${panel} text-xs text-[var(--muted)] max-w-sm mx-auto`}>
            Stuck? Open <strong className="text-[var(--text)]">Help</strong> in the menu or ask the help assistant.
          </div>
        </div>
      ),
      primaryAction: "Let's begin",
    },
  ];

  const current = steps[currentStep];
  const isLast = currentStep === steps.length - 1;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div
        className="w-full max-w-lg bg-[var(--panel)] border border-[var(--border)] rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tutorial-title"
      >
        <div className="px-6 pt-6 pb-2 flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-[var(--primary-light)] text-[var(--primary)] border border-[var(--primary)]/20 shrink-0">
              {current.icon}
            </div>
            <div>
              <h2 id="tutorial-title" className="text-lg sm:text-xl font-bold text-[var(--text)]">{current.title}</h2>
              <p className="text-xs text-[var(--muted)] mt-0.5">{current.subtitle}</p>
            </div>
          </div>
          <button
            onClick={close}
            className="p-1.5 rounded-lg text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--panel-subtle)] transition-colors shrink-0"
            aria-label="Close tour"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-6 py-4 overflow-y-auto flex-1">{current.content}</div>

        <div className="px-6 py-4 bg-[var(--panel-subtle)] border-t border-[var(--border)] flex items-center justify-between gap-3">
          <div className="flex items-center gap-1.5">
            {steps.map((_, idx) => (
              <span
                key={idx}
                className={`h-1.5 rounded-full transition-all duration-200 ${
                  idx === currentStep ? 'w-6 bg-[var(--primary)]' : idx < currentStep ? 'w-1.5 bg-[var(--primary)]/60' : 'w-1.5 bg-[var(--border)]'
                }`}
                aria-label={`Step ${idx + 1}`}
              />
            ))}
          </div>

          <div className="flex items-center gap-2">
            {currentStep > 0 && (
              <Button variant="ghost" size="sm" onClick={() => setCurrentStep(prev => prev - 1)} leftIcon={<ArrowLeft className="w-3.5 h-3.5" />}>
                Back
              </Button>
            )}
            {currentStep === 0 && (
              <Button variant="ghost" size="sm" onClick={close}>
                Skip
              </Button>
            )}
            {isLast ? (
              <Button variant="primary" size="sm" onClick={close} rightIcon={<CheckCircle2 className="w-3.5 h-3.5" />}>
                {current.primaryAction}
              </Button>
            ) : (
              <Button variant="primary" size="sm" onClick={() => setCurrentStep(prev => prev + 1)} rightIcon={<ArrowRight className="w-3.5 h-3.5" />}>
                {current.primaryAction}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default OnboardingTutorial;
