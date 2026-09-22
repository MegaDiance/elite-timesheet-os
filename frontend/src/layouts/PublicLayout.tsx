import React, { useState, useEffect } from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import { Clock, ShieldCheck, Menu, X } from 'lucide-react';
import { Button } from '../components/ui/Button';

export const PublicLayout: React.FC = () => {
  const location = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname]);

  const navLinks = [
    { label: 'Overview', path: '/' },
    { label: 'Features', path: '/features' },
    { label: 'Pricing', path: '/pricing' },
  ];

  const isActive = (path: string) => (path === '/' ? location.pathname === '/' : location.pathname.startsWith(path));

  return (
    <div className="min-h-screen flex flex-col bg-[var(--bg)] text-[var(--text)]">
      <div className="border-b border-[var(--border)] bg-[var(--panel-subtle)]/70 px-4 py-1.5 text-xs text-center text-[var(--muted)] flex items-center justify-center gap-2">
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-[var(--success)]" />
        <span>SimpleHours: fortnightly rosters, timesheets and payroll hours for multi-branch teams</span>
      </div>

      <header className="sticky top-0 z-40 w-full border-b border-[var(--border)] bg-[var(--panel)]/90 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
          <Link to="/" className="flex items-center gap-2.5 group">
            <div className="w-8 h-8 rounded-lg bg-[var(--primary)] flex items-center justify-center text-white shadow-xs group-hover:bg-[var(--primary-h)] transition-colors">
              <Clock className="w-4 h-4" />
            </div>
            <span className="font-bold text-base tracking-tight text-[var(--text)]">SimpleHours</span>
          </Link>

          <nav className="hidden md:flex items-center gap-1 bg-[var(--panel-subtle)]/70 px-2 py-1 rounded-lg border border-[var(--border)]">
            {navLinks.map(link => (
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

          <div className="hidden md:flex items-center gap-2">
            <Link to="/login" className="px-3 py-1.5 text-xs font-semibold text-[var(--text)] hover:text-[var(--primary)] transition-colors">
              Sign in
            </Link>
            <Link to="/signup">
              <Button variant="primary" size="sm">Get started</Button>
            </Link>
          </div>

          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="md:hidden p-2 rounded-lg text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--panel-subtle)] border border-[var(--border)] transition-colors"
            aria-label="Toggle navigation menu"
            aria-expanded={mobileMenuOpen}
          >
            {mobileMenuOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4 text-[var(--text)]" />}
          </button>
        </div>

        {mobileMenuOpen && (
          <div className="md:hidden border-t border-[var(--border)] bg-[var(--panel)] px-4 py-3 space-y-1 shadow-lg">
            {navLinks.map(link => (
              <Link
                key={link.path}
                to={link.path}
                className={`block px-3 py-2 rounded-md text-sm font-medium ${
                  isActive(link.path) ? 'bg-[var(--primary-light)] text-[var(--primary)] font-semibold' : 'text-[var(--text)] hover:bg-[var(--panel-subtle)]'
                }`}
              >
                {link.label}
              </Link>
            ))}
            <div className="pt-2 mt-2 border-t border-[var(--border)] grid grid-cols-2 gap-2">
              <Link to="/login">
                <Button variant="secondary" size="md" className="w-full">Sign in</Button>
              </Link>
              <Link to="/signup">
                <Button variant="primary" size="md" className="w-full">Get started</Button>
              </Link>
            </div>
          </div>
        )}
      </header>

      <main className="flex-1">
        <Outlet />
      </main>

      <footer className="border-t border-[var(--border)] bg-[var(--panel)] py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-4 gap-8 mb-8">
          <div className="md:col-span-1 space-y-3">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-md bg-[var(--primary)] flex items-center justify-center text-white">
                <Clock className="w-4 h-4" />
              </div>
              <span className="font-semibold text-sm text-[var(--text)]">SimpleHours</span>
            </div>
            <p className="text-xs text-[var(--muted)] leading-relaxed">
              Rosters, timesheets and payroll-hours reports for organisations with one or many branches.
            </p>
            <div className="flex items-center gap-2 text-xs text-[var(--muted)]">
              <ShieldCheck className="w-4 h-4 text-[var(--success)]" />
              <span>Two-step verification and audit log</span>
            </div>
          </div>

          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--text)] mb-3">Product</h4>
            <ul className="space-y-2 text-xs text-[var(--muted)]">
              <li><Link to="/features" className="hover:text-[var(--text)] transition-colors">Fortnightly roster</Link></li>
              <li><Link to="/features" className="hover:text-[var(--text)] transition-colors">Multi-segment days</Link></li>
              <li><Link to="/features" className="hover:text-[var(--text)] transition-colors">Per-branch locks</Link></li>
              <li><Link to="/features" className="hover:text-[var(--text)] transition-colors">Payroll hours, CSV and PDF</Link></li>
            </ul>
          </div>

          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--text)] mb-3">Security</h4>
            <ul className="space-y-2 text-xs text-[var(--muted)]">
              <li><Link to="/features" className="hover:text-[var(--text)] transition-colors">Owner and Branch Admin access</Link></li>
              <li><Link to="/features" className="hover:text-[var(--text)] transition-colors">Two-step verification</Link></li>
              <li><Link to="/features" className="hover:text-[var(--text)] transition-colors">Session timeout</Link></li>
              <li><Link to="/features" className="hover:text-[var(--text)] transition-colors">Audit log</Link></li>
            </ul>
          </div>

          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--text)] mb-3">Get going</h4>
            <ul className="space-y-2 text-xs text-[var(--muted)]">
              <li><Link to="/signup" className="hover:text-[var(--text)] transition-colors">Set up a new organisation</Link></li>
              <li><Link to="/login" className="hover:text-[var(--text)] transition-colors">Sign in</Link></li>
              <li><Link to="/pricing" className="hover:text-[var(--text)] transition-colors">Pricing</Link></li>
            </ul>
          </div>
        </div>

        <div className="max-w-7xl mx-auto pt-6 border-t border-[var(--border)] flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-[var(--muted)]">
          <p>© {new Date().getFullYear()} SimpleHours. All rights reserved.</p>
          <p>Made for Australian workplaces.</p>
        </div>
      </footer>
    </div>
  );
};
