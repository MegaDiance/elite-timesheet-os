import { useState, useEffect, useRef, useCallback, type ReactNode } from 'react';
import { Outlet, useLocation, Link } from 'react-router-dom';
import {
  Clock,
  Calendar,
  CalendarDays,
  Users,
  FileText,
  Building2,
  LogOut,
  Moon,
  Sun,
  Sliders,
  MessageSquare,
  LayoutDashboard,
  BarChart3,
  Menu,
  X,
  HelpCircle,
  CheckSquare,
  Pin,
  PinOff,
  MapPin,
  UserCog,
  History,
} from 'lucide-react';
import api from '../services/apiClient';
import { OrgSwitchModal, type OrganisationChoice } from './modals/OrgSwitchModal';
import { BranchSwitchModal } from './modals/BranchSwitchModal';
import { SessionTimeoutModal } from './modals/SessionTimeoutModal';
import { useSessionTimeout } from '../hooks/useSessionTimeout';
import GuidedTour from './tour/GuidedTour';
import ContextHelpModal from './ContextHelpModal';
import { HelpTip } from './ui/HelpTip';
import { useToast } from './ui/Toast';
import { ROLE_LABEL, signOut, storeSession, useAccess, type Permission } from '../hooks/useAccess';
import { forgetActiveBranches, useActiveBranch } from '../hooks/useActiveBranch';
import { friendlyError } from '../services/errors';

type AttentionKey = 'timesheets' | 'leave';

interface NavItem {
  label: string;
  path: string;
  icon: ReactNode;
  permission?: Permission;
  /** Shows a count of things waiting (e.g. timesheets to approve). */
  attention?: AttentionKey;
}

interface NavSection {
  title: string;
  /** data-tour anchor, for the walkthrough. */
  tour?: string;
  items: NavItem[];
}

const icon = (Icon: typeof Clock) => <Icon className="w-4 h-4" aria-hidden="true" />;

/** Counts for the navigation badges, re-read on every page change and when the branch changes. */
function useAttention(enabled: boolean, branchId: string | null, pathname: string) {
  const [counts, setCounts] = useState<Record<AttentionKey, number>>({ timesheets: 0, leave: 0 });
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const query = branchId ? `?location_id=${encodeURIComponent(branchId)}` : '';
    api.get(`/dashboard/attention${query}`)
      .then(res => { if (!cancelled) setCounts({ timesheets: res.data.data.timesheets_waiting, leave: res.data.data.leave_pending }); })
      .catch(() => undefined); // badges are a convenience; the pages themselves show the real lists
    return () => { cancelled = true; };
  }, [enabled, branchId, pathname]);
  return counts;
}

function AttentionBadge({ count, label }: { count: number; label: string }) {
  if (count <= 0) return null;
  return (
    <span className="ml-auto min-w-5 h-5 px-1.5 rounded-full bg-[var(--warn)] text-white text-[11px] font-bold flex items-center justify-center">
      {count > 99 ? '99+' : count}
      <span className="sr-only"> {label} waiting</span>
    </span>
  );
}

