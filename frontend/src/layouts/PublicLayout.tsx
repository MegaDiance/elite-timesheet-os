import React, { useState, useEffect } from 'react';
import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import { Clock, ShieldCheck, ArrowRight, Menu, X } from 'lucide-react';
import { Button } from '../components/ui/Button';

export const PublicLayout: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const [buildClicks, setBuildClicks] = useState(0);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

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

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname]);

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
  ];

  const isActive = (path: string) => {
    if (path === '/') return location.pathname === '/';
    return location.pathname.startsWith(path);
  };

  return (
    <div className="min-h-screen flex flex-col bg-[var(--bg)] text-[var(--text)]">
      {/* Top Banner */}
      <div className="border-b border-[var(--border)] bg-[var(--panel-subtle)]/70 px-4 py-1.5 text-xs text-center text-[var(--muted)] flex items-center justify-center gap-2">
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-[var(--success)] animate-pulse" />
        <span>Simple Hours — Precision scheduling and timesheet compliance for shift teams</span>
      </div>

      {/* Main Navbar */}
      <header className="sticky top-0 z-40 w-full border-b border-[var(--border)] bg-[var(--panel)]/90 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          {/* Logo */}
          <Link to="/" className="flex items-center gap-2.5 group">
            <div className="w-8 h-8 rounded-lg bg-[var(--primary)] flex items-center justify-center text-white shadow-xs group-hover:bg-[var(--primary-h)] transition-colors">
              <Clock className="w-4 h-4" />
            </div>
            <div className="flex items-center gap-1.5">
              <span className="font-bold text-base tracking-tight text-[var(--text)]">
                Simple Hours
              </span>
            </div>
          </Link>

          {/* Desktop Navigation */}
          <nav className="hidden md:flex items-center gap-1 bg-[var(--panel-subtle)]/70 px-2 py-1 rounded-lg border border-[var(--border)]">
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

          {/* Action CTAs & Mobile Toggle */}
          <div className="flex items-center gap-2.5">
            <Link to="/portal-access">
              <Button variant="primary" size="sm" rightIcon={<ArrowRight className="w-3.5 h-3.5" />}>
                Workspace Sign In
              </Button>
            </Link>

            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="md:hidden p-2 rounded-lg text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--panel-subtle)] border border-[var(--border)] transition-colors"
              aria-label="Toggle navigation menu"
            >
              {mobileMenuOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4 text-[var(--text)]" />}
            </button>
          </div>
        </div>

        {/* Mobile Dropdown Nav */}
        {mobileMenuOpen && (
          <div className="md:hidden border-t border-[var(--border)] bg-[var(--panel)] px-4 py-3 space-y-1 shadow-lg">
            {navLinks.map((link) => (
              <Link
                key={link.path}
                to={link.path}
                className={`block px-3 py-2 rounded-md text-sm font-medium ${
                  isActive(link.path)
                    ? 'bg-[var(--primary-light)] text-[var(--primary)] font-semibold'
                    : 'text-[var(--text)] hover:bg-[var(--panel-subtle)]'
                }`}
              >
                {link.label}
              </Link>
            ))}
            <div className="pt-2 border-t border-[var(--border)]">
              <Link to="/portal-access" className="block">
                <Button variant="outline" size="sm" className="w-full">
                  Workspace Sign In
                </Button>
              </Link>
            </div>
          </div>
        )}
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
              <div className="w-7 h-7 rounded-md bg-[var(--primary)] flex items-center justify-center text-white">
                <Clock className="w-4 h-4" />
              </div>
              <span className="font-semibold text-sm text-[var(--text)]">Simple Hours</span>
            </div>
            <p className="text-xs text-[var(--muted)] leading-relaxed">
              Workforce scheduling, automated break rules, and timesheet compliance designed for shift-based businesses.
            </p>
            <div className="flex items-center gap-2 text-xs text-[var(--muted)]">
              <ShieldCheck className="w-4 h-4 text-[var(--success)]" />
              <span>Isolated Tenant Architecture & 2FA</span>
            </div>
          </div>

          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--text)] mb-3">Product</h4>
            <ul className="space-y-2 text-xs text-[var(--muted)]">
              <li><Link to="/features" className="hover:text-[var(--text)] transition-colors">14-Day Roster Grid</Link></li>
              <li><Link to="/features" className="hover:text-[var(--text)] transition-colors">Automated Meal Deductions</Link></li>
              <li><Link to="/features" className="hover:text-[var(--text)] transition-colors">Dual Fortnight Locks</Link></li>
              <li><Link to="/features" className="hover:text-[var(--text)] transition-colors">RFC 4180 Payroll Exports</Link></li>
            </ul>
          </div>

          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--text)] mb-3">Compliance & Security</h4>
            <ul className="space-y-2 text-xs text-[var(--muted)]">
              <li><Link to="/features" className="hover:text-[var(--text)] transition-colors">Immutable Audit Ledger</Link></li>
              <li><Link to="/features" className="hover:text-[var(--text)] transition-colors">Two-Factor Authentication</Link></li>
              <li><Link to="/features" className="hover:text-[var(--text)] transition-colors">Session Security & Timeout</Link></li>
              <li><Link to="/features" className="hover:text-[var(--text)] transition-colors">Tenant Isolation</Link></li>
            </ul>
          </div>

          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--text)] mb-3">Workspace Access</h4>
            <p className="text-xs text-[var(--muted)] leading-relaxed mb-3">
              Access your organisation's dedicated environment via your private workplace URL.
            </p>
            <Link to="/portal-access">
              <Button variant="outline" size="sm" className="w-full">
                Go to Workspace Login
              </Button>
            </Link>
          </div>
        </div>

        <div className="max-w-7xl mx-auto pt-6 border-t border-[var(--border)] flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-[var(--muted)]">
          <p>© {new Date().getFullYear()} Simple Hours. All rights reserved.</p>
          <div className="flex items-center gap-4">
            <span 
              onClick={handleBuildClick}
              className={`select-none cursor-default transition-colors ${buildClicks > 0 ? 'text-[var(--primary)] font-medium' : ''}`}
              title="Build Information"
            >
              Simple Hours v3.0
            </span>
            <span>•</span>
            <span>Production Grade B2B SaaS</span>
          </div>
        </div>
      </footer>
    </div>
  );
};
