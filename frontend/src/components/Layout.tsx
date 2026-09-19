import { useState, useEffect } from 'react';
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
  ChevronLeft,
  ChevronRight
} from 'lucide-react';
import api from '../services/apiClient';
import { OrgSwitchModal, type OrganisationMembership } from './modals/OrgSwitchModal';
import { SessionTimeoutModal } from './modals/SessionTimeoutModal';
import { useSessionTimeout } from '../hooks/useSessionTimeout';

interface DecodedToken {
  id: string;
  email: string;
  organisation_id?: string;
  role?: string;
}

interface NavItem {
  label: string;
  path: string;
  icon: React.ReactNode;
  badge?: string;
}

export default function Layout() {
  const navigate = useNavigate();
  const location = useLocation();

  const [user, setUser] = useState<DecodedToken | null>(null);
  const [theme, setTheme] = useState(localStorage.getItem('theme') || 'light');
  const [organisations, setOrganisations] = useState<OrganisationMembership[]>([]);
  const [currentOrgName, setCurrentOrgName] = useState<string>('My Organisation');
  const [switching, setSwitching] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // Modals state
  const [showOrgSwitchModal, setShowOrgSwitchModal] = useState(false);

  // Inactivity timeout & multi-tab session management
  const {
    showWarning,
    remainingSeconds,
    isKeepingAlive,
    staySignedIn,
    logoutNow,
  } = useSessionTimeout();

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname]);

  // Auto-collapse sidebar on roster grid to maximise horizontal room
  useEffect(() => {
    if (location.pathname === '/roster') {
      setSidebarCollapsed(true);
    }
  }, [location.pathname]);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) {
      try {
        const decoded = jwtDecode<DecodedToken>(token);
        setUser(decoded);
        fetchOrganisations();
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
      alert('Failed to switch organisation');
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
  const isManagerOrAdmin = ['Admin', 'Company Admin', 'Platform Admin', 'Manager'].includes(role);
  const isPlatformAdmin = role === 'Platform Admin';

  const isActive = (path: string) => {
    if (path === '/dashboard') return location.pathname === '/dashboard';
    if (path === '/roster') return location.pathname === '/roster';
    if (path === '/portal') return location.pathname === '/portal';
    if (path === '/settings') return location.pathname === '/settings';
    return location.pathname.startsWith(path);
  };

  // Construct Role-Based Nav Items
  let navItems: NavItem[] = [];

  if (isPlatformAdmin) {
    navItems = [
      { label: 'Platform Console', path: '/platform', icon: <ShieldCheck className="w-4 h-4" /> },
      { label: 'Settings', path: '/settings', icon: <Sliders className="w-4 h-4" /> },
    ];
  } else if (isManagerOrAdmin) {
    navItems = [
      { label: 'Dashboard', path: '/dashboard', icon: <LayoutDashboard className="w-4 h-4" /> },
      { label: 'Roster', path: '/roster', icon: <Calendar className="w-4 h-4" /> },
      { label: 'Staff', path: '/employees', icon: <Users className="w-4 h-4" /> },
      { label: 'Leave', path: '/leave-requests', icon: <Plane className="w-4 h-4" /> },
      { label: 'Reports', path: '/reports', icon: <BarChart3 className="w-4 h-4" /> },
      { label: 'Team Chat', path: '/announcements', icon: <MessageSquare className="w-4 h-4" /> },
      { label: 'My Portal', path: '/portal', icon: <Clock className="w-4 h-4" /> },
      ...(role !== 'Manager' ? [{ label: 'Audit', path: '/audit', icon: <FileText className="w-4 h-4" /> }] : []),
      { label: 'Settings', path: '/settings', icon: <Sliders className="w-4 h-4" /> },
    ];
  } else {
    // Employee Navigation: significantly simpler
    navItems = [
      { label: 'Dashboard', path: '/dashboard', icon: <LayoutDashboard className="w-4 h-4" /> },
      { label: 'My Timesheet & Shifts', path: '/portal', icon: <Clock className="w-4 h-4" /> },
      { label: 'Team Chat', path: '/announcements', icon: <MessageSquare className="w-4 h-4" /> },
      { label: 'Settings', path: '/settings', icon: <Sliders className="w-4 h-4" /> },
    ];
  }

  const isFluid = location.pathname === '/roster';

  return (
    <div className="min-h-screen flex bg-[var(--bg)] text-[var(--text)]">
      {/* ========================================================================= */}
      {/* DESKTOP LEFT SIDEBAR NAVIGATION (BambooHR / Modern SaaS Inspired)           */}
      {/* ========================================================================= */}
      <aside 
        className={`hidden md:flex flex-col border-r border-[var(--sidebar-border)] bg-[var(--sidebar-bg)] text-[var(--sidebar-text)] transition-all duration-200 sticky top-0 h-screen z-30 shrink-0 select-none ${
          sidebarCollapsed ? 'w-18' : 'w-60'
        }`}
      >
        {/* Brand Header */}
        <div className="h-16 px-4 flex items-center justify-between border-b border-[var(--sidebar-border)]">
          <Link to={isPlatformAdmin ? '/platform' : isManagerOrAdmin ? '/dashboard' : '/portal'} className="flex items-center gap-2.5 overflow-hidden">
            <div className="w-8 h-8 rounded-lg bg-[var(--primary)] flex items-center justify-center text-white shrink-0 shadow-xs">
              <Clock className="w-4 h-4" />
            </div>
            {!sidebarCollapsed && (
              <div className="min-w-0">
                <div className="font-bold text-sm tracking-tight text-white truncate">
                  Simple Hours
                </div>
                <div className="text-[10px] text-[var(--sidebar-text)] font-medium truncate">
                  Workforce & Scheduling
                </div>
              </div>
            )}
          </Link>

          {/* Collapse Toggle Button */}
          <button
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            className="p-1 rounded text-[var(--sidebar-text)] hover:text-white hover:bg-white/5 transition-colors"
            title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {sidebarCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
          </button>
        </div>

        {/* Organisation Context Chip (When not collapsed) */}
        {!sidebarCollapsed && !isPlatformAdmin && (
          <div className="px-3 pt-3 pb-1">
            <div className="px-3 py-2 rounded-lg bg-white/5 border border-white/8 flex items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-2 min-w-0">
                <Building2 className="w-3.5 h-3.5 text-[var(--primary)] shrink-0" />
                <span className="font-semibold text-white truncate">{currentOrgName}</span>
              </div>
              {organisations.length > 1 && (
                <button
                  onClick={() => setShowOrgSwitchModal(true)}
                  className="text-[10px] text-[var(--primary)] hover:underline shrink-0"
                  title="Switch organisation"
                >
                  Switch
                </button>
              )}
            </div>
          </div>
        )}

        {/* Navigation Links */}
        <nav className="flex-1 px-3 py-3 space-y-1 overflow-y-auto">
          {navItems.map((item) => {
            const active = isActive(item.path);
            return (
              <Link
                key={item.path}
                to={item.path}
                title={sidebarCollapsed ? item.label : undefined}
                className={`flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-medium transition-colors group relative ${
                  active
                    ? 'bg-[var(--sidebar-active-bg)] text-[var(--sidebar-active-text)] font-semibold'
                    : 'text-[var(--sidebar-text)] hover:text-white hover:bg-white/5'
                }`}
              >
                {/* Active Indicator Strip */}
                {active && (
                  <span className="absolute left-0 top-1.5 bottom-1.5 w-1 rounded-r bg-[var(--primary)]" />
                )}
                <span className={`shrink-0 ${active ? 'text-[var(--primary)]' : 'group-hover:text-white'}`}>
                  {item.icon}
                </span>
                {!sidebarCollapsed && <span className="truncate">{item.label}</span>}
              </Link>
            );
          })}
        </nav>

        {/* User Footer & Quick Actions */}
        <div className="p-3 border-t border-[var(--sidebar-border)] space-y-2">
          {!sidebarCollapsed ? (
            <div className="p-2 rounded-lg bg-white/5 flex items-center justify-between text-xs">
              <div className="min-w-0 pr-2">
                <div className="font-semibold text-white truncate text-xs">
                  {user?.email?.split('@')[0]}
                </div>
                <div className="text-[10px] text-[var(--sidebar-text)] flex items-center gap-1.5 mt-0.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-[var(--success)]" />
                  <span>{role}</span>
                </div>
              </div>

              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={toggleTheme}
                  className="p-1.5 rounded hover:bg-white/10 text-[var(--sidebar-text)] hover:text-white transition-colors"
                  title={`Toggle theme (Current: ${theme})`}
                >
                  {theme === 'dark' ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
                </button>
                <button
                  onClick={handleLogout}
                  className="p-1.5 rounded hover:bg-rose-500/20 text-rose-400 hover:text-rose-300 transition-colors"
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
                className="p-2 rounded hover:bg-white/10 text-[var(--sidebar-text)] hover:text-white"
                title={`Toggle theme (Current: ${theme})`}
              >
                {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              </button>
              <button
                onClick={handleLogout}
                className="p-2 rounded hover:bg-rose-500/20 text-rose-400"
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
              <span>Simple Hours</span>
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
                  <span>Simple Hours</span>
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
                </div>
              )}

              {/* Drawer Links */}
              <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
                {navItems.map((item) => {
                  const active = isActive(item.path);
                  return (
                    <Link
                      key={item.path}
                      to={item.path}
                      onClick={() => setMobileMenuOpen(false)}
                      className={`flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                        active
                          ? 'bg-[var(--sidebar-active-bg)] text-white font-semibold'
                          : 'text-[var(--sidebar-text)] hover:text-white hover:bg-white/5'
                      }`}
                    >
                      <span className={active ? 'text-[var(--primary)]' : ''}>{item.icon}</span>
                      <span>{item.label}</span>
                    </Link>
                  );
                })}
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
        <main className={`flex-1 w-full ${isFluid ? 'p-2 sm:p-3 lg:p-4' : 'max-w-7xl mx-auto p-4 sm:p-6 lg:p-8'}`}>
          <Outlet />
        </main>
      </div>

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
    </div>
  );
}
