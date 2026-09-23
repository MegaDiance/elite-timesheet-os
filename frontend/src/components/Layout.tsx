import { useState, useEffect, useRef, type ReactNode } from 'react';
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
  Home,
  CheckSquare,
  Pin,
  PinOff,
  MapPin,
  UserCog,
} from 'lucide-react';
import api from '../services/apiClient';
import { OrgSwitchModal, type OrganisationChoice } from './modals/OrgSwitchModal';
import { BranchSwitchModal } from './modals/BranchSwitchModal';
import { SessionTimeoutModal } from './modals/SessionTimeoutModal';
import { useSessionTimeout } from '../hooks/useSessionTimeout';
import OnboardingTutorial from './OnboardingTutorial';
import ContextHelpModal from './ContextHelpModal';
import HelpChatbot from './HelpChatbot';
import { useToast } from './ui/Toast';
import { ROLE_LABEL, signOut, storeSession, useAccess, type Permission } from '../hooks/useAccess';
import { forgetActiveBranches, useActiveBranch } from '../hooks/useActiveBranch';

interface NavItem {
  label: string;
  path?: string;
  icon: ReactNode;
  permission?: Permission;
  onClick?: () => void;
}

interface NavSection {
  title: string;
  items: NavItem[];
}

export default function Layout() {
  const location = useLocation();
  const toast = useToast();
  const { access, isOwner, can } = useAccess();
  const { activeBranch, branches: activeBranches, canSwitchBranch, setActiveBranch } = useActiveBranch();

  const [theme, setTheme] = useState(localStorage.getItem('theme') || 'light');
  const [organisations, setOrganisations] = useState<OrganisationChoice[]>([]);
  const [switching, setSwitching] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [showOrgSwitchModal, setShowOrgSwitchModal] = useState(false);
  const [showBranchSwitchModal, setShowBranchSwitchModal] = useState(false);
  const [showHelpModal, setShowHelpModal] = useState(false);

  // Sidebar: pinned open on wide screens by default; otherwise expands on hover.
  const [isPinned, setIsPinned] = useState<boolean>(() => {
    const saved = localStorage.getItem('simplehours_sidebar_pinned');
    if (saved !== null) return saved === 'true';
    return window.innerWidth >= 1280;
  });
  const [isHovered, setIsHovered] = useState(false);
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleMouseEnter = () => {
    if (isPinned) return;
    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
    hoverTimeoutRef.current = setTimeout(() => setIsHovered(true), 150);
  };

  const handleMouseLeave = () => {
    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
    setIsHovered(false);
  };

  const isSidebarOpen = isPinned || isHovered;

  // Inactivity timeout & multi-tab session management
  const { showWarning, remainingSeconds, isKeepingAlive, staySignedIn, logoutNow } = useSessionTimeout();

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    const handleOpenHelp = () => setShowHelpModal(true);
    window.addEventListener('open-help-modal', handleOpenHelp);
    return () => window.removeEventListener('open-help-modal', handleOpenHelp);
  }, []);

  // Collapse the sidebar on the roster page to give the fortnight grid more room.
  useEffect(() => {
    if (location.pathname === '/roster') setIsPinned(false);
  }, [location.pathname]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    document.body.classList.toggle('light-mode', theme === 'light');
    localStorage.setItem('theme', theme);
  }, [theme]);

  // Organisations this account can use (an account may be an Owner or Branch Admin in several).
  useEffect(() => {
    let cancelled = false;
    api.get('/auth/organisations')
      .then(res => {
        if (!cancelled && Array.isArray(res.data?.data)) setOrganisations(res.data.data);
      })
      .catch(() => {
        // The switcher is simply hidden when the list cannot be loaded.
      });
    return () => { cancelled = true; };
  }, [access?.organisation.id]);

  const handleSwitchOrg = async (orgId: string) => {
    if (!orgId || orgId === access?.organisation.id || switching) return;
    setSwitching(true);
    try {
      const res = await api.post('/auth/switch-organisation', { organisation_id: orgId });
      const token = res.data?.data?.token;
      if (!token) throw new Error('No session returned');
      storeSession(token);
      window.location.assign('/app');
    } catch (err: any) {
      toast.error(err?.response?.data?.error?.message || 'Could not switch organisation. Please try again.');
      setSwitching(false);
    }
  };

  const handleSignOut = async () => {
    forgetActiveBranches();
    await signOut();
  };

  const toggleTheme = () => setTheme(t => (t === 'light' ? 'dark' : 'light'));

  // ---------------------------------------------------------------------------
  // Navigation — built only from the permissions reported by GET /auth/me.
  // Display only: the API authorises every request itself.
  // ---------------------------------------------------------------------------
  const openHelp = () => setShowHelpModal(true);
  const isEmployee = access?.role === 'EMPLOYEE';
  const canSubmitTimesheets = access?.employee_capabilities?.can_submit_timesheets ?? false;
  const homePath = isEmployee ? '/my/schedule' : '/dashboard';

  const employeeSections: NavSection[] = [
    {
      title: 'Main',
      items: [
        { label: 'Schedule', path: '/my/schedule', icon: <Calendar className="w-4 h-4" /> },
        ...(canSubmitTimesheets ? [{ label: 'Timesheet', path: '/my/timesheet', icon: <CheckSquare className="w-4 h-4" /> }] : []),
        { label: 'History', path: '/my/history', icon: <Clock className="w-4 h-4" /> },
        { label: 'Leave', path: '/my/leave', icon: <CalendarDays className="w-4 h-4" /> },
      ],
    },
    {
      title: 'Account',
      items: [{ label: 'Help & Guide', onClick: openHelp, icon: <HelpCircle className="w-4 h-4" /> }],
    },
  ];

  const sections: NavSection[] = [
    {
      title: 'Main',
      items: [
        { label: 'Dashboard', path: '/dashboard', permission: 'branch.view', icon: <LayoutDashboard className="w-4 h-4" /> },
        { label: 'Roster', path: '/roster', permission: 'rosters.manage', icon: <Calendar className="w-4 h-4" /> },
        { label: 'Timesheets', path: '/timesheets', permission: 'timesheets.manage', icon: <CheckSquare className="w-4 h-4" /> },
        { label: 'Leave Requests', path: '/leave-requests', permission: 'timesheets.manage', icon: <CalendarDays className="w-4 h-4" /> },
        { label: 'Workers', path: '/workers', permission: 'workers.manage', icon: <Users className="w-4 h-4" /> },
        { label: 'Reports', path: '/reports', permission: 'reports.view', icon: <BarChart3 className="w-4 h-4" /> },
      ],
    },
    {
      title: 'Team',
      items: [
        { label: 'Team Chat', path: '/announcements', icon: <MessageSquare className="w-4 h-4" /> },
        { label: 'Branches', path: '/branches', permission: 'branch.view', icon: <Building2 className="w-4 h-4" /> },
      ],
    },
    {
      title: 'Organisation',
      items: [
        { label: 'Branch Admins', path: '/branch-admins', permission: 'branch_admins.manage', icon: <UserCog className="w-4 h-4" /> },
        { label: 'Audit Log', path: '/audit', permission: 'audit.view', icon: <FileText className="w-4 h-4" /> },
      ],
    },
    {
      title: 'Account',
      items: [
        { label: 'Settings', path: '/settings', icon: <Sliders className="w-4 h-4" /> },
        { label: 'Help & Guide', onClick: openHelp, icon: <HelpCircle className="w-4 h-4" /> },
      ],
    },
  ];
  const navSections = (isEmployee ? employeeSections : sections)
    .map(section => ({ ...section, items: section.items.filter(item => !item.permission || can(item.permission)) }))
    .filter(section => section.items.length > 0);

  const isActive = (path?: string) =>
    Boolean(path) && (location.pathname === path || location.pathname.startsWith(`${path}/`));

  // ---------------------------------------------------------------------------
  // Who is signed in
  // ---------------------------------------------------------------------------
  const orgName = access?.organisation.name || 'SimpleHours';
  const userEmail = access?.user.email || '';
  const userName = access?.user.full_name || userEmail.split('@')[0];
  const branches = access?.branches ?? [];
  const roleSummary = !access
    ? ''
    : isOwner
      ? `${ROLE_LABEL[access.role]} · every branch`
      : `${ROLE_LABEL[access.role]}${branches.length > 1 ? ` · ${branches.length} branches` : ''}`;
  const branchList = branches.map(b => b.name).join(', ');
  const canSwitchOrganisation = organisations.length > 1;

  const isFluid = location.pathname === '/roster';

  const bottomItems: Array<{ label: string; path: string; permission?: Permission; icon: ReactNode }> = isEmployee
    ? [
        { label: 'Schedule', path: '/my/schedule', icon: <Calendar className="w-5 h-5 mb-0.5" /> },
        ...(canSubmitTimesheets ? [{ label: 'Timesheet', path: '/my/timesheet', icon: <CheckSquare className="w-5 h-5 mb-0.5" /> }] : []),
        { label: 'History', path: '/my/history', icon: <Clock className="w-5 h-5 mb-0.5" /> },
      ]
    : [
        { label: 'Home', path: '/dashboard', permission: 'branch.view', icon: <Home className="w-5 h-5 mb-0.5" /> },
        { label: 'Roster', path: '/roster', permission: 'rosters.manage', icon: <Calendar className="w-5 h-5 mb-0.5" /> },
        { label: 'Timesheets', path: '/timesheets', permission: 'timesheets.manage', icon: <Clock className="w-5 h-5 mb-0.5" /> },
        { label: 'Reports', path: '/reports', permission: 'reports.view', icon: <BarChart3 className="w-5 h-5 mb-0.5" /> },
      ];

  return (
    <div className="min-h-screen flex bg-[var(--bg)] text-[var(--text)]">
      {/* Desktop spacer keeps the content steady while the sidebar expands on hover */}
      <div className={`hidden md:block shrink-0 transition-[width] duration-200 ease-out ${isPinned ? 'w-60' : 'w-16'}`} />

      {/* Desktop sidebar */}
      <aside
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        className={`hidden md:flex flex-col fixed inset-y-0 left-0 z-30 bg-[var(--sidebar-bg)] text-[var(--sidebar-text)] border-r border-[var(--sidebar-border)] shadow-xl transition-[width] duration-200 ease-out select-none ${
          isSidebarOpen ? 'w-60' : 'w-16'
        }`}
      >
        {/* Brand */}
        <div className="h-16 px-4 border-b border-[var(--sidebar-border)] flex items-center justify-between shrink-0">
          <Link to={homePath} className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-[var(--primary)] text-white flex items-center justify-center font-black text-sm shrink-0 shadow-md shadow-indigo-500/20">
              <Clock className="w-4 h-4" />
            </div>
            {isSidebarOpen && (
              <div className="min-w-0 animate-in fade-in duration-150">
                <div className="font-bold text-sm tracking-tight text-white truncate flex items-center gap-1.5">
                  <span>SimpleHours</span>
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                </div>
                <div className="text-[10px] text-[var(--sidebar-text)] font-medium truncate">Rosters & Timesheets</div>
              </div>
            )}
          </Link>

          {isSidebarOpen && (
            <button
              onClick={() => {
                const next = !isPinned;
                setIsPinned(next);
                localStorage.setItem('simplehours_sidebar_pinned', String(next));
              }}
              className="p-1.5 rounded-lg text-[var(--sidebar-text)] hover:text-white hover:bg-white/10 transition-colors shrink-0 animate-in fade-in"
              title={isPinned ? 'Unpin sidebar (expand on hover)' : 'Pin sidebar open'}
            >
              {isPinned ? <PinOff className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />}
            </button>
          )}
        </div>

        {/* Organisation, branch and role summary */}
        {isSidebarOpen && (
          <div className="px-3 pt-3 pb-1 shrink-0 animate-in fade-in duration-150 space-y-1.5">
            <div className="px-3 py-2 rounded-xl bg-white/5 border border-white/8 flex items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-2 min-w-0">
                <Building2 className="w-3.5 h-3.5 text-[var(--primary)] shrink-0" />
                <span className="font-semibold text-white truncate" title={orgName}>{orgName}</span>
              </div>
              {canSwitchOrganisation && (
                <button
                  onClick={() => setShowOrgSwitchModal(true)}
                  className="text-[10px] text-[var(--primary)] hover:underline shrink-0 font-medium"
                  title="Switch organisation"
                >
                  Switch
                </button>
              )}
            </div>
            {activeBranch && (
              <div className="px-3 py-2 rounded-xl bg-white/5 border border-white/8 flex items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-2 min-w-0">
                  <MapPin className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <span className="font-semibold text-white truncate" title={activeBranch.name}>{activeBranch.name}</span>
                </div>
                {canSwitchBranch && (
                  <button
                    onClick={() => setShowBranchSwitchModal(true)}
                    className="text-[10px] text-[var(--primary)] hover:underline shrink-0 font-medium"
                    title="Switch branch"
                  >
                    Switch
                  </button>
                )}
              </div>
            )}
            <div
              className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/5 flex items-center gap-1.5 min-w-0"
              title={isOwner ? 'Access to every branch' : branchList}
            >
              <UserCog className="w-3 h-3 shrink-0 text-[var(--sidebar-text)]" />
              <span className="truncate text-white font-medium text-[11px]">{roleSummary}</span>
            </div>
          </div>
        )}

        {/* Navigation */}
        <nav className="flex-1 px-2.5 py-3 space-y-4 overflow-y-auto">
          {navSections.map((section, sIdx) => (
            <div key={section.title} className="space-y-1">
              {isSidebarOpen ? (
                <div className="px-3 pb-1 pt-1 text-[10px] font-bold uppercase tracking-wider text-[var(--sidebar-text)] opacity-50 animate-in fade-in">
                  {section.title}
                </div>
              ) : (
                sIdx > 0 && <div className="my-2 border-t border-white/10 mx-2" />
              )}

              {section.items.map(item => {
                const active = isActive(item.path);
                const className = `w-full flex items-center gap-3 px-3 py-2 rounded-xl text-xs font-medium transition-all group relative text-left ${
                  active
                    ? 'bg-[var(--sidebar-active-bg)] text-[var(--sidebar-active-text)] font-semibold shadow-xs'
                    : 'text-[var(--sidebar-text)] hover:text-white hover:bg-white/5'
                } ${!isSidebarOpen ? 'justify-center px-0' : ''}`;

                if (item.path) {
                  return (
                    <Link key={item.path} to={item.path} title={!isSidebarOpen ? item.label : undefined} className={className}>
                      {active && <span className="absolute left-0 top-2 bottom-2 w-1 rounded-r bg-[var(--primary)]" />}
                      <span className={`shrink-0 ${active ? 'text-[var(--primary)]' : 'group-hover:text-white'}`}>{item.icon}</span>
                      {isSidebarOpen && <span className="truncate">{item.label}</span>}
                    </Link>
                  );
                }

                return (
                  <button key={item.label} type="button" onClick={item.onClick} title={!isSidebarOpen ? item.label : undefined} className={className}>
                    <span className="shrink-0 group-hover:text-white">{item.icon}</span>
                    {isSidebarOpen && <span className="truncate">{item.label}</span>}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        {/* Account footer */}
        <div className="p-3 border-t border-[var(--sidebar-border)] space-y-2 shrink-0">
          {isSidebarOpen ? (
            <div className="p-2.5 rounded-xl bg-white/5 flex items-center justify-between text-xs animate-in fade-in duration-150">
              <div className="min-w-0 pr-2" title={userEmail}>
                <div className="font-semibold text-white truncate text-xs">{userName}</div>
                <div className="text-[10px] text-[var(--sidebar-text)] truncate mt-0.5">{userEmail}</div>
                <div className="text-[10px] text-[var(--sidebar-text)] flex items-center gap-1.5 mt-0.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-[var(--success)] shrink-0" />
                  <span className="truncate">{access ? ROLE_LABEL[access.role] : ''}</span>
                </div>
              </div>

              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={toggleTheme}
                  className="p-1.5 rounded-lg hover:bg-white/10 text-[var(--sidebar-text)] hover:text-white transition-colors"
                  title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
                >
                  {theme === 'dark' ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
                </button>
                <button
                  onClick={handleSignOut}
                  className="p-1.5 rounded-lg hover:bg-rose-500/20 text-rose-400 hover:text-rose-300 transition-colors"
                  title="Sign out"
                >
                  <LogOut className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2">
              <button
                onClick={toggleTheme}
                className="p-2 rounded-lg hover:bg-white/10 text-[var(--sidebar-text)] hover:text-white"
                title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
              >
                {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              </button>
              <button onClick={handleSignOut} className="p-2 rounded-lg hover:bg-rose-500/20 text-rose-400" title="Sign out">
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      </aside>

      {/* Main content + mobile top bar */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="md:hidden border-b border-[var(--border)] bg-[var(--panel)] px-4 py-3 flex items-center justify-between sticky top-0 z-40">
          <div className="flex items-center gap-2 min-w-0">
            <button
              onClick={() => setMobileMenuOpen(true)}
              className="p-1.5 rounded-lg text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--panel-subtle)]"
              aria-label="Open menu"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2 font-bold text-sm text-[var(--text)]">
              <div className="w-6 h-6 rounded bg-[var(--primary)] flex items-center justify-center text-white text-xs font-bold">SH</div>
              <span>SimpleHours</span>
            </div>
          </div>

          <div className="flex items-center gap-2 min-w-0">
            {activeBranch && canSwitchBranch ? (
              <button
                onClick={() => setShowBranchSwitchModal(true)}
                className="text-xs font-medium text-[var(--text)] truncate max-w-[140px] flex items-center gap-1 hover:text-[var(--primary)]"
                title="Switch branch"
              >
                <MapPin className="w-3 h-3 shrink-0 text-emerald-500" />
                {activeBranch.name}
              </button>
            ) : (
              <span className="text-xs font-medium text-[var(--muted)] truncate max-w-[120px]">{activeBranch?.name || orgName}</span>
            )}
            <button onClick={handleSignOut} className="p-1.5 rounded text-rose-400 hover:bg-rose-500/10" title="Sign out">
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </header>

        {/* Mobile drawer */}
        {mobileMenuOpen && (
          <div className="md:hidden fixed inset-0 z-50 flex">
            <div className="fixed inset-0 bg-black/60 backdrop-blur-xs" onClick={() => setMobileMenuOpen(false)} />
            <div className="relative w-72 max-w-[80%] bg-[var(--sidebar-bg)] text-[var(--sidebar-text)] flex flex-col h-full z-10 shadow-2xl">
              <div className="p-4 border-b border-[var(--sidebar-border)] flex items-center justify-between">
                <div className="flex items-center gap-2 font-bold text-sm text-white">
                  <div className="w-7 h-7 rounded-lg bg-[var(--primary)] flex items-center justify-center text-white">
                    <Clock className="w-4 h-4" />
                  </div>
                  <span>SimpleHours</span>
                </div>
                <button onClick={() => setMobileMenuOpen(false)} className="p-1 rounded text-[var(--sidebar-text)] hover:text-white" aria-label="Close menu">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-3 border-b border-[var(--sidebar-border)] bg-white/5 space-y-1.5">
                <div className="text-[10px] uppercase text-[var(--sidebar-text)] font-semibold">Organisation</div>
                <div className="flex items-center justify-between gap-2">
                  <div className="font-bold text-sm text-white truncate">{orgName}</div>
                  {canSwitchOrganisation && (
                    <button
                      onClick={() => {
                        setMobileMenuOpen(false);
                        setShowOrgSwitchModal(true);
                      }}
                      className="text-[11px] text-[var(--primary)] hover:underline shrink-0 font-medium"
                    >
                      Switch
                    </button>
                  )}
                </div>
                {activeBranch && (
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <MapPin className="w-3 h-3 shrink-0 text-emerald-400" />
                      <span className="truncate text-[11px] text-white font-medium">{activeBranch.name}</span>
                    </div>
                    {canSwitchBranch && (
                      <button
                        onClick={() => {
                          setMobileMenuOpen(false);
                          setShowBranchSwitchModal(true);
                        }}
                        className="text-[11px] text-[var(--primary)] hover:underline shrink-0 font-medium"
                      >
                        Switch
                      </button>
                    )}
                  </div>
                )}
                <div className="flex items-center gap-1.5 min-w-0" title={isOwner ? 'Access to every branch' : branchList}>
                  <UserCog className="w-3 h-3 shrink-0 text-[var(--sidebar-text)]" />
                  <span className="truncate text-[11px] text-white font-medium">{roleSummary}</span>
                </div>
              </div>

              <nav className="flex-1 p-3 space-y-4 overflow-y-auto">
                {navSections.map(section => (
                  <div key={section.title} className="space-y-1">
                    <div className="px-3 pb-1 text-[10px] font-bold uppercase tracking-wider text-[var(--sidebar-text)] opacity-50">{section.title}</div>
                    {section.items.map(item => {
                      const active = isActive(item.path);
                      const className = `w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-colors text-left ${
                        active ? 'bg-[var(--sidebar-active-bg)] text-white font-semibold' : 'text-[var(--sidebar-text)] hover:text-white hover:bg-white/5'
                      }`;

                      if (item.path) {
                        return (
                          <Link key={item.path} to={item.path} onClick={() => setMobileMenuOpen(false)} className={className}>
                            <span className={active ? 'text-[var(--primary)]' : ''}>{item.icon}</span>
                            <span>{item.label}</span>
                          </Link>
                        );
                      }

                      return (
                        <button
                          key={item.label}
                          type="button"
                          onClick={() => {
                            setMobileMenuOpen(false);
                            item.onClick?.();
                          }}
                          className={className}
                        >
                          <span>{item.icon}</span>
                          <span>{item.label}</span>
                        </button>
                      );
                    })}
                  </div>
                ))}
              </nav>

              <div className="p-4 border-t border-[var(--sidebar-border)] space-y-3">
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-white truncate">{userName}</div>
                  <div className="text-[11px] text-[var(--sidebar-text)] truncate">{userEmail}</div>
                </div>
                <div className="flex items-center justify-between">
                  <button onClick={toggleTheme} className="flex items-center gap-2 text-xs text-[var(--sidebar-text)] hover:text-white">
                    {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
                    <span>Theme</span>
                  </button>
                  <button onClick={handleSignOut} className="flex items-center gap-1.5 text-xs text-rose-400 font-medium">
                    <LogOut className="w-4 h-4" />
                    <span>Sign out</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        <main className={`flex-1 w-full pb-24 md:pb-8 ${isFluid ? 'p-2 sm:p-3 lg:p-4' : 'max-w-7xl mx-auto p-4 sm:p-6 lg:p-8'}`}>
          <Outlet />
        </main>
      </div>

      {/* Mobile bottom navigation (48px+ tap targets) */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-[var(--sidebar-bg)] border-t border-[var(--sidebar-border)] flex items-center justify-around px-2 py-1 shadow-2xl select-none">
        {bottomItems.filter(item => !item.permission || can(item.permission)).map(item => (
          <Link
            key={item.path}
            to={item.path}
            className={`flex flex-col items-center justify-center min-w-[54px] min-h-[48px] py-1 px-2 rounded-xl text-[10px] font-medium transition-colors ${
              isActive(item.path) ? 'text-[var(--primary)] font-bold bg-white/5' : 'text-[var(--sidebar-text)] hover:text-white'
            }`}
          >
            {item.icon}
            <span>{item.label}</span>
          </Link>
        ))}
        <button
          type="button"
          onClick={openHelp}
          className="flex flex-col items-center justify-center min-w-[54px] min-h-[48px] py-1 px-2 rounded-xl text-[10px] font-medium text-[var(--sidebar-text)] hover:text-white transition-colors"
        >
          <HelpCircle className="w-5 h-5 mb-0.5" />
          <span>Help</span>
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

      <OnboardingTutorial />

      <ContextHelpModal
        isOpen={showHelpModal}
        onClose={() => setShowHelpModal(false)}
        onStartTutorial={() => {
          setShowHelpModal(false);
          // The same event the tutorial, the dashboard and the help assistant use.
          window.dispatchEvent(new Event('start-simplehours-tutorial'));
        }}
      />

      <HelpChatbot />
    </div>
  );
}