export default function Layout() {
  const location = useLocation();
  const toast = useToast();
  const { access, isOwner, can } = useAccess();
  const { activeBranch, activeBranchId, branches: activeBranches, canSwitchBranch, setActiveBranch } = useActiveBranch();

  const [theme, setTheme] = useState(localStorage.getItem('theme') || 'light');
  const [organisations, setOrganisations] = useState<OrganisationChoice[]>([]);
  const [switching, setSwitching] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [showOrgSwitchModal, setShowOrgSwitchModal] = useState(false);
  const [showBranchSwitchModal, setShowBranchSwitchModal] = useState(false);
  const [showHelpModal, setShowHelpModal] = useState(false);
  const mainRef = useRef<HTMLElement>(null);

  // The sidebar is open on desktop by default so everything is labelled. It folds to icons on the
  // roster (the fortnight grid needs the room) and opens again on hover or keyboard focus there.
  const [isPinned, setIsPinned] = useState<boolean>(() => {
    const saved = localStorage.getItem('simplehours_sidebar_pinned');
    return saved === null ? true : saved === 'true';
  });
  const [isHovered, setIsHovered] = useState(false);
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isRoster = location.pathname === '/roster';
  const isSidebarOpen = (isPinned && !isRoster) || isHovered;

  const handleMouseEnter = () => {
    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
    hoverTimeoutRef.current = setTimeout(() => setIsHovered(true), 150);
  };
  const handleMouseLeave = () => {
    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
    setIsHovered(false);
  };

  const { showWarning, remainingSeconds, isKeepingAlive, staySignedIn, logoutNow } = useSessionTimeout();

  useEffect(() => {
    setMobileMenuOpen(false);
    setIsHovered(false);
  }, [location.pathname]);

  useEffect(() => {
    const handleOpenHelp = () => setShowHelpModal(true);
    window.addEventListener('open-help-modal', handleOpenHelp);
    return () => window.removeEventListener('open-help-modal', handleOpenHelp);
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    document.body.classList.toggle('light-mode', theme === 'light');
    localStorage.setItem('theme', theme);
  }, [theme]);

  useEffect(() => {
    let cancelled = false;
    api.get('/auth/organisations')
      .then(res => { if (!cancelled && Array.isArray(res.data?.data)) setOrganisations(res.data.data); })
      .catch(() => undefined); // the organisation switcher is simply hidden when the list can't be loaded
    return () => { cancelled = true; };
  }, [access?.organisation.id]);

  const handleSwitchOrg = async (orgId: string) => {
    if (!orgId || orgId === access?.organisation.id || switching) return;
    setSwitching(true);
    try {
      const res = await api.post('/auth/switch-organisation', { organisation_id: orgId });
      const token = res.data?.data?.token;
      if (!token) throw new Error('No session returned');
      storeSession(token, res.data?.data?.portal_path);
      window.location.assign('/app');
    } catch (err: any) {
      toast.error(friendlyError(err, 'Could not switch organisation. Please try again.'));
      setSwitching(false);
    }
  };

  const handleSignOut = async () => {
    forgetActiveBranches();
    await signOut();
  };

  const toggleTheme = () => setTheme(t => (t === 'light' ? 'dark' : 'light'));
  const togglePinned = () => {
    const next = !isPinned;
    setIsPinned(next);
    localStorage.setItem('simplehours_sidebar_pinned', String(next));
  };

  const skipToContent = useCallback(() => mainRef.current?.focus(), []);

  // ---------------------------------------------------------------------------
  // Navigation — built only from the permissions the server reports (GET /auth/me). Items a person
  // can't use are left out entirely, never shown disabled. Display only: the API checks every call.
  // ---------------------------------------------------------------------------
  const openHelp = () => setShowHelpModal(true);
  const isEmployee = access?.role === 'EMPLOYEE';
  const canSubmitTimesheets = access?.employee_capabilities?.can_submit_timesheets ?? false;
  const homePath = isEmployee ? '/my/schedule' : '/dashboard';
  const attention = useAttention(!isEmployee && can('branch.view'), activeBranchId, location.pathname);

  const employeeSections: NavSection[] = [
    {
      title: 'My work',
      tour: 'daily-nav',
      items: [
        { label: 'My schedule', path: '/my/schedule', icon: icon(Calendar) },
        ...(canSubmitTimesheets ? [
          { label: 'My timesheet', path: '/my/timesheet', icon: icon(CheckSquare) },
          { label: 'My past hours', path: '/my/history', icon: icon(History) },
        ] : []),
        { label: 'Leave', path: '/my/leave', icon: icon(CalendarDays) },
      ],
    },
  ];

  const managerSections: NavSection[] = [
    {
      title: 'Daily work',
      tour: 'daily-nav',
      items: [
        { label: 'Today', path: '/dashboard', permission: 'branch.view', icon: icon(LayoutDashboard) },
        { label: 'Roster', path: '/roster', permission: 'rosters.manage', icon: icon(Calendar) },
        { label: 'Timesheets', path: '/timesheets', permission: 'timesheets.manage', icon: icon(CheckSquare), attention: 'timesheets' },
        { label: 'Leave requests', path: '/leave-requests', permission: 'timesheets.manage', icon: icon(CalendarDays), attention: 'leave' },
      ],
    },
    {
      title: 'People',
      items: [
        { label: 'Workers', path: '/workers', permission: 'workers.manage', icon: icon(Users) },
        { label: 'Branch Admins', path: '/branch-admins', permission: 'branch_admins.manage', icon: icon(UserCog) },
      ],
    },
    {
      title: 'Records',
      items: [
        { label: 'Reports', path: '/reports', permission: 'reports.view', icon: icon(BarChart3) },
        { label: 'Audit log', path: '/audit', permission: 'audit.view', icon: icon(FileText) },
      ],
    },
    {
      title: 'Organisation',
      items: [
        { label: 'Branches', path: '/branches', permission: 'branch.view', icon: icon(Building2) },
        { label: 'Team chat', path: '/announcements', icon: icon(MessageSquare) },
        { label: 'Settings', path: '/settings', icon: icon(Sliders) },
      ],
    },
  ];

  const navSections = (isEmployee ? employeeSections : managerSections)
    .map(section => ({ ...section, items: section.items.filter(item => !item.permission || can(item.permission)) }))
    .filter(section => section.items.length > 0);

  const isActive = (path: string) => location.pathname === path || location.pathname.startsWith(`${path}/`);
  const attentionCount = (key?: AttentionKey) => (key ? attention[key] : 0);

  const orgName = access?.organisation.name || 'SimpleHours';
  const userEmail = access?.user.email || '';
  const userName = access?.user.full_name || userEmail.split('@')[0];
  const roleLabel = access ? ROLE_LABEL[access.role] : '';
  const canSwitchOrganisation = organisations.length > 1;

  // Phones: the daily tasks in a bottom bar, plus "More" for everything else.
  const bottomItems: NavItem[] = (navSections[0]?.items ?? []).filter(i => i.path !== '/my/history');

  /** Organisation, branch and role — "where am I". Shared by the sidebar and the phone menu. */
  const workspace = (
    <div data-tour="workspace" className="rounded-xl bg-white/5 border border-white/10 p-3 space-y-2 text-xs">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-wide text-[var(--sidebar-text)]">Organisation</div>
          <div className="font-semibold text-white truncate" title={orgName}>{orgName}</div>
        </div>
        {canSwitchOrganisation && (
          <button type="button" onClick={() => { setMobileMenuOpen(false); setShowOrgSwitchModal(true); }} className="shrink-0 px-2 py-1.5 rounded-md text-[11px] font-semibold text-[#aab8ff] hover:bg-white/10">
            Switch
          </button>
        )}
      </div>
      {activeBranch && (
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-wide text-[var(--sidebar-text)] flex items-center gap-0.5">
              Branch
              <HelpTip label="Branch" onDark>
                {isOwner
                  ? 'You can work in every branch. Pages show the branch chosen here; switch to see another.'
                  : 'You only have access to the branches assigned to you. Pages show the branch chosen here.'}
              </HelpTip>
            </div>
            <div className="font-semibold text-white truncate flex items-center gap-1.5" title={activeBranch.name}>
              <MapPin className="w-3 h-3 text-emerald-400 shrink-0" aria-hidden="true" />
              {activeBranch.name}
            </div>
          </div>
          {canSwitchBranch && (
            <button type="button" onClick={() => { setMobileMenuOpen(false); setShowBranchSwitchModal(true); }} className="shrink-0 px-2 py-1.5 rounded-md text-[11px] font-semibold text-[#aab8ff] hover:bg-white/10">
              Switch
            </button>
          )}
        </div>
      )}
      <div>
        <div className="text-[10px] uppercase tracking-wide text-[var(--sidebar-text)]">Your role</div>
        <div className="font-semibold text-white">{roleLabel}</div>
      </div>
    </div>
  );

  const navLinks = (open: boolean, onNavigate?: () => void) => navSections.map((section, sIdx) => (
    <div key={section.title} className="space-y-0.5" data-tour={section.tour}>
      {open ? (
        <h2 className="px-3 pb-1 pt-1 text-[10px] font-bold uppercase tracking-wider text-[var(--sidebar-text)]">{section.title}</h2>
      ) : (
        sIdx > 0 && <div className="my-2 border-t border-white/10 mx-2" aria-hidden="true" />
      )}
      {section.items.map(item => {
        const active = isActive(item.path);
        const count = attentionCount(item.attention);
        return (
          <Link
            key={item.path}
            to={item.path}
            onClick={onNavigate}
            aria-current={active ? 'page' : undefined}
            aria-label={!open ? `${item.label}${count ? `, ${count} waiting` : ''}` : undefined}
            title={!open ? item.label : undefined}
            className={`w-full flex items-center gap-3 min-h-10 px-3 py-2 rounded-lg text-sm font-medium transition-colors relative text-left ${
              active ? 'bg-[var(--sidebar-active-bg)] text-white font-semibold' : 'text-[var(--sidebar-text)] hover:text-white hover:bg-white/5'
            } ${!open ? 'justify-center px-0' : ''}`}
          >
            {active && <span className="absolute left-0 top-2 bottom-2 w-1 rounded-r bg-[var(--primary)]" aria-hidden="true" />}
            <span className="shrink-0 relative">
              {item.icon}
              {!open && count > 0 && <span className="absolute -top-1 -right-1.5 w-2 h-2 rounded-full bg-[var(--warn)]" aria-hidden="true" />}
            </span>
            {open && <span className="truncate">{item.label}</span>}
            {open && <AttentionBadge count={count} label={item.label} />}
          </Link>
        );
      })}
    </div>
  ));

  return (
    <div className="min-h-screen flex bg-[var(--bg)] text-[var(--text)]">
      <a
        href="#main"
        onClick={e => { e.preventDefault(); skipToContent(); }}
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[70] focus:px-4 focus:py-2 focus:rounded-lg focus:bg-[var(--primary)] focus:text-white"
      >
        Skip to main content
      </a>

      {/* Desktop spacer keeps the content steady while the sidebar opens over it on hover */}
      <div className={`hidden md:block shrink-0 transition-[width] duration-200 ${isPinned && !isRoster ? 'w-64' : 'w-16'}`} />

      {/* Desktop sidebar */}
      <aside
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onFocus={() => setIsHovered(true)}
        onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsHovered(false); }}
        className={`hidden md:flex flex-col fixed inset-y-0 left-0 z-30 bg-[var(--sidebar-bg)] text-[var(--sidebar-text)] border-r border-[var(--sidebar-border)] shadow-xl transition-[width] duration-200 ${isSidebarOpen ? 'w-64' : 'w-16'}`}
      >
        <div className="h-14 px-3 border-b border-[var(--sidebar-border)] flex items-center justify-between shrink-0">
          <Link to={homePath} className="flex items-center gap-2.5 min-w-0 rounded-lg" aria-label="SimpleHours home">
            <div className="w-8 h-8 rounded-lg bg-[var(--primary)] text-white flex items-center justify-center shrink-0">
              <Clock className="w-4 h-4" aria-hidden="true" />
            </div>
            {isSidebarOpen && <span className="font-bold text-sm text-white truncate">SimpleHours</span>}
          </Link>
          {isSidebarOpen && !isRoster && (
            <button
              type="button"
              onClick={togglePinned}
              className="p-2 rounded-lg text-[var(--sidebar-text)] hover:text-white hover:bg-white/10 shrink-0"
              aria-label={isPinned ? 'Fold the menu to icons' : 'Keep the menu open'}
              title={isPinned ? 'Fold the menu to icons' : 'Keep the menu open'}
            >
              {isPinned ? <PinOff className="w-4 h-4" aria-hidden="true" /> : <Pin className="w-4 h-4" aria-hidden="true" />}
            </button>
          )}
        </div>

        {isSidebarOpen && <div className="px-3 pt-3 shrink-0">{workspace}</div>}

        <nav aria-label="Main" className="flex-1 px-2.5 py-3 space-y-4 overflow-y-auto">
          {navLinks(isSidebarOpen)}
        </nav>

        <div className="p-2.5 border-t border-[var(--sidebar-border)] space-y-0.5 shrink-0">
          <button
            type="button"
            onClick={openHelp}
            className={`w-full flex items-center gap-3 min-h-10 px-3 rounded-lg text-sm font-medium text-[var(--sidebar-text)] hover:text-white hover:bg-white/5 ${!isSidebarOpen ? 'justify-center px-0' : ''}`}
            aria-label={!isSidebarOpen ? 'Help' : undefined}
          >
            <HelpCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
            {isSidebarOpen && <span>Help</span>}
          </button>
          {isSidebarOpen ? (
            <div className="flex items-center justify-between gap-2 px-3 pt-2">
              <div className="min-w-0" title={userEmail}>
                <div className="text-xs font-semibold text-white truncate">{userName}</div>
                <div className="text-[11px] text-[var(--sidebar-text)] truncate">{userEmail}</div>
              </div>
              <div className="flex items-center shrink-0">
                <button type="button" onClick={toggleTheme} className="p-2 rounded-lg hover:bg-white/10 text-[var(--sidebar-text)] hover:text-white" aria-label={theme === 'dark' ? 'Use light theme' : 'Use dark theme'}>
                  {theme === 'dark' ? <Sun className="w-4 h-4" aria-hidden="true" /> : <Moon className="w-4 h-4" aria-hidden="true" />}
                </button>
                <button type="button" onClick={handleSignOut} className="p-2 rounded-lg hover:bg-rose-500/20 text-rose-300 hover:text-rose-200" aria-label="Sign out" title="Sign out">
                  <LogOut className="w-4 h-4" aria-hidden="true" />
                </button>
              </div>
            </div>
          ) : (
            <button type="button" onClick={handleSignOut} className="w-full flex justify-center min-h-10 items-center rounded-lg hover:bg-rose-500/20 text-rose-300" aria-label="Sign out">
              <LogOut className="w-4 h-4" aria-hidden="true" />
            </button>
          )}
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        {/* Phone top bar: where you are, and the full menu */}
        <header className="md:hidden border-b border-[var(--border)] bg-[var(--panel)] px-2 h-14 flex items-center justify-between gap-2 sticky top-0 z-40">
          <button type="button" onClick={() => setMobileMenuOpen(true)} className="p-2.5 rounded-lg text-[var(--text)] hover:bg-[var(--panel-subtle)]" aria-label="Open menu">
            <Menu className="w-5 h-5" aria-hidden="true" />
          </button>
          <div className="min-w-0 flex-1 text-center">
            <div className="text-sm font-bold truncate">{orgName}</div>
            {activeBranch && <div className="text-[11px] text-[var(--muted)] truncate">{activeBranch.name}</div>}
          </div>
          {activeBranch && canSwitchBranch ? (
            <button
              type="button"
              onClick={() => setShowBranchSwitchModal(true)}
              className="px-2.5 h-10 rounded-lg text-xs font-semibold text-[var(--primary-text)] hover:bg-[var(--panel-subtle)]"
              aria-label={`Switch branch. Current branch: ${activeBranch.name}`}
            >
              Switch
            </button>
          ) : <span className="w-10" aria-hidden="true" />}
        </header>

        {/* Phone menu */}
        {mobileMenuOpen && (
          <div className="md:hidden fixed inset-0 z-50 flex" role="dialog" aria-modal="true" aria-label="Menu">
            <div className="fixed inset-0 bg-black/60" onClick={() => setMobileMenuOpen(false)} aria-hidden="true" />
            <div className="relative w-80 max-w-[85%] bg-[var(--sidebar-bg)] text-[var(--sidebar-text)] flex flex-col h-full z-10 shadow-2xl">
              <div className="px-4 h-14 border-b border-[var(--sidebar-border)] flex items-center justify-between">
                <span className="font-bold text-sm text-white">Menu</span>
                <button type="button" onClick={() => setMobileMenuOpen(false)} className="p-2.5 rounded-lg text-[var(--sidebar-text)] hover:text-white" aria-label="Close menu">
                  <X className="w-5 h-5" aria-hidden="true" />
                </button>
              </div>
              <div className="p-3">{workspace}</div>
              <nav aria-label="Main" className="flex-1 px-3 pb-3 space-y-4 overflow-y-auto">
                {navLinks(true, () => setMobileMenuOpen(false))}
              </nav>
              <div className="p-3 border-t border-[var(--sidebar-border)] space-y-1">
                <button type="button" onClick={() => { setMobileMenuOpen(false); openHelp(); }} className="w-full flex items-center gap-3 min-h-11 px-3 rounded-lg text-sm text-[var(--sidebar-text)] hover:text-white hover:bg-white/5">
                  <HelpCircle className="w-4 h-4" aria-hidden="true" /> Help
                </button>
                <button type="button" onClick={toggleTheme} className="w-full flex items-center gap-3 min-h-11 px-3 rounded-lg text-sm text-[var(--sidebar-text)] hover:text-white hover:bg-white/5">
                  {theme === 'dark' ? <Sun className="w-4 h-4" aria-hidden="true" /> : <Moon className="w-4 h-4" aria-hidden="true" />}
                  {theme === 'dark' ? 'Light theme' : 'Dark theme'}
                </button>
                <div className="px-3 pt-2 text-xs">
                  <div className="font-semibold text-white truncate">{userName}</div>
                  <div className="text-[11px] truncate">{userEmail}</div>
                </div>
                <button type="button" onClick={handleSignOut} className="w-full flex items-center gap-3 min-h-11 px-3 rounded-lg text-sm font-semibold text-rose-300 hover:bg-rose-500/10">
                  <LogOut className="w-4 h-4" aria-hidden="true" /> Sign out
                </button>
              </div>
            </div>
          </div>
        )}

        <main
          id="main"
          ref={mainRef}
          tabIndex={-1}
          className={`flex-1 w-full outline-none pb-24 md:pb-8 ${isRoster ? 'p-2 sm:p-3 lg:p-4' : 'max-w-7xl mx-auto p-4 sm:p-6 lg:p-8'}`}
        >
          <Outlet />
        </main>
      </div>

      {/* Phone bottom bar: daily tasks + More (all targets at least 56px tall) */}
      <nav aria-label="Daily work" className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-[var(--sidebar-bg)] border-t border-[var(--sidebar-border)] flex items-stretch justify-around px-1 pb-[env(safe-area-inset-bottom)]">
        {bottomItems.map(item => {
          const active = isActive(item.path);
          const count = attentionCount(item.attention);
          return (
            <Link
              key={item.path}
              to={item.path}
              aria-current={active ? 'page' : undefined}
              className={`relative flex-1 flex flex-col items-center justify-center min-h-14 px-1 text-[11px] font-medium ${active ? 'text-white' : 'text-[var(--sidebar-text)]'}`}
            >
              {active && <span className="absolute top-0 inset-x-4 h-0.5 rounded-b bg-[var(--primary)]" aria-hidden="true" />}
              <span className="relative [&_svg]:w-5 [&_svg]:h-5">
                {item.icon}
                {count > 0 && (
                  <span className="absolute -top-1.5 -right-2.5 min-w-4 h-4 px-1 rounded-full bg-[var(--warn)] text-white text-[10px] font-bold flex items-center justify-center" aria-hidden="true">
                    {count > 99 ? '99+' : count}
                  </span>
                )}
              </span>
              <span className="mt-0.5 truncate max-w-full">{item.label.replace(/^My /, '').replace(/^\w/, c => c.toUpperCase())}</span>
              {count > 0 && <span className="sr-only">, {count} waiting</span>}
            </Link>
          );
        })}
        <button type="button" onClick={() => setMobileMenuOpen(true)} className="flex-1 flex flex-col items-center justify-center min-h-14 px-1 text-[11px] font-medium text-[var(--sidebar-text)]">
          <Menu className="w-5 h-5" aria-hidden="true" />
          <span className="mt-0.5">More</span>
        </button>
      </nav>

      <OrgSwitchModal
        isOpen={showOrgSwitchModal}
        onClose={() => setShowOrgSwitchModal(false)}
        organisations={organisations}
        currentOrgId={access?.organisation.id}
        onSwitch={handleSwitchOrg}
        switching={switching}
      />

      <BranchSwitchModal
        isOpen={showBranchSwitchModal}
        onClose={() => setShowBranchSwitchModal(false)}
        branches={activeBranches}
        currentBranchId={activeBranch?.id ?? null}
        onSwitch={setActiveBranch}
      />

      <SessionTimeoutModal
        isOpen={showWarning}
        remainingSeconds={remainingSeconds}
        isKeepingAlive={isKeepingAlive}
        onStaySignedIn={staySignedIn}
        onLogout={logoutNow}
      />

      <ContextHelpModal isOpen={showHelpModal} onClose={() => setShowHelpModal(false)} />
      <GuidedTour />
    </div>
  );
}
