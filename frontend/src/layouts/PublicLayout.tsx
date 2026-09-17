import React, { useState, useEffect } from 'react';
import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import { Clock, ShieldCheck, ArrowRight, Building2 } from 'lucide-react';
import { Button } from '../components/ui/Button';

export const PublicLayout: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const [buildClicks, setBuildClicks] = useState(0);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Secret Platform Admin Hotkey: Cmd+Shift+P (Mac) or Ctrl+Shift+P (Win/Linux)
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'p' || e.key === 'P')) {
        e.preventDefault();
        navigate('/platform-gate');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [navigate]);

  const handleBuildClick = () => {
    const next = buildClicks + 1;
    setBuildClicks(next);
    if (next >= 5) {
      setBuildClicks(0);
      navigate('/platform-gate');
    }
  };

  const navLinks = [
    { label: 'Overview', path: '/' },
    { label: 'Features', path: '/features' },
    { label: 'Pricing', path: '/pricing' },
    { label: 'Portal', path: '/portal-access' },
  ];

  const isActive = (path: string) => {
    if (path === '/') return location.pathname === '/';
    return location.pathname.startsWith(path);
  };

  return (
    <div className="min-h-screen flex flex-col bg-[var(--bg)] text-[var(--text)] selection:bg-indigo-500/20 selection:text-indigo-400">
      {/* Top Banner / Announcement */}
      <div className="border-b border-[var(--border)] bg-[var(--panel-subtle)]/50 px-4 py-1.5 text-xs text-center text-[var(--muted)] flex items-center justify-center gap-2">
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
        <span>Elite Timesheet OS 2.0 — Production Workforce & Compliance Management</span>
      </div>

      {/* Main Navbar */}
      <header className="sticky top-0 z-40 w-full border-b border-[var(--border)] bg-[var(--panel)]/90 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          {/* Logo */}
          <Link to="/" className="flex items-center gap-2.5 group">
            <div className="w-9 h-9 rounded-lg bg-indigo-600 flex items-center justify-center text-white shadow-sm group-hover:bg-indigo-500 transition-colors">
              <Clock className="w-5 h-5" />
            </div>
            <div className="flex flex-col">
              <span className="font-bold text-sm tracking-tight text-[var(--text)] flex items-center gap-1.5">
                Elite Timesheet <span className="text-[10px] font-semibold tracking-wide uppercase px-1.5 py-0.2 rounded bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">OS Pro</span>
              </span>
              <span className="text-[11px] text-[var(--muted)] font-mono">Workforce & Compliance</span>
            </div>
          </Link>

          {/* Desktop Navigation */}
          <nav className="hidden md:flex items-center gap-1 bg-[var(--panel-subtle)]/60 p-1 rounded-lg border border-[var(--border)]">
            {navLinks.map((link) => (
              <Link
                key={link.path}
                to={link.path}
                className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  isActive(link.path)
                    ? 'bg-[var(--panel)] text-[var(--text)] shadow-xs font-semibold'
                    : 'text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--glass-4)]'
                }`}
              >
                {link.label}
              </Link>
            ))}
          </nav>

          {/* Action CTAs */}
          <div className="flex items-center gap-2.5">
            <Link to="/portal-access">
              <Button variant="primary" size="sm" rightIcon={<ArrowRight className="w-3.5 h-3.5" />}>
                Go to Portal
              </Button>
            </Link>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1">
        <Outlet />
      </main>

      {/* Professional SaaS Footer */}
      <footer className="border-t border-[var(--border)] bg-[var(--panel)] py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-4 gap-8 mb-8">
          <div className="md:col-span-1 space-y-3">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-md bg-indigo-600 flex items-center justify-center text-white">
                <Clock className="w-4 h-4" />
              </div>
              <span className="font-semibold text-sm">Elite Timesheet OS</span>
            </div>
            <p className="text-xs text-[var(--muted)] leading-relaxed">
              Industrial-grade workforce management, fortnight rostering, and Fair Work compliance for modern distributed teams.
            </p>
            <div className="flex items-center gap-2 text-[11px] text-[var(--muted)]">
              <ShieldCheck className="w-4 h-4 text-emerald-500" />
              <span>SOC2 & Fair Work Audit Ready</span>
            </div>
          </div>

          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--text)] mb-3">Product</h4>
            <ul className="space-y-2 text-xs text-[var(--muted)]">
              <li><Link to="/features" className="hover:text-[var(--text)] transition-colors">Shift Rostering</Link></li>
              <li><Link to="/features" className="hover:text-[var(--text)] transition-colors">Break Deductions</Link></li>
              <li><Link to="/features" className="hover:text-[var(--text)] transition-colors">Payroll Export (CSV / PDF)</Link></li>
              <li><Link to="/features" className="hover:text-[var(--text)] transition-colors">Xero Integration</Link></li>
            </ul>
          </div>

          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--text)] mb-3">Access & Security</h4>
            <ul className="space-y-2 text-xs text-[var(--muted)]">
              <li><Link to="/portal-access" className="hover:text-[var(--text)] transition-colors">Workplace Portal</Link></li>
              <li><Link to="/portal-access" className="hover:text-[var(--text)] transition-colors">Locate Workplace Portal</Link></li>
              <li><Link to="/features" className="hover:text-[var(--text)] transition-colors">Two-Factor Authentication</Link></li>
              <li><Link to="/features" className="hover:text-[var(--text)] transition-colors">Fortnight Lock Passwords</Link></li>
            </ul>
          </div>

          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--text)] mb-3">Workplace Access</h4>
            <p className="text-xs text-[var(--muted)] leading-relaxed mb-3">
              Access your organisation's dedicated timesheet and rostering instance.
            </p>
            <Link to="/portal-access">
              <Button variant="outline" size="sm" className="w-full justify-start" leftIcon={<Building2 className="w-3.5 h-3.5" />}>
                Go to Portal
              </Button>
            </Link>
          </div>
        </div>

        <div className="max-w-7xl mx-auto pt-6 border-t border-[var(--border)] flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-[var(--muted)]">
          <p>© {new Date().getFullYear()} Elite Timesheet OS Pro. All rights reserved.</p>
          <div className="flex items-center gap-4">
            <span 
              onClick={handleBuildClick}
              className={`select-none cursor-default transition-colors ${buildClicks > 0 ? 'text-indigo-400 font-medium' : ''}`}
              title="System Build Status"
            >
              Production Build v2.4.0
            </span>
            <span>•</span>
            <span>PostgreSQL & Supabase Ready</span>
          </div>
        </div>
      </footer>
    </div>
  );
};
