import React, { useEffect, useLayoutEffect, useState } from 'react';
import { Outlet, Link, NavLink, useLocation } from 'react-router-dom';
import { Clock, Menu, X } from 'lucide-react';
import { CtaLink } from '../pages/public/ui';

/**
 * Layout for the public website (/, /features, /pricing).
 * Purely presentational: it never calls the API or shows account data, even for a signed-in visitor.
 */

const PAGE_TITLES: Record<string, string> = {
  '/': 'SimpleHours · Rosters, timesheets and payroll preparation',
  '/features': 'Features · SimpleHours',
  '/pricing': 'Pricing · SimpleHours',
};

const NAV = [
  { label: 'Features', to: '/features' },
  { label: 'Pricing', to: '/pricing' },
];

const focusRing =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--primary)]';

function savedTheme(): 'light' | 'dark' | null {
  try {
    const value = localStorage.getItem('theme');
    return value === 'light' || value === 'dark' ? value : null;
  } catch {
    return null;
  }
}

/** Use the theme saved by the app if there is one, otherwise follow the device setting. Never writes the setting. */
function usePublicTheme() {
  useLayoutEffect(() => {
    const media = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-color-scheme: dark)') : null;
    const apply = () => {
      const theme = savedTheme() ?? (media?.matches ? 'dark' : 'light');
      document.documentElement.setAttribute('data-theme', theme);
      document.body.classList.toggle('light-mode', theme === 'light');
    };
    apply();
    media?.addEventListener('change', apply);
    return () => media?.removeEventListener('change', apply);
  }, []);
}

function usePageTitle(pathname: string) {
  useEffect(() => {
    const previous = document.title;
    const title = PAGE_TITLES[pathname];
    if (title) document.title = title;
    return () => {
      document.title = previous;
    };
  }, [pathname]);
}

function Logo() {
  return (
    <Link to="/" aria-label="SimpleHours home" className={`flex items-center gap-2.5 rounded-md ${focusRing}`}>
      <span aria-hidden="true" className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--primary)] text-white">
        <Clock className="h-4 w-4" strokeWidth={2.25} />
      </span>
      <span className="text-base font-semibold tracking-tight text-[var(--text)]">SimpleHours</span>
    </Link>
  );
}

export const PublicLayout: React.FC = () => {
  const { pathname } = useLocation();
  // The menu is open for the page it was opened on, so it closes by itself on navigation.
  const [menuOpenOn, setMenuOpenOn] = useState<string | null>(null);
  const menuOpen = menuOpenOn === pathname;

  usePublicTheme();
  usePageTitle(pathname);

  // Close the mobile menu with Escape.
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpenOn(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  const closeMenu = () => setMenuOpenOn(null);

  const navLinkClass = ({ isActive }: { isActive: boolean }, size = 'text-sm') =>
    `rounded-md px-3 py-2 ${size} font-medium transition-colors ${focusRing} ${
      isActive ? 'text-[var(--text)] bg-[var(--glass-8)]' : 'text-[var(--text)]/75 hover:text-[var(--text)] hover:bg-[var(--glass-4)]'
    }`;

  return (
    <div className="flex min-h-screen flex-col bg-[var(--bg)] text-[var(--text)]">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-md focus:bg-[var(--panel)] focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-[var(--text)] focus:shadow-lg focus:outline-2 focus:outline-[color:var(--primary)]"
      >
        Skip to content
      </a>

      <header className="sticky top-0 z-40 border-b border-[var(--border)] bg-[var(--bg)]/90 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
          <Logo />

          <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
            {NAV.map(item => (
              <NavLink key={item.to} to={item.to} className={navLinkClass}>
                {item.label}
              </NavLink>
            ))}
            <span aria-hidden="true" className="mx-2 h-5 w-px bg-[var(--border)]" />
            <NavLink to="/login" className={navLinkClass}>
              Sign in
            </NavLink>
            <CtaLink to="/signup" size="sm" className="ml-1">
              Get started
            </CtaLink>
          </nav>

          <button
            type="button"
            onClick={() => setMenuOpenOn(menuOpen ? null : pathname)}
            className={`flex h-10 w-10 items-center justify-center rounded-md border border-[var(--border)] text-[var(--text)] hover:bg-[var(--glass-4)] md:hidden ${focusRing}`}
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
            aria-controls="public-menu"
          >
            {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>

        {menuOpen && (
          <nav id="public-menu" aria-label="Main" className="border-t border-[var(--border)] bg-[var(--bg)] px-4 pt-2 pb-4 md:hidden">
            <ul className="space-y-1">
              {NAV.map(item => (
                <li key={item.to}>
                  <NavLink to={item.to} onClick={closeMenu} className={props => `block ${navLinkClass(props, 'text-base')}`}>
                    {item.label}
                  </NavLink>
                </li>
              ))}
            </ul>
            <div className="mt-3 grid grid-cols-2 gap-2 border-t border-[var(--border)] pt-4">
              <CtaLink to="/login" variant="secondary" onClick={closeMenu}>
                Sign in
              </CtaLink>
              <CtaLink to="/signup" onClick={closeMenu}>
                Get started
              </CtaLink>
            </div>
          </nav>
        )}
      </header>

      <main id="main" tabIndex={-1} className="flex-1 focus:outline-none">
        <Outlet />
      </main>

      <footer className="border-t border-[var(--border)] bg-[var(--panel)]">
        <div className="mx-auto flex max-w-7xl flex-col gap-8 px-4 py-10 sm:px-6 md:flex-row md:items-start md:justify-between lg:px-8">
          <div className="max-w-sm space-y-3">
            <Logo />
            <p className="text-sm leading-relaxed text-[var(--text)]/70">
              Rosters, timesheets and payroll preparation for Australian organisations with one or more branches.
            </p>
          </div>
          <nav aria-label="Footer">
            <ul className="grid grid-cols-2 gap-x-10 gap-y-2 text-sm sm:flex sm:flex-wrap sm:gap-x-8">
              {[
                { label: 'Features', to: '/features' },
                { label: 'Pricing', to: '/pricing' },
                { label: 'Sign in', to: '/login' },
                { label: 'Get started', to: '/signup' },
              ].map(item => (
                <li key={item.to}>
                  <Link
                    to={item.to}
                    className={`rounded-sm text-[var(--text)]/75 hover:text-[var(--text)] hover:underline hover:underline-offset-4 ${focusRing}`}
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>
        <div className="border-t border-[var(--border)]">
          <p className="mx-auto max-w-7xl px-4 py-6 text-sm text-[var(--text)]/70 sm:px-6 lg:px-8">
            © {new Date().getFullYear()} SimpleHours
          </p>
        </div>
      </footer>
    </div>
  );
};
