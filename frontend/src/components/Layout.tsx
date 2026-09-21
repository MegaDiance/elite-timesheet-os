import { useState, useEffect, useRef } from 'react';
import { Outlet, useNavigate, useLocation, Link } from 'react-router-dom';
import { jwtDecode } from 'jwt-decode';
import { 
  Clock, 
  Calendar, 
  Users, 
  Plane, 
  FileText, 
  ShieldCheck, 
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
  History,
  Pin,
  PinOff,
  MapPin
} from 'lucide-react';
import api from '../services/apiClient';
import { OrgSwitchModal, type OrganisationMembership } from './modals/OrgSwitchModal';
import { SessionTimeoutModal } from './modals/SessionTimeoutModal';
import { useSessionTimeout } from '../hooks/useSessionTimeout';
import OnboardingTutorial from './OnboardingTutorial';
import ContextHelpModal from './ContextHelpModal';
import { usePermissions } from '../hooks/usePermissions';
import HelpChatbot from './HelpChatbot';

interface DecodedToken {
  id: string;
  email: string;
  organisation_id?: string;
  role?: string;
  location_id?: string;
}

interface NavItem {
  label: string;
  path?: string;
  icon: React.ReactNode;
  badge?: string;
  onClick?: () => void;
}

const BRANCH_ROLE_LABELS: Record<string, string> = {
  BRANCH_ADMIN: 'Branch Admin',
  BRANCH_MANAGER: 'Branch Manager',
  EMPLOYEE: 'Employee',
};

interface NavSection {
  title?: string;
  items: NavItem[];
}

