import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  ArrowRight, 
  ShieldCheck, 
  HelpCircle,
  Clock
} from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';

export const PortalAccess: React.FC = () => {
  const [workspaceSlug, setWorkspaceSlug] = useState('');
  const [recentSlug, setRecentSlug] = useState<string | null>(null);
  const [recentName, setRecentName] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [secretClicks, setSecretClicks] = useState(0);

  const navigate = useNavigate();

  useEffect(() => {
    // Only loads private browser local cache for the returning user on this device
    const cachedSlug = localStorage.getItem('last_org_slug');
    const cachedName = localStorage.getItem('last_org_name');
    if (cachedSlug) {
      setRecentSlug(cachedSlug);
      setRecentName(cachedName || cachedSlug);
    }
  }, []);

  const handleSecretShieldClick = () => {
    const next = secretClicks + 1;
    setSecretClicks(next);
    if (next >= 5) {
      setSecretClicks(0);
      navigate('/platform-gate');
    }
  };

  const handleProceed = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = workspaceSlug.trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
    if (!clean) {
      setErrorMsg('Please enter your organisation workspace identifier.');
      return;
    }
    setErrorMsg(null);
    localStorage.setItem('last_org_slug', clean);
    navigate(`/login/${clean}`);
  };

  const handleGoToRecent = () => {
    if (recentSlug) {
      navigate(`/login/${recentSlug}`);
    }
  };

  return (
    <div className="max-w-md mx-auto px-4 sm:px-6 py-16 sm:py-24 space-y-6">
      {/* Header */}
      <div className="text-center space-y-2.5">
        <div className="w-11 h-11 rounded-xl bg-[var(--primary-light)] text-[var(--primary)] flex items-center justify-center mx-auto">
          <Clock className="w-5 h-5" />
        </div>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-[var(--text)]">
          Sign In to Simple Hours
        </h1>
        <p className="text-xs text-[var(--muted)] max-w-sm mx-auto leading-relaxed">
          Enter your organisation's dedicated workspace identifier to access your team's login page.
        </p>
      </div>

      {/* Return to Recent Workplace (Private to this browser) */}
      {recentSlug && (
        <Card className="p-4 bg-[var(--primary-light)]/40 border-[var(--primary)]/20 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-[var(--primary)] text-white flex items-center justify-center font-bold text-sm">
              {(recentName || recentSlug).charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-wider text-[var(--primary)] font-semibold">
                Your Recent Workspace
              </div>
              <div className="font-semibold text-xs text-[var(--text)] truncate max-w-[160px]">
                {recentName || recentSlug}
              </div>
            </div>
          </div>
          <Button
            variant="primary"
            size="sm"
            onClick={handleGoToRecent}
            rightIcon={<ArrowRight className="w-3.5 h-3.5" />}
          >
            Continue
          </Button>
        </Card>
      )}

      {/* Direct Workspace Identifier Input Form */}
      <Card className="p-6 space-y-5">
        <form onSubmit={handleProceed} className="space-y-4">
          <div>
            <label htmlFor="workspace-input" className="block text-xs font-semibold text-[var(--text)] mb-1.5">
              Workspace Identifier
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-[var(--muted)] font-mono select-none">
                /login/
              </span>
              <input
                id="workspace-input"
                type="text"
                placeholder="acme-clinic"
                value={workspaceSlug}
                onChange={(e) => {
                  setWorkspaceSlug(e.target.value);
                  if (errorMsg) setErrorMsg(null);
                }}
                autoFocus
                className="w-full bg-[var(--input-bg)] text-[var(--text)] text-sm rounded-lg pl-15 pr-3 py-2.5 border border-[var(--border)] focus:border-[var(--primary)] focus:outline-none font-mono"
              />
            </div>
            {errorMsg && (
              <p className="text-xs text-[var(--danger)] mt-1.5">{errorMsg}</p>
            )}
            <p className="text-xs text-[var(--muted)] mt-2 leading-relaxed">
              Example: if your workspace URL is <span className="font-mono text-[var(--text)]">simplehours.com/login/acme</span>, enter <span className="font-mono text-[var(--text)] font-semibold">acme</span>.
            </p>
          </div>

          <Button
            type="submit"
            variant="primary"
            size="md"
            className="w-full"
            rightIcon={<ArrowRight className="w-3.5 h-3.5" />}
          >
            Go to Workspace Login
          </Button>
        </form>

        <div className="pt-4 border-t border-[var(--border)] flex items-start gap-2.5 text-xs text-[var(--muted)]">
          <HelpCircle className="w-4 h-4 text-[var(--primary)] shrink-0 mt-0.5" />
          <p className="leading-relaxed">
            Need your workspace URL? Check your email invitation from your company admin or contact your manager.
          </p>
        </div>
      </Card>

      {/* Security badge with easter egg */}
      <div 
        onClick={handleSecretShieldClick}
        className="text-center text-xs text-[var(--muted)] flex items-center justify-center gap-1.5 pt-2 cursor-default select-none transition-colors"
        title="Protected by tenant isolation"
      >
        <ShieldCheck className={`w-4 h-4 transition-colors ${secretClicks > 0 ? 'text-[var(--primary)]' : 'text-[var(--success)]'}`} />
        <span>Strict Multi-Tenant Isolation & Role Authentication</span>
      </div>
    </div>
  );
};
