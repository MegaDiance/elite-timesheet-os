import { useLayoutEffect, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAccess } from '../hooks/useAccess';

interface SettingsLink {
  label: string;
  to: string;
  /** Path (and optional ?tab=) this link stands for, to mark it as the current page. */
  match: { path: string; tab?: string };
}

/**
 * The one heading and section row shared by every Settings page. Organisation set-up (branches,
 * roles, the audit log) lives here rather than in the main navigation, which is kept for daily
 * work. Only sections the person can use are listed. Display only: the API checks every call.
 */
export function SettingsNav() {
  const { access, can } = useAccess();
  const { pathname, search } = useLocation();
  const tab = new URLSearchParams(search).get('tab') ?? undefined;
  const isManager = access?.is_manager === true;

  const links: SettingsLink[] = [
    { label: 'My account', to: '/settings', match: { path: '/settings' } },
    ...(can('organisation.view') || can('organisation.edit') ? [{ label: 'Organisation', to: '/settings?tab=organisation', match: { path: '/settings', tab: 'organisation' } }] : []),
    ...(can('leave.manage') ? [{ label: 'Timesheets & leave', to: '/settings?tab=workforce', match: { path: '/settings', tab: 'workforce' } }] : []),
    ...(isManager ? [{ label: 'Branches', to: '/settings/branches', match: { path: '/settings/branches' } }] : []),
    ...(can('roles.manage') || can('users.manage') ? [{ label: 'Roles & permissions', to: '/settings/roles', match: { path: '/settings/roles' } }] : []),
    ...(can('security.manage') ? [{ label: 'Security', to: '/settings?tab=security', match: { path: '/settings', tab: 'security' } }] : []),
    ...(can('audit.view') ? [{ label: 'Audit log', to: '/settings/audit', match: { path: '/settings/audit' } }] : []),
    ...(access?.is_owner ? [{ label: 'Ownership', to: '/settings?tab=ownership', match: { path: '/settings', tab: 'ownership' } }] : []),
  ];

  const isCurrent = (l: SettingsLink) => pathname === l.match.path && (l.match.path !== '/settings' || tab === l.match.tab);

  // On a narrow screen the row scrolls sideways: bring the current section into view. Only the row
  // moves (never the page), so opening a section never jumps down the page.
  const navRef = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const nav = navRef.current;
    const current = nav?.querySelector<HTMLElement>('a[aria-current="page"]');
    if (!nav || !current) return;
    const left = current.offsetLeft - nav.offsetLeft;
    if (left < nav.scrollLeft || left + current.offsetWidth > nav.scrollLeft + nav.clientWidth) {
      nav.scrollLeft = Math.max(0, left - (nav.clientWidth - current.offsetWidth) / 2);
    }
  }, [pathname, tab]);

  return (
    <div className="space-y-3">
      <h1 className="text-xl font-semibold tracking-tight text-[var(--text)]">Settings</h1>
      {links.length > 1 && (
        <nav ref={navRef} aria-label="Settings sections" className="-mx-1 overflow-x-auto border-b border-[var(--border)]">
          <ul className="flex gap-1 px-1 min-w-max">
            {links.map(l => {
              const current = isCurrent(l);
              return (
                <li key={l.to}>
                  <Link
                    to={l.to}
                    aria-current={current ? 'page' : undefined}
                    className={`inline-flex items-center h-10 px-3 -mb-px border-b-2 text-sm whitespace-nowrap transition-colors ${
                      current
                        ? 'border-[var(--primary)] text-[var(--text)] font-semibold'
                        : 'border-transparent text-[var(--muted)] hover:text-[var(--text)]'
                    }`}
                  >
                    {l.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      )}
    </div>
  );
}
