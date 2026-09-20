import { useState, useEffect, type FC } from 'react';
import { Calendar, Clock, Send, CheckCircle2, ArrowRight, ArrowLeft, X, Sparkles } from 'lucide-react';
import { Button } from './ui/Button';

interface OnboardingTutorialProps {
  forceOpen?: boolean;
  onClose?: () => void;
}

export const OnboardingTutorial: FC<OnboardingTutorialProps> = ({ forceOpen = false, onClose }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);

  useEffect(() => {
    const seen = localStorage.getItem('simplehours_tutorial_seen');
    if (!seen || forceOpen) {
      setIsOpen(true);
      setCurrentStep(0);
    }
  }, [forceOpen]);

  useEffect(() => {
    const handleStartTutorial = () => {
      setIsOpen(true);
      setCurrentStep(0);
    };
    window.addEventListener('start-simplehours-tutorial', handleStartTutorial);
    return () => window.removeEventListener('start-simplehours-tutorial', handleStartTutorial);
  }, []);

  const handleFinish = () => {
    localStorage.setItem('simplehours_tutorial_seen', 'true');
    setIsOpen(false);
    if (onClose) onClose();
  };

  const handleSkip = () => {
    localStorage.setItem('simplehours_tutorial_seen', 'true');
    setIsOpen(false);
    if (onClose) onClose();
  };

  if (!isOpen) return null;

  const steps = [
    // Step 0: Welcome
    {
      title: 'Welcome to SimpleHours',
      subtitle: "We'll quickly show you how everything works in under a minute.",
      icon: <Sparkles className="w-8 h-8 text-[var(--primary)]" />,
      content: (
        <div className="space-y-4 py-2 text-center">
          <p className="text-sm text-[var(--muted)] leading-relaxed max-w-sm mx-auto">
            SimpleHours is designed to make checking your shifts and recording your hours straightforward, clear, and stress-free.
          </p>
          <div className="grid grid-cols-3 gap-3 pt-2 text-xs">
            <div className="p-3 rounded-lg bg-[var(--panel-subtle)] border border-[var(--border)] space-y-1 text-center">
              <Calendar className="w-4 h-4 text-[var(--primary)] mx-auto" />
              <div className="font-semibold text-[var(--text)]">1. Schedule</div>
              <div className="text-[10px] text-[var(--muted)]">See your shifts</div>
            </div>
            <div className="p-3 rounded-lg bg-[var(--panel-subtle)] border border-[var(--border)] space-y-1 text-center">
              <Clock className="w-4 h-4 text-[var(--primary)] mx-auto" />
              <div className="font-semibold text-[var(--text)]">2. Hours</div>
              <div className="text-[10px] text-[var(--muted)]">Save your time</div>
            </div>
            <div className="p-3 rounded-lg bg-[var(--panel-subtle)] border border-[var(--border)] space-y-1 text-center">
              <Send className="w-4 h-4 text-[var(--primary)] mx-auto" />
              <div className="font-semibold text-[var(--text)]">3. Submit</div>
              <div className="text-[10px] text-[var(--muted)]">Send to manager</div>
            </div>
          </div>
        </div>
      ),
      primaryAction: 'Start tutorial',
    },
    // Step 1: Schedule
    {
      title: '1. Check Your Schedule',
      subtitle: "See exactly when you're scheduled to work.",
      icon: <Calendar className="w-8 h-8 text-[var(--primary)]" />,
      content: (
        <div className="space-y-3 py-1">
          <p className="text-xs sm:text-sm text-[var(--muted)] leading-relaxed">
            Your manager publishes your shift schedule for each two-week period. You can easily view your shifts on your phone, tablet, or computer.
          </p>
          {/* Interactive demo card */}
          <div className="p-3.5 rounded-xl bg-[var(--panel-subtle)] border border-[var(--border)] space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-[var(--text)]">Monday, 30 March</span>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[var(--primary-light)] text-[var(--primary)]">
                Scheduled Shift
              </span>
            </div>
            <div className="flex items-center justify-between bg-[var(--panel)] p-2.5 rounded-lg border border-[var(--border)] text-xs">
              <div>
                <div className="font-mono font-bold text-sm text-[var(--text)]">09:00 AM – 05:00 PM</div>
                <div className="text-[11px] text-[var(--muted)]">Standard shift • 30 min meal break</div>
              </div>
              <div className="text-right font-mono font-bold text-[var(--primary)] text-sm">
                7.5 hrs
              </div>
            </div>
          </div>
        </div>
      ),
      primaryAction: 'Next: Timesheets',
    },
    // Step 2: Timesheet
    {
      title: '2. Enter Your Hours',
      subtitle: 'Recording your time is like filling a simple day form.',
      icon: <Clock className="w-8 h-8 text-[var(--primary)]" />,
      content: (
        <div className="space-y-3 py-1">
          <p className="text-xs sm:text-sm text-[var(--muted)] leading-relaxed">
            When you finish work, open your timesheet. Just confirm your start, finish, and break times. You can tap <strong>Save</strong> for each day.
          </p>
          {/* Mock timesheet form */}
          <div className="p-3.5 rounded-xl bg-[var(--panel-subtle)] border border-[var(--border)] space-y-2.5 text-xs">
            <div className="flex items-center justify-between font-semibold text-[var(--text)]">
              <span>Today's Hours</span>
              <span className="text-[var(--success)] font-medium text-[11px] flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" /> Saved
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1">
                <span className="text-[10px] text-[var(--muted)] uppercase font-semibold">Start</span>
                <div className="px-2.5 py-1.5 rounded-md bg-[var(--panel)] border border-[var(--border)] font-mono text-center">
                  09:00 AM
                </div>
              </div>
              <div className="space-y-1">
                <span className="text-[10px] text-[var(--muted)] uppercase font-semibold">Finish</span>
                <div className="px-2.5 py-1.5 rounded-md bg-[var(--panel)] border border-[var(--border)] font-mono text-center">
                  05:00 PM
                </div>
              </div>
              <div className="space-y-1">
                <span className="text-[10px] text-[var(--muted)] uppercase font-semibold">Break</span>
                <div className="px-2.5 py-1.5 rounded-md bg-[var(--panel)] border border-[var(--border)] font-mono text-center">
                  30 min
                </div>
              </div>
            </div>
          </div>
        </div>
      ),
      primaryAction: 'Next: Submitting',
    },
    // Step 3: Submit
    {
      title: '3. Submit Your Timesheet',
      subtitle: 'Send your completed hours to your manager for approval.',
      icon: <Send className="w-8 h-8 text-[var(--primary)]" />,
      content: (
        <div className="space-y-3 py-1">
          <p className="text-xs sm:text-sm text-[var(--muted)] leading-relaxed">
            At the end of your two-week pay cycle, tap <strong>Submit timesheet</strong>. Your manager reviews and approves it. You'll clearly see the status update:
          </p>
          <div className="space-y-2 pt-1">
            <div className="flex items-center justify-between p-2.5 rounded-lg bg-[var(--panel-subtle)] border border-[var(--border)] text-xs">
              <span className="text-[var(--muted)]">Status when submitted:</span>
              <span className="px-2.5 py-1 rounded-md text-[11px] font-semibold bg-[var(--primary-light)] text-[var(--primary)]">
                ⏳ Submitted (Under Review)
              </span>
            </div>
            <div className="flex items-center justify-between p-2.5 rounded-lg bg-[var(--panel-subtle)] border border-[var(--border)] text-xs">
              <span className="text-[var(--muted)]">Status when approved:</span>
              <span className="px-2.5 py-1 rounded-md text-[11px] font-semibold bg-[var(--success-light)] text-[var(--success)]">
                ✓ Approved
              </span>
            </div>
          </div>
        </div>
      ),
      primaryAction: 'Almost done',
    },
    // Step 4: Finish
    {
      title: "That's it! You're Ready to Go",
      subtitle: 'You can restart this 1-minute tutorial anytime from Help.',
      icon: <CheckCircle2 className="w-8 h-8 text-[var(--success)]" />,
      content: (
        <div className="space-y-3 py-3 text-center">
          <p className="text-sm text-[var(--text)] leading-relaxed max-w-sm mx-auto">
            Open SimpleHours whenever you work, record your hours, and submit before your pay cycle closes.
          </p>
          <div className="p-3 rounded-lg bg-[var(--panel-subtle)] border border-[var(--border)] text-xs text-[var(--muted)] max-w-sm mx-auto">
            💡 If you ever need help or have questions about a locked timesheet, tap <strong>Help</strong> in the menu.
          </div>
        </div>
      ),
      primaryAction: 'Got it, let’s begin!',
    },
  ];

  const current = steps[currentStep];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div 
        className="w-full max-w-lg bg-[var(--panel)] border border-[var(--border)] rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tutorial-title"
      >
        {/* Header Bar */}
        <div className="px-6 pt-6 pb-2 flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-[var(--primary-light)] text-[var(--primary)] border border-[var(--primary)]/20 shrink-0">
              {current.icon}
            </div>
            <div>
              <h2 id="tutorial-title" className="text-lg sm:text-xl font-bold text-[var(--text)]">
                {current.title}
              </h2>
              <p className="text-xs text-[var(--muted)] mt-0.5">
                {current.subtitle}
              </p>
            </div>
          </div>
          <button
            onClick={handleSkip}
            className="p-1.5 rounded-lg text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--panel-subtle)] transition-colors shrink-0"
            aria-label="Close tutorial"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body Content */}
        <div className="px-6 py-4 overflow-y-auto flex-1">
          {current.content}
        </div>

        {/* Footer Navigation Bar */}
        <div className="px-6 py-4 bg-[var(--panel-subtle)] border-t border-[var(--border)] flex items-center justify-between gap-3">
          {/* Step indicators */}
          <div className="flex items-center gap-1.5">
            {steps.map((_, idx) => (
              <span
                key={idx}
                className={`h-1.5 rounded-full transition-all duration-200 ${
                  idx === currentStep
                    ? 'w-6 bg-[var(--primary)]'
                    : idx < currentStep
                    ? 'w-1.5 bg-[var(--primary)]/60'
                    : 'w-1.5 bg-[var(--border)]'
                }`}
                aria-label={`Step ${idx + 1}`}
              />
            ))}
          </div>

          <div className="flex items-center gap-2">
            {currentStep > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setCurrentStep(prev => prev - 1)}
                leftIcon={<ArrowLeft className="w-3.5 h-3.5" />}
              >
                Back
              </Button>
            )}

            {currentStep === 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleSkip}
              >
                Skip
              </Button>
            )}

            {currentStep < steps.length - 1 ? (
              <Button
                variant="primary"
                size="sm"
                onClick={() => setCurrentStep(prev => prev + 1)}
                rightIcon={<ArrowRight className="w-3.5 h-3.5" />}
              >
                {current.primaryAction}
              </Button>
            ) : (
              <Button
                variant="primary"
                size="sm"
                onClick={handleFinish}
                rightIcon={<CheckCircle2 className="w-3.5 h-3.5" />}
              >
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
