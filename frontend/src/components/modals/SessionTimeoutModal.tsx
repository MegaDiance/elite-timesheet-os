import React from 'react';
import { Clock, ShieldAlert, LogOut, CheckCircle2 } from 'lucide-react';
import { Button } from '../ui/Button';

interface SessionTimeoutModalProps {
  isOpen: boolean;
  remainingSeconds: number;
  isKeepingAlive: boolean;
  onStaySignedIn: () => void;
  onLogout: () => void;
}

export const SessionTimeoutModal: React.FC<SessionTimeoutModalProps> = ({
  isOpen,
  remainingSeconds,
  isKeepingAlive,
  onStaySignedIn,
  onLogout,
}) => {
  if (!isOpen) return null;

  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = remainingSeconds % 60;
  const formattedTime = `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop — non-dismissible to enforce intentional user response */}
      <div className="fixed inset-0 bg-black/75 backdrop-blur-xs transition-opacity" />

      {/* Dialog container */}
      <div 
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="session-timeout-title"
        aria-describedby="session-timeout-desc"
        className="relative w-full max-w-md bg-[var(--panel)] border border-amber-500/30 rounded-xl shadow-2xl z-10 overflow-hidden animate-in fade-in zoom-in-95 duration-150"
      >
        <div className="p-6 text-center space-y-4">
          <div className="w-14 h-14 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-500 flex items-center justify-center mx-auto">
            <Clock className="w-7 h-7 animate-pulse" />
          </div>

          <div>
            <h3 id="session-timeout-title" className="text-lg font-bold text-[var(--text)]">
              Session Inactivity Warning
            </h3>
            <p id="session-timeout-desc" className="text-xs text-[var(--muted)] mt-1.5 leading-relaxed">
              You have been inactive for over 10 minutes. For your data protection, you will be automatically signed out in:
            </p>
          </div>

          {/* Countdown Clock Display */}
          <div className="py-2.5 px-4 bg-amber-500/5 border border-amber-500/20 rounded-lg inline-block">
            <span className="font-mono text-3xl font-bold text-amber-400 tracking-wider">
              {formattedTime}
            </span>
          </div>

          <p className="text-[11px] text-[var(--muted)]">
            Click <strong className="text-[var(--text)]">Stay Signed In</strong> to refresh your secure session and continue working.
          </p>

          <div className="pt-2 flex flex-col sm:flex-row gap-2.5 justify-center">
            <Button
              variant="primary"
              size="md"
              onClick={onStaySignedIn}
              loading={isKeepingAlive}
              className="w-full sm:w-auto min-w-[140px]"
              leftIcon={<CheckCircle2 className="w-4 h-4" />}
            >
              Stay Signed In
            </Button>
            <Button
              variant="ghost"
              size="md"
              onClick={onLogout}
              disabled={isKeepingAlive}
              className="w-full sm:w-auto text-rose-400 hover:text-rose-300 hover:bg-rose-500/10"
              leftIcon={<LogOut className="w-4 h-4" />}
            >
              Sign Out
            </Button>
          </div>

          <div className="pt-3 border-t border-[var(--border)] flex items-center justify-center gap-1.5 text-[11px] text-[var(--muted)]">
            <ShieldAlert className="w-3.5 h-3.5 text-amber-500" />
            <span>Automatic compliance with 15-minute security logout policy</span>
          </div>
        </div>
      </div>
    </div>
  );
};