export default function Layout() {
  const navigate = useNavigate();
  const location = useLocation();
  const {
    isLegacy,
    activeBranchId,
    activeBranchRole,
    activeBranchMemberships,
    hasPermission,
    hasPermissionInAnyBranch,
  } = usePermissions();

  const [user, setUser] = useState<DecodedToken | null>(null);
  const [theme, setTheme] = useState(localStorage.getItem('theme') || 'light');
  const [organisations, setOrganisations] = useState<OrganisationMembership[]>([]);
  const [currentOrgName, setCurrentOrgName] = useState<string>('My Organisation');
  const [switching, setSwitching] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  // Persistent pinned state (defaults to true, unless on roster or unpinned)
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
    hoverTimeoutRef.current = setTimeout(() => {
      setIsHovered(true);
    }, 150); // 150ms delay to prevent accidental trigger
  };

  const handleMouseLeave = () => {
    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
    setIsHovered(false);
  };

  const isSidebarOpen = isPinned || isHovered;

  // Modals state
  const [showOrgSwitchModal, setShowOrgSwitchModal] = useState(false);
  const [showHelpModal, setShowHelpModal] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Multi-location state
  const [userLocations, setUserLocations] = useState<any[]>([]);
  const [activeLocationName, setActiveLocationName] = useState<string>('');

  // Inactivity timeout & multi-tab session management
  const {
    showWarning,
    remainingSeconds,
    isKeepingAlive,
    staySignedIn,
    logoutNow
  } = useSessionTimeout();

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    const handleOpenHelp = () => setShowHelpModal(true);
    window.addEventListener('open-help-modal', handleOpenHelp);
    return () => window.removeEventListener('open-help-modal', handleOpenHelp);
  }, []);

  // Auto-collapse sidebar on roster page for maximum scheduling workspace
  useEffect(() => {
    if (location.pathname === '/roster') {
      setIsPinned(false);
    }
  }, [location.pathname]);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) {
      try {
        const decoded = jwtDecode<DecodedToken>(token);
        setUser(decoded);
        fetchOrganisations();
        fetchUserLocations();
      } catch {
        handleLogout();
      }
    }
  }, []);

  // Sync theme
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    if (theme === 'light') {
      document.body.classList.add('light-mode');
    } else {
      document.body.classList.remove('light-mode');
    }
    localStorage.setItem('theme', theme);
  }, [theme]);

  const fetchOrganisations = async () => {
    try {
      const res = await api.get('/auth/organisations');
      if (res.data?.data) {
        const orgsList: OrganisationMembership[] = res.data.data;
        setOrganisations(orgsList);

        const currentToken = localStorage.getItem('token');
        if (currentToken) {
          const decoded = jwtDecode<DecodedToken>(currentToken);
          const active = orgsList.find(o => o.id === decoded.organisation_id);
          if (active) {
            setCurrentOrgName(active.name);
            localStorage.setItem('last_org_name', active.name);
          }
        }
      }
    } catch (err) {
      console.warn('Failed to fetch organisations', err);
    }
  };

  const fetchUserLocations = async () => {
    try {
      const res = await api.get('/locations');
      if (res.data?.success && Array.isArray(res.data.data)) {
        setUserLocations(res.data.data);
        const currentToken = localStorage.getItem('token');
        if (currentToken) {
          try {
            const decoded = jwtDecode<any>(currentToken);
            const activeLoc = res.data.data.find((l: any) => l.id === decoded.location_id);
            if (activeLoc) {
              setActiveLocationName(activeLoc.name);
            }
          } catch {}
        }
      }
    } catch (err) {
      console.warn('Failed to fetch user locations', err);
    }
  };

  const handleSwitchLocation = async (locId: string) => {
    try {
      const res = await api.post('/auth/select-location', { location_id: locId });
      if (res.data?.success && res.data?.data?.token) {
        localStorage.setItem('token', res.data.data.token);
        window.dispatchEvent(new Event('auth-change'));
        window.location.reload();
      }
    } catch {
      setToastMessage('Failed to switch location context');
      setTimeout(() => setToastMessage(null), 3500);
    }
  };

  const handleSwitchOrg = async (orgId: string) => {
    if (!orgId || orgId === user?.organisation_id || switching) return;
    try {
      setSwitching(true);
      const res = await api.post('/auth/switch-organisation', { organisation_id: orgId });
      if (res.data?.data?.token) {
        localStorage.setItem('token', res.data.data.token);
        window.dispatchEvent(new Event('auth-change'));
        window.location.reload();
      }
    } catch {
      setToastMessage('Failed to switch organisation');
      setTimeout(() => setToastMessage(null), 3500);
    } finally {
      setSwitching(false);
    }
  };

  const handleLogout = () => {
    const lastSlug = localStorage.getItem('last_org_slug');
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    window.dispatchEvent(new Event('auth-change'));
    if (lastSlug) {
      navigate(`/login/${lastSlug}`);
    } else {
      navigate('/portal-access');
    }
  };

  const toggleTheme = () => {
    setTheme(t => t === 'light' ? 'dark' : 'light');
  };

  const role = user?.role || 'Employee';
  const isPlatformAdmin = role === 'Platform Admin';

  // ---------------------------------------------------------------------------
  // Permission-driven navigation visibility.
  //
  // Branch-scoped capabilities (timesheets, roster, leave) are checked with
  // hasPermissionInAnyBranch so a manager of a *different* branch can still
  // reach the page and switch across. Organisation roles on their own grant
  // none of these — that is enforced by the backend security context, which
  // simply never lists them without an active branch membership.
  // ---------------------------------------------------------------------------
  const canViewTimesheets = hasPermissionInAnyBranch('TIMESHEET_VIEW');
  const canViewRoster = hasPermissionInAnyBranch('ROSTER_VIEW');
  const canViewLeave = hasPermissionInAnyBranch('LEAVE_VIEW');
  const canViewReports = hasPermissionInAnyBranch('REPORT_VIEW');
  const canViewBranches =
    hasPermission('ORGANISATION_MANAGE_BRANCHES') || hasPermissionInAnyBranch('BRANCH_VIEW');
  const canViewStaff =
    hasPermissionInAnyBranch('BRANCH_MANAGE_STAFF') || hasPermission('ORGANISATION_MANAGE_USERS');
  const canViewOrgSettings = hasPermission('ORGANISATION_VIEW');
  const canViewAudit = hasPermission('ORGANISATION_UPDATE') || hasPermission('ORGANISATION_MANAGE_BRANCHES');

  // Anyone holding at least one management capability gets the management shell;
  // everyone else keeps the employee self-service navigation unchanged.
  const isManagementUser =
    canViewTimesheets || canViewRoster || canViewLeave || canViewReports ||
    canViewBranches || canViewStaff || canViewOrgSettings;

  const isActive = (path?: string) => {
    if (!path) return false;
    if (path === '/dashboard') return location.pathname === '/dashboard';
    if (path === '/roster') return location.pathname === '/roster';
    if (path === '/portal' || path === '/timesheet') return location.pathname === '/portal' || location.pathname === '/timesheet';
    if (path === '/timesheets') return location.pathname === '/timesheets';
    if (path === '/schedule') return location.pathname === '/schedule';
    if (path === '/history') return location.pathname === '/history';
    if (path === '/locations') return location.pathname === '/locations';
    if (path === '/settings') return location.pathname === '/settings';
    return location.pathname.startsWith(path);
  };

  // Construct Role-Based Nav Sections (Simplified Hierarchy)
  let navSections: NavSection[] = [];

  if (isPlatformAdmin) {
    navSections = [
      {
        title: 'Platform System',
        items: [
          { label: 'Platform Console', path: '/platform', icon: <ShieldCheck className="w-4 h-4" /> },
          { label: 'Settings', path: '/settings', icon: <Sliders className="w-4 h-4" /> },
        ]
      }
    ];
  } else if (isManagementUser) {
    const mainItems: NavItem[] = [
      { label: 'Dashboard', path: '/dashboard', icon: <LayoutDashboard className="w-4 h-4" /> },
      ...(canViewRoster ? [{ label: 'Roster', path: '/roster', icon: <Calendar className="w-4 h-4" /> }] : []),
      ...(canViewTimesheets ? [{ label: 'Timesheets', path: '/timesheets', icon: <CheckSquare className="w-4 h-4" /> }] : []),
      ...(canViewLeave ? [{ label: 'Leave', path: '/leave-requests', icon: <Plane className="w-4 h-4" /> }] : []),
    ];

    const peopleItems: NavItem[] = [
      ...(canViewStaff ? [{ label: 'Employees', path: '/employees', icon: <Users className="w-4 h-4" /> }] : []),
      { label: 'Team Chat', path: '/announcements', icon: <MessageSquare className="w-4 h-4" /> },
    ];

    const managementItems: NavItem[] = [
      ...(canViewBranches ? [{ label: 'Locations', path: '/locations', icon: <Building2 className="w-4 h-4" /> }] : []),
      ...(canViewReports ? [{ label: 'Reports', path: '/reports', icon: <BarChart3 className="w-4 h-4" /> }] : []),
      ...(canViewAudit ? [{ label: 'Audit Log', path: '/audit', icon: <FileText className="w-4 h-4" /> }] : []),
      ...(canViewOrgSettings ? [{ label: 'Settings', path: '/settings', icon: <Sliders className="w-4 h-4" /> }] : []),
      { label: 'Help & Guide', onClick: () => setShowHelpModal(true), icon: <HelpCircle className="w-4 h-4" /> },
    ];

    navSections = [
      { title: 'Main', items: mainItems },
      { title: 'People', items: peopleItems },
      { title: 'Management', items: managementItems },
    ].filter(section => section.items.length > 0);
  } else {
    // Employee Navigation: Main + Account
    navSections = [
      {
        title: 'Main',
        items: [
          { label: 'Dashboard', path: '/dashboard', icon: <Home className="w-4 h-4" /> },
          { label: 'My Timesheet', path: '/timesheet', icon: <Clock className="w-4 h-4" /> },
          { label: 'My Schedule', path: '/schedule', icon: <Calendar className="w-4 h-4" /> },
          { label: 'Timesheet History', path: '/history', icon: <History className="w-4 h-4" /> },
          { label: 'Team Chat', path: '/announcements', icon: <MessageSquare className="w-4 h-4" /> },
        ]
      },
      {
        title: 'Account',
        items: [
          { label: 'Settings', path: '/settings', icon: <Sliders className="w-4 h-4" /> },
          { label: 'Help & Guide', onClick: () => setShowHelpModal(true), icon: <HelpCircle className="w-4 h-4" /> },
        ]
      }
    ];
  }

  // ---------------------------------------------------------------------------
  // Branch switcher: only branches where the user holds an ACTIVE membership.
  // Owners / org admins who need the full branch list for management use the
  // Locations page — the switcher is strictly "branches I can work in".
  // ---------------------------------------------------------------------------
  const branchOptions: Array<{ id: string; name: string; role: string | null }> = isLegacy
    ? userLocations.map((l: any) => ({ id: l.id, name: l.name, role: null }))
    : activeBranchMemberships.map(m => ({ id: m.branchId, name: m.branchName, role: m.role }));

  const resolvedBranchId = (isLegacy ? user?.location_id : activeBranchId) || '';
  const activeBranchName =
    branchOptions.find(b => b.id === resolvedBranchId)?.name || activeLocationName || '';
  const activeBranchRoleLabel = activeBranchRole ? BRANCH_ROLE_LABELS[activeBranchRole] : null;
  const showBranchContext = !isPlatformAdmin && (!!activeBranchName || branchOptions.length > 0 || !isLegacy);

  const isFluid = location.pathname === '/roster';

  return (
    <div className="min-h-screen flex bg-[var(--bg)] text-[var(--text)]">
      {/* ========================================================================= */}
      {/* DESKTOP LEFT SIDEBAR NAVIGATION (Modern SaaS, Hover-Expanding & Categorized)*/}
      {/* ========================================================================= */}
      
      {/* 1. Desktop Spacer: Keeps main content steady without layout jitter */}
      <div 
        className={`hidden md:block shrink-0 transition-[width] duration-200 ease-out ${
          isPinned ? 'w-60' : 'w-16'
        }`} 
      />

      {/* 2. Desktop Floating / Pinned Sidebar */}
      <aside
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        className={`hidden md:flex flex-col fixed inset-y-0 left-0 z-30 bg-[var(--sidebar-bg)] text-[var(--sidebar-text)] border-r border-[var(--sidebar-border)] shadow-xl transition-[width] duration-200 ease-out select-none ${
          isSidebarOpen ? 'w-60' : 'w-16'
        }`}
      >
        {/* Brand Header */}
        <div className="h-16 px-4 border-b border-[var(--sidebar-border)] flex items-center justify-between shrink-0">
          <Link to="/dashboard" className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-[var(--primary)] text-white flex items-center justify-center font-black text-sm shrink-0 shadow-md shadow-indigo-500/20">
              <Clock className="w-4 h-4" />
            </div>
            {isSidebarOpen && (
              <div className="min-w-0 animate-in fade-in duration-150">
                <div className="font-bold text-sm tracking-tight text-white truncate flex items-center gap-1.5">
                  <span>SimpleHours</span>
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                </div>
                <div className="text-[10px] text-[var(--sidebar-text)] font-medium truncate">
                  Workforce & Scheduling
                </div>
              </div>
            )}
          </Link>

          {/* Pin / Collapse Toggle Button */}
          {isSidebarOpen && (
            <button
              onClick={() => {
                const next = !isPinned;
                setIsPinned(next);
                localStorage.setItem('simplehours_sidebar_pinned', String(next));
              }}
              className="p-1.5 rounded-lg text-[var(--sidebar-text)] hover:text-white hover:bg-white/10 transition-colors shrink-0 animate-in fade-in"
              title={isPinned ? 'Unpin sidebar (auto-collapse on hover)' : 'Pin sidebar open'}
            >
              {isPinned ? <PinOff className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />}
            </button>
          )}
        </div>

        {/* Organisation Context Chip (When expanded) */}
        {isSidebarOpen && !isPlatformAdmin && (
          <div className="px-3 pt-3 pb-1 shrink-0 animate-in fade-in duration-150 space-y-1.5">
            <div className="px-3 py-2 rounded-xl bg-white/5 border border-white/8 flex items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-2 min-w-0">
                <Building2 className="w-3.5 h-3.5 text-[var(--primary)] shrink-0" />
                <span className="font-semibold text-white truncate">{currentOrgName}</span>
              </div>
              {organisations.length > 1 && (
                <button
                  onClick={() => setShowOrgSwitchModal(true)}
                  className="text-[10px] text-[var(--primary)] hover:underline shrink-0 font-medium"
                  title="Switch organisation"
                >
                  Switch
                </button>
              )}
            </div>

            {/* Active branch indicator + membership-scoped branch switcher */}
            {showBranchContext && (
              <div className="px-3 py-2 rounded-lg bg-white/5 border border-white/5 space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <MapPin
                      className={`w-3 h-3 shrink-0 ${activeBranchName ? 'text-emerald-400' : 'text-amber-400'}`}
                    />
                    <span className="truncate text-white font-medium text-[11px]">
                      {activeBranchName || 'No active branch'}
                    </span>
                  </div>
                  {activeBranchRoleLabel && (
                    <span className="shrink-0 text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/20">
                      {activeBranchRoleLabel}
                    </span>
                  )}
                </div>

                {branchOptions.length > 1 && (
                  <select
                    value={resolvedBranchId}
                    onChange={(e) => handleSwitchLocation(e.target.value)}
                    aria-label="Switch active branch"
                    className="w-full bg-black/30 text-white text-[10px] rounded-md px-2 py-1 border border-white/10 outline-none cursor-pointer focus:border-[var(--primary)]"
                  >
                    {branchOptions.map(b => (
                      <option key={b.id} value={b.id} className="text-black">
                        {b.name}
                        {b.role ? ` — ${BRANCH_ROLE_LABELS[b.role] ?? b.role}` : ''}
                      </option>
                    ))}
                  </select>
                )}

                {!isLegacy && branchOptions.length === 0 && (
                  <p className="text-[10px] leading-snug text-[var(--sidebar-text)] opacity-80">
                    No branch memberships. Branch rosters and timesheets require a branch role — manage branches from Locations.
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {/* Navigation Categories */}
        <nav className="flex-1 px-2.5 py-3 space-y-4 overflow-y-auto">
          {navSections.map((section, sIdx) => (
            <div key={sIdx} className="space-y-1">
              {section.title && isSidebarOpen && (
                <div className="px-3 pb-1 pt-1 text-[10px] font-bold uppercase tracking-wider text-[var(--sidebar-text)] opacity-50 animate-in fade-in">
                  {section.title}
                </div>
              )}
              {section.title && !isSidebarOpen && sIdx > 0 && (
                <div className="my-2 border-t border-white/10 mx-2" />
              )}

              {section.items.map((item) => {
                const active = isActive(item.path);
                const className = `w-full flex items-center gap-3 px-3 py-2 rounded-xl text-xs font-medium transition-all group relative text-left ${
                  active
                    ? 'bg-[var(--sidebar-active-bg)] text-[var(--sidebar-active-text)] font-semibold shadow-xs'
                    : 'text-[var(--sidebar-text)] hover:text-white hover:bg-white/5'
                } ${!isSidebarOpen ? 'justify-center px-0' : ''}`;

                if (item.path) {
                  return (
                    <Link
                      key={item.path}
                      to={item.path}
                      title={!isSidebarOpen ? item.label : undefined}
                      className={className}
                    >
                      {/* Active Indicator Strip */}
                      {active && (
                        <span className="absolute left-0 top-2 bottom-2 w-1 rounded-r bg-[var(--primary)]" />
                      )}
                      <span className={`shrink-0 ${active ? 'text-[var(--primary)]' : 'group-hover:text-white'}`}>
                        {item.icon}
                      </span>
                      {isSidebarOpen && <span className="truncate">{item.label}</span>}
                    </Link>
                  );
                }

                return (
                  <button
                    key={item.label}
                    type="button"
                    onClick={item.onClick}
                    title={!isSidebarOpen ? item.label : undefined}
                    className={className}
                  >
                    <span className="shrink-0 group-hover:text-white">
                      {item.icon}
                    </span>
                    {isSidebarOpen && <span className="truncate">{item.label}</span>}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        {/* User Footer & Quick Actions */}
        <div className="p-3 border-t border-[var(--sidebar-border)] space-y-2 shrink-0">
          {isSidebarOpen ? (
            <div className="p-2.5 rounded-xl bg-white/5 flex items-center justify-between text-xs animate-in fade-in duration-150">
              <div className="min-w-0 pr-2">
                <div className="font-semibold text-white truncate text-xs">
                  {user?.email?.split('@')[0]}
                </div>
                <div className="text-[10px] text-[var(--sidebar-text)] flex items-center gap-1.5 mt-0.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-[var(--success)]" />
                  <span className="truncate">{role}</span>
                </div>
              </div>

              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={toggleTheme}
                  className="p-1.5 rounded-lg hover:bg-white/10 text-[var(--sidebar-text)] hover:text-white transition-colors"
                  title={`Toggle theme (Current: ${theme})`}
                >
                  {theme === 'dark' ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
                </button>
                <button
                  onClick={handleLogout}
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
                title={`Toggle theme (Current: ${theme})`}
              >
                {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              </button>
              <button
                onClick={handleLogout}
                className="p-2 rounded-lg hover:bg-rose-500/20 text-rose-400"
                title="Sign out"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      </aside>

      {/* ========================================================================= */}
      {/* MAIN CONTENT WRAPPER + MOBILE TOP BAR                                     */}
      {/* ========================================================================= */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Mobile Header Bar */}
        <header className="md:hidden border-b border-[var(--border)] bg-[var(--panel)] px-4 py-3 flex items-center justify-between sticky top-0 z-40">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setMobileMenuOpen(true)}
              className="p-1.5 rounded-lg text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--panel-subtle)]"
              aria-label="Open menu"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2 font-bold text-sm text-[var(--text)]">
              <div className="w-6 h-6 rounded bg-[var(--primary)] flex items-center justify-center text-white text-xs font-bold">
                SH
              </div>
              <span>SimpleHours</span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-[var(--muted)] truncate max-w-[120px]">
              {currentOrgName}
            </span>
            <button
              onClick={handleLogout}
              className="p-1.5 rounded text-rose-400 hover:bg-rose-500/10"
              title="Sign out"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </header>

        {/* Mobile Drawer Navigation Overlay */}
        {mobileMenuOpen && (
          <div className="md:hidden fixed inset-0 z-50 flex">
            <div 
              className="fixed inset-0 bg-black/60 backdrop-blur-xs" 
              onClick={() => setMobileMenuOpen(false)} 
            />
            <div className="relative w-72 max-w-[80%] bg-[var(--sidebar-bg)] text-[var(--sidebar-text)] flex flex-col h-full z-10 shadow-2xl">
              {/* Drawer Header */}
              <div className="p-4 border-b border-[var(--sidebar-border)] flex items-center justify-between">
                <div className="flex items-center gap-2 font-bold text-sm text-white">
                  <div className="w-7 h-7 rounded-lg bg-[var(--primary)] flex items-center justify-center text-white">
                    <Clock className="w-4 h-4" />
                  </div>
                  <span>SimpleHours</span>
                </div>
                <button
                  onClick={() => setMobileMenuOpen(false)}
                  className="p-1 rounded text-[var(--sidebar-text)] hover:text-white"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Org Context */}
              {!isPlatformAdmin && (
                <div className="p-3 border-b border-[var(--sidebar-border)] bg-white/5">
                  <div className="text-[10px] uppercase text-[var(--sidebar-text)] font-semibold">Active Workspace</div>
                  <div className="font-bold text-sm text-white truncate">{currentOrgName}</div>
                  {showBranchContext && (
                    <div className="mt-2 space-y-1.5">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <MapPin className={`w-3 h-3 shrink-0 ${activeBranchName ? 'text-emerald-400' : 'text-amber-400'}`} />
                        <span className="truncate text-[11px] text-white font-medium">
                          {activeBranchName || 'No active branch'}
                        </span>
                        {activeBranchRoleLabel && (
                          <span className="shrink-0 text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/20">
                            {activeBranchRoleLabel}
                          </span>
                        )}
                      </div>
                      {branchOptions.length > 1 && (
                        <select
                          value={resolvedBranchId}
                          onChange={(e) => handleSwitchLocation(e.target.value)}
                          aria-label="Switch active branch"
                          className="w-full bg-black/30 text-white text-[11px] rounded-md px-2 py-1.5 border border-white/10 outline-none cursor-pointer focus:border-[var(--primary)]"
                        >
                          {branchOptions.map(b => (
                            <option key={b.id} value={b.id} className="text-black">
                              {b.name}
                              {b.role ? ` — ${BRANCH_ROLE_LABELS[b.role] ?? b.role}` : ''}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Drawer Categorized Links */}
              <nav className="flex-1 p-3 space-y-4 overflow-y-auto">
                {navSections.map((section, sIdx) => (
                  <div key={sIdx} className="space-y-1">
                    {section.title && (
                      <div className="px-3 pb-1 text-[10px] font-bold uppercase tracking-wider text-[var(--sidebar-text)] opacity-50">
                        {section.title}
                      </div>
                    )}
                    {section.items.map((item) => {
                      const active = isActive(item.path);
                      const className = `w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-colors text-left ${
                        active
                          ? 'bg-[var(--sidebar-active-bg)] text-white font-semibold'
                          : 'text-[var(--sidebar-text)] hover:text-white hover:bg-white/5'
                      }`;

                      if (item.path) {
                        return (
                          <Link
                            key={item.path}
                            to={item.path}
                            onClick={() => setMobileMenuOpen(false)}
                            className={className}
                          >
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

              {/* Drawer Footer */}
              <div className="p-4 border-t border-[var(--sidebar-border)] space-y-3">
                <div className="text-xs text-[var(--sidebar-text)] truncate">{user?.email}</div>
                <div className="flex items-center justify-between">
                  <button
                    onClick={toggleTheme}
                    className="flex items-center gap-2 text-xs text-[var(--sidebar-text)] hover:text-white"
                  >
                    {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
                    <span>Theme</span>
                  </button>
                  <button
                    onClick={handleLogout}
                    className="flex items-center gap-1.5 text-xs text-rose-400 font-medium"
                  >
                    <LogOut className="w-4 h-4" />
                    <span>Sign Out</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Page Content Container */}
        <main className={`flex-1 w-full pb-24 md:pb-8 ${isFluid ? 'p-2 sm:p-3 lg:p-4' : 'max-w-7xl mx-auto p-4 sm:p-6 lg:p-8'}`}>
          <Outlet />
        </main>
      </div>

      {/* Mobile Bottom Navigation Bar (Dedicated touch-friendly 48px+ tap targets) */}
      {!isPlatformAdmin && (
        <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-[var(--sidebar-bg)] border-t border-[var(--sidebar-border)] flex items-center justify-around px-2 py-1 shadow-2xl select-none">
          <Link
            to="/dashboard"
            className={`flex flex-col items-center justify-center min-w-[54px] min-h-[48px] py-1 px-2 rounded-xl text-[10px] font-medium transition-colors ${
              location.pathname === '/dashboard' ? 'text-[var(--primary)] font-bold bg-white/5' : 'text-[var(--sidebar-text)] hover:text-white'
            }`}
          >
            <Home className="w-5 h-5 mb-0.5" />
            <span>Home</span>
          </Link>
          <Link
            to={canViewTimesheets ? "/timesheets" : "/timesheet"}
            className={`flex flex-col items-center justify-center min-w-[54px] min-h-[48px] py-1 px-2 rounded-xl text-[10px] font-medium transition-colors ${
              (location.pathname === '/timesheet' || location.pathname === '/timesheets' || location.pathname === '/portal') ? 'text-[var(--primary)] font-bold bg-white/5' : 'text-[var(--sidebar-text)] hover:text-white'
            }`}
          >
            <Clock className="w-5 h-5 mb-0.5" />
            <span>Timesheet</span>
          </Link>
          <Link
            to={canViewRoster ? "/roster" : "/schedule"}
            className={`flex flex-col items-center justify-center min-w-[54px] min-h-[48px] py-1 px-2 rounded-xl text-[10px] font-medium transition-colors ${
              (location.pathname === '/schedule' || location.pathname === '/roster') ? 'text-[var(--primary)] font-bold bg-white/5' : 'text-[var(--sidebar-text)] hover:text-white'
            }`}
          >
            <Calendar className="w-5 h-5 mb-0.5" />
            <span>Schedule</span>
          </Link>
          <Link
            to={canViewReports ? "/reports" : "/history"}
            className={`flex flex-col items-center justify-center min-w-[54px] min-h-[48px] py-1 px-2 rounded-xl text-[10px] font-medium transition-colors ${
              (location.pathname === '/history' || location.pathname === '/reports') ? 'text-[var(--primary)] font-bold bg-white/5' : 'text-[var(--sidebar-text)] hover:text-white'
            }`}
          >
            <History className="w-5 h-5 mb-0.5" />
            <span>{canViewReports ? 'Reports' : 'History'}</span>
          </Link>
          <button
            type="button"
            onClick={() => setShowHelpModal(true)}
            className="flex flex-col items-center justify-center min-w-[54px] min-h-[48px] py-1 px-2 rounded-xl text-[10px] font-medium text-[var(--sidebar-text)] hover:text-white transition-colors"
          >
            <HelpCircle className="w-5 h-5 mb-0.5" />
            <span>Help</span>
          </button>
        </nav>
      )}

      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed top-20 right-6 z-50 bg-[var(--danger)] text-white font-bold text-xs px-4 py-3 rounded-2xl shadow-xl flex items-center gap-2">
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Global Modals & Utilities */}
      <OrgSwitchModal
        isOpen={showOrgSwitchModal}
        onClose={() => setShowOrgSwitchModal(false)}
        organisations={organisations}
        currentOrgId={user?.organisation_id}
        onSwitch={handleSwitchOrg}
        switching={switching}
      />

      <SessionTimeoutModal
        isOpen={showWarning}
        remainingSeconds={remainingSeconds}
        isKeepingAlive={isKeepingAlive}
        onStaySignedIn={staySignedIn}
        onLogout={logoutNow}
      />

      {/* 1-Minute Interactive Onboarding Walkthrough */}
      <OnboardingTutorial />

      {/* Always Accessible Contextual Help & FAQ Modal */}
      <ContextHelpModal
        isOpen={showHelpModal}
        onClose={() => setShowHelpModal(false)}
        onStartTutorial={() => {
          setShowHelpModal(false);
          window.dispatchEvent(new Event('start-tutorial'));
        }}
      />

      {/* Role-Aware SimpleHours Help Assistant Chatbot */}
      <HelpChatbot role={role} />
    </div>
  );
}
