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
  ChevronDown, 
  LogOut, 
  Moon, 
  Sun, 
  Lock, 
  Sliders, 
  KeyRound,
  User as UserIcon,
  Layers,
  MessageSquare,
  LayoutDashboard,
  BarChart3,
  Menu,
  X
} from 'lucide-react';
import api from '../services/apiClient';
import { Badge } from './ui/Badge';
import { BreakSettingsModal } from './modals/BreakSettingsModal';
import { LockPasswordsModal } from './modals/LockPasswordsModal';
import { TwoFactorModal } from './modals/TwoFactorModal';
import { OrgSwitchModal, type OrganisationMembership } from './modals/OrgSwitchModal';
import { SessionTimeoutModal } from './modals/SessionTimeoutModal';
import { AccountSecurityModal } from './modals/AccountSecurityModal';
import { useSessionTimeout } from '../hooks/useSessionTimeout';

interface DecodedToken {
  id: string;
  email: string;
  organisation_id?: string;
  role?: string;
}

export default function Layout() {
  const navigate = useNavigate();
  const location = useLocation();

  const [user, setUser] = useState<DecodedToken | null>(null);
  const [theme, setTheme] = useState(localStorage.getItem('theme') || 'dark');
  const [organisations, setOrganisations] = useState<OrganisationMembership[]>([]);
  const [currentOrgName, setCurrentOrgName] = useState<string>('My Organisation');
  const [switching, setSwitching] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Modals state
  const [showBreakModal, setShowBreakModal] = useState(false);
  const [showLockModal, setShowLockModal] = useState(false);
  const [show2FAModal, setShow2FAModal] = useState(false);
  const [showSecurityModal, setShowSecurityModal] = useState(false);
  const [showOrgSwitchModal, setShowOrgSwitchModal] = useState(false);

  // Close mobile navigation on route change
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname]);

  // Inactivity timeout & multi-tab session management
  const {
    showWarning,
    remainingSeconds,
    isKeepingAlive,
    staySignedIn,
    logoutNow,
  } = useSessionTimeout();

  // Profile menu dropdown
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const profileMenuRef = useRef<HTMLDivElement>(null);

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

  // Click outside to close profile dropdown
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (profileMenuRef.current && !profileMenuRef.current.contains(e.target as Node)) {
        setShowProfileMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const fetchOrganisations = async () => {
    try {
      const res = await api.get('/auth/organisations');
      if (res.data?.data) {
        const orgsList: OrganisationMembership[] = res.data.data;
        setOrganisations(orgsList);

        // Find active organization name
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
    } catch (err) {
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
  const isFluid = location.pathname === '/roster' || location.pathname === '/' || location.pathname === '/portal';

  const isActive = (path: string) => {
    if (path === '/dashboard') return location.pathname === '/dashboard';
    if (path === '/roster') return location.pathname === '/roster';
    if (path === '/portal') return location.pathname === '/portal';
    return location.pathname.startsWith(path);
  };

  const homePath = isPlatformAdmin ? '/platform' : '/dashboard';

  return (
    <div className="min-h-screen flex flex-col bg-[var(--bg)] text-[var(--text)]">
      {/* Top Navigation Bar */}
      <header className="sticky top-0 z-30 border-b border-[var(--border)] bg-[var(--panel)]/95 backdrop-blur-md">
        <div className={`w-full mx-auto px-4 sm:px-6 lg:px-8 h-15 flex items-center justify-between ${isFluid ? 'max-w-none' : 'max-w-7xl'}`}>
          {/* Left: Brand + Organisation Context */}
          <div className="flex items-center gap-6">
            <Link to={homePath} className="flex items-center gap-2 group">
              <div className="w-8 h-8 rounded-md bg-indigo-600 flex items-center justify-center text-white shadow-xs group-hover:bg-indigo-500 transition-colors">
                <Clock className="w-4 h-4" />
              </div>
              <span className="font-bold text-sm tracking-tight text-[var(--text)] hidden sm:inline">
                Elite Timesheet <span className="text-[10px] font-semibold uppercase px-1.5 py-0.2 rounded bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">OS</span>
              </span>
            </Link>

            {/* Active Organisation Context Tag (Non-clickable) — hidden for Platform Admins */}
            {!isPlatformAdmin && (
              <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[var(--panel-subtle)] border border-[var(--border)] text-xs text-[var(--muted)] font-medium">
                <Building2 className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                <span className="max-w-[160px] truncate text-[var(--text)] font-semibold">{currentOrgName}</span>
              </div>
            )}
          </div>

          {/* Center: Role-Based Main Navigation Links */}
          <nav className="hidden md:flex items-center gap-1">
            {isPlatformAdmin ? (
              /* Platform Admin: only show the Platform admin tab */
              <Link
                to="/platform"
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors flex items-center gap-1.5 ${
                  isActive('/platform')
                    ? 'bg-indigo-600/15 text-indigo-400 font-semibold border border-indigo-500/30'
                    : 'text-indigo-400 hover:bg-indigo-500/10'
                }`}
              >
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>Platform Admin</span>
              </Link>
            ) : isManagerOrAdmin ? (
              <>
                <Link
                  to="/dashboard"
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors flex items-center gap-1.5 ${
                    isActive('/dashboard')
                      ? 'bg-[var(--panel-subtle)] text-[var(--text)] font-semibold border border-[var(--border)]'
                      : 'text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--glass-4)]'
                  }`}
                >
                  <LayoutDashboard className="w-3.5 h-3.5 text-indigo-400" />
                  <span>Command Centre</span>
                </Link>

                <Link
                  to="/roster"
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors flex items-center gap-1.5 ${
                    isActive('/roster')
                      ? 'bg-[var(--panel-subtle)] text-[var(--text)] font-semibold border border-[var(--border)]'
                      : 'text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--glass-4)]'
                  }`}
                >
                  <Calendar className="w-3.5 h-3.5" />
                  <span>Roster</span>
                </Link>

                <Link
                  to="/employees"
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors flex items-center gap-1.5 ${
                    isActive('/employees')
                      ? 'bg-[var(--panel-subtle)] text-[var(--text)] font-semibold border border-[var(--border)]'
                      : 'text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--glass-4)]'
                  }`}
                >
                  <Users className="w-3.5 h-3.5" />
                  <span>Staff</span>
                </Link>

                <Link
                  to="/leave-requests"
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors flex items-center gap-1.5 ${
                    isActive('/leave-requests')
                      ? 'bg-[var(--panel-subtle)] text-[var(--text)] font-semibold border border-[var(--border)]'
                      : 'text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--glass-4)]'
                  }`}
                >
                  <Plane className="w-3.5 h-3.5" />
                  <span>Leave</span>
                </Link>

                <Link
                  to="/reports"
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors flex items-center gap-1.5 ${
                    isActive('/reports')
                      ? 'bg-[var(--panel-subtle)] text-[var(--text)] font-semibold border border-[var(--border)]'
                      : 'text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--glass-4)]'
                  }`}
                >
                  <BarChart3 className="w-3.5 h-3.5 text-indigo-400" />
                  <span>Reports</span>
                </Link>

                <Link
                  to="/announcements"
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors flex items-center gap-1.5 ${
                    isActive('/announcements')
                      ? 'bg-[var(--panel-subtle)] text-[var(--text)] font-semibold border border-[var(--border)]'
                      : 'text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--glass-4)]'
                  }`}
                >
                  <MessageSquare className="w-3.5 h-3.5" />
                  <span>Team Chat</span>
                </Link>

                <Link
                  to="/portal"
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors flex items-center gap-1.5 ${
                    isActive('/portal')
                      ? 'bg-[var(--panel-subtle)] text-[var(--text)] font-semibold border border-[var(--border)]'
                      : 'text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--glass-4)]'
                  }`}
                >
                  <Clock className="w-3.5 h-3.5" />
                  <span>My Portal</span>
                </Link>

                {role !== 'Manager' && (
                  <Link
                    to="/audit"
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors flex items-center gap-1.5 ${
                      isActive('/audit')
                        ? 'bg-[var(--panel-subtle)] text-[var(--text)] font-semibold border border-[var(--border)]'
                        : 'text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--glass-4)]'
                    }`}
                  >
                    <FileText className="w-3.5 h-3.5" />
                    <span>Audit</span>
                  </Link>
                )}
              </>
            ) : (
              <>
                <Link
                  to="/dashboard"
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors flex items-center gap-1.5 ${
                    isActive('/dashboard')
                      ? 'bg-[var(--panel-subtle)] text-[var(--text)] font-semibold border border-[var(--border)]'
                      : 'text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--glass-4)]'
                  }`}
                >
                  <LayoutDashboard className="w-3.5 h-3.5 text-indigo-400" />
                  <span>Command Centre</span>
                </Link>

                <Link
                  to="/portal"
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors flex items-center gap-1.5 ${
                    isActive('/portal')
                      ? 'bg-[var(--panel-subtle)] text-[var(--text)] font-semibold border border-[var(--border)]'
                      : 'text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--glass-4)]'
                  }`}
                >
                  <Clock className="w-3.5 h-3.5" />
                  <span>My Timesheet</span>
                </Link>

                <Link
                  to="/announcements"
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors flex items-center gap-1.5 ${
                    isActive('/announcements')
                      ? 'bg-[var(--panel-subtle)] text-[var(--text)] font-semibold border border-[var(--border)]'
                      : 'text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--glass-4)]'
                  }`}
                >
                  <MessageSquare className="w-3.5 h-3.5" />
                  <span>Team Chat</span>
                </Link>
              </>
            )}
          </nav>

          {/* Right: Actions & User Profile Menu */}
          <div className="flex items-center gap-2">
            {/* Mobile Menu Hamburger Toggle Button */}
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="md:hidden p-2 rounded-lg text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--panel-subtle)] border border-[var(--border)] transition-colors cursor-pointer"
              aria-label="Toggle navigation"
            >
              {mobileMenuOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
            </button>

            {/* Profile Dropdown */}
            <div className="relative" ref={profileMenuRef}>
              <button
                onClick={() => setShowProfileMenu(!showProfileMenu)}
                className="flex items-center gap-2.5 p-1.5 rounded-lg hover:bg-[var(--panel-subtle)] border border-transparent hover:border-[var(--border)] transition-colors cursor-pointer select-none"
                aria-expanded={showProfileMenu}
              >
              <div className="w-7 h-7 rounded-md bg-indigo-600/20 text-indigo-400 flex items-center justify-center font-bold text-xs">
                {user?.email?.charAt(0).toUpperCase() || <UserIcon className="w-3.5 h-3.5" />}
              </div>
              <div className="hidden sm:flex flex-col text-left">
                <span className="text-xs font-semibold text-[var(--text)] max-w-[130px] truncate">
                  {user?.email?.split('@')[0]}
                </span>
                <span className="text-[10px] text-[var(--muted)]">{role}</span>
              </div>
              <ChevronDown className="w-3.5 h-3.5 text-[var(--muted)]" />
            </button>

            {/* Dropdown Menu */}
            {showProfileMenu && (
              <div className="absolute right-0 mt-2 w-64 rounded-xl bg-[var(--panel)] border border-[var(--border)] shadow-xl py-2 z-50 text-xs animate-in fade-in zoom-in-95 duration-100 divide-y divide-[var(--border)]">
                {/* Header item */}
                <div className="px-4 py-2.5">
                  <div className="font-semibold text-sm text-[var(--text)] truncate">{user?.email}</div>
                  <div className="flex items-center gap-1.5 mt-1">
                    <Badge variant={role === 'Employee' ? 'default' : 'purple'} size="sm">
                      {role}
                    </Badge>
                    <span className="text-[10px] text-[var(--muted)] truncate">{currentOrgName}</span>
                  </div>
                </div>

                {/* Account Security for All Users */}
                <div className="py-1">
                  <button
                    onClick={() => { setShowSecurityModal(true); setShowProfileMenu(false); }}
                    className="w-full px-4 py-2 text-left text-[var(--text)] hover:bg-[var(--hover-row)] flex items-center gap-2.5 cursor-pointer"
                  >
                    <ShieldCheck className="w-3.5 h-3.5 text-indigo-400" />
                    <span>Account Security & Sessions</span>
                  </button>
                  <button
                    onClick={() => { setShow2FAModal(true); setShowProfileMenu(false); }}
                    className="w-full px-4 py-2 text-left text-[var(--text)] hover:bg-[var(--hover-row)] flex items-center gap-2.5 cursor-pointer"
                  >
                    <KeyRound className="w-3.5 h-3.5 text-indigo-400" />
                    <span>Two-Factor Authentication</span>
                  </button>
                </div>

                {/* Manager / Admin Operational Settings — not shown to Platform Admins */}
                {isManagerOrAdmin && !isPlatformAdmin && (
                  <div className="py-1">
                    <div className="px-4 py-1 text-[10px] font-semibold text-[var(--muted)] uppercase tracking-wider">
                      Workplace Controls
                    </div>
                    <button
                      onClick={() => { setShowBreakModal(true); setShowProfileMenu(false); }}
                      className="w-full px-4 py-2 text-left text-[var(--text)] hover:bg-[var(--hover-row)] flex items-center gap-2.5 cursor-pointer"
                    >
                      <Sliders className="w-3.5 h-3.5 text-indigo-400" />
                      <span>Break Deduction Rules</span>
                    </button>
                    <button
                      onClick={() => { setShowLockModal(true); setShowProfileMenu(false); }}
                      className="w-full px-4 py-2 text-left text-[var(--text)] hover:bg-[var(--hover-row)] flex items-center gap-2.5 cursor-pointer"
                    >
                      <Lock className="w-3.5 h-3.5 text-indigo-400" />
                      <span>Fortnight Lock Passwords</span>
                    </button>
                  </div>
                )}

                {/* Switch Organisation — not shown to Platform Admins unless in an org */}
                {organisations.length > 1 && !isPlatformAdmin && (

                  <div className="py-1">
                    <button
                      onClick={() => { setShowOrgSwitchModal(true); setShowProfileMenu(false); }}
                      className="w-full px-4 py-2 text-left text-[var(--text)] hover:bg-[var(--hover-row)] flex items-center gap-2.5 cursor-pointer"
                    >
                      <Layers className="w-3.5 h-3.5 text-indigo-400" />
                      <span>Switch Organisation ({organisations.length})</span>
                    </button>
                  </div>
                )}

                {/* Theme & Logout */}
                <div className="py-1">
                  <button
                    onClick={toggleTheme}
                    className="w-full px-4 py-2 text-left text-[var(--text)] hover:bg-[var(--hover-row)] flex items-center justify-between cursor-pointer"
                  >
                    <span className="flex items-center gap-2.5">
                      {theme === 'dark' ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
                      <span>Theme</span>
                    </span>
                    <span className="text-[10px] uppercase text-[var(--muted)] font-mono">{theme}</span>
                  </button>

                  <button
                    onClick={handleLogout}
                    className="w-full px-4 py-2 text-left text-rose-500 hover:bg-rose-500/10 flex items-center gap-2.5 cursor-pointer font-medium"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    <span>Sign Out</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

        {/* Mobile Navigation Drawer */}
        {mobileMenuOpen && (
          <div className="md:hidden border-t border-[var(--border)] bg-[var(--panel)] px-4 py-3 space-y-2 animate-in slide-in-from-top-2 duration-150 shadow-xl">
            {!isPlatformAdmin && (
              <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-[var(--panel-subtle)] border border-[var(--border)] text-xs text-[var(--muted)] mb-2">
                <div className="flex items-center gap-2 min-w-0">
                  <Building2 className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                  <span className="font-semibold text-[var(--text)] truncate">{currentOrgName}</span>
                </div>
                <Badge variant="purple" size="sm">{role}</Badge>
              </div>
            )}

            <div className="space-y-1">
              {isPlatformAdmin ? (
                <Link
                  to="/platform"
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-xs font-medium transition-colors ${
                    isActive('/platform')
                      ? 'bg-indigo-600/15 text-indigo-400 font-semibold border border-indigo-500/30'
                      : 'text-[var(--text)] hover:bg-[var(--panel-subtle)]'
                  }`}
                >
                  <ShieldCheck className="w-4 h-4 text-indigo-400" />
                  <span>Platform Admin</span>
                </Link>
              ) : isManagerOrAdmin ? (
                <>
                  <Link
                    to="/dashboard"
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-xs font-medium transition-colors ${
                      isActive('/dashboard')
                        ? 'bg-indigo-600/15 text-indigo-400 font-semibold border border-indigo-500/30'
                        : 'text-[var(--text)] hover:bg-[var(--panel-subtle)]'
                    }`}
                  >
                    <LayoutDashboard className="w-4 h-4 text-indigo-400" />
                    <span>Command Centre</span>
                  </Link>

                  <Link
                    to="/roster"
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-xs font-medium transition-colors ${
                      isActive('/roster')
                        ? 'bg-indigo-600/15 text-indigo-400 font-semibold border border-indigo-500/30'
                        : 'text-[var(--text)] hover:bg-[var(--panel-subtle)]'
                    }`}
                  >
                    <Calendar className="w-4 h-4 text-indigo-400" />
                    <span>Roster Grid</span>
                  </Link>

                  <Link
                    to="/employees"
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-xs font-medium transition-colors ${
                      isActive('/employees')
                        ? 'bg-indigo-600/15 text-indigo-400 font-semibold border border-indigo-500/30'
                        : 'text-[var(--text)] hover:bg-[var(--panel-subtle)]'
                    }`}
                  >
                    <Users className="w-4 h-4 text-indigo-400" />
                    <span>Staff Directory</span>
                  </Link>

                  <Link
                    to="/leave-requests"
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-xs font-medium transition-colors ${
                      isActive('/leave-requests')
                        ? 'bg-indigo-600/15 text-indigo-400 font-semibold border border-indigo-500/30'
                        : 'text-[var(--text)] hover:bg-[var(--panel-subtle)]'
                    }`}
                  >
                    <Plane className="w-4 h-4 text-indigo-400" />
                    <span>Leave Approvals</span>
                  </Link>

                  <Link
                    to="/reports"
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-xs font-medium transition-colors ${
                      isActive('/reports')
                        ? 'bg-indigo-600/15 text-indigo-400 font-semibold border border-indigo-500/30'
                        : 'text-[var(--text)] hover:bg-[var(--panel-subtle)]'
                    }`}
                  >
                    <BarChart3 className="w-4 h-4 text-indigo-400" />
                    <span>Reports & Payroll</span>
                  </Link>

                  <Link
                    to="/announcements"
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-xs font-medium transition-colors ${
                      isActive('/announcements')
                        ? 'bg-indigo-600/15 text-indigo-400 font-semibold border border-indigo-500/30'
                        : 'text-[var(--text)] hover:bg-[var(--panel-subtle)]'
                    }`}
                  >
                    <MessageSquare className="w-4 h-4 text-indigo-400" />
                    <span>Team Chat</span>
                  </Link>

                  <Link
                    to="/portal"
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-xs font-medium transition-colors ${
                      isActive('/portal')
                        ? 'bg-indigo-600/15 text-indigo-400 font-semibold border border-indigo-500/30'
                        : 'text-[var(--text)] hover:bg-[var(--panel-subtle)]'
                    }`}
                  >
                    <Clock className="w-4 h-4 text-indigo-400" />
                    <span>My Personal Portal</span>
                  </Link>

                  {role !== 'Manager' && (
                    <Link
                      to="/audit"
                      className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-xs font-medium transition-colors ${
                        isActive('/audit')
                          ? 'bg-indigo-600/15 text-indigo-400 font-semibold border border-indigo-500/30'
                          : 'text-[var(--text)] hover:bg-[var(--panel-subtle)]'
                      }`}
                    >
                      <FileText className="w-4 h-4 text-indigo-400" />
                      <span>Audit Logs</span>
                    </Link>
                  )}
                </>
              ) : (
                <>
                  <Link
                    to="/dashboard"
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-xs font-medium transition-colors ${
                      isActive('/dashboard')
                        ? 'bg-indigo-600/15 text-indigo-400 font-semibold border border-indigo-500/30'
                        : 'text-[var(--text)] hover:bg-[var(--panel-subtle)]'
                    }`}
                  >
                    <LayoutDashboard className="w-4 h-4 text-indigo-400" />
                    <span>Command Centre</span>
                  </Link>

                  <Link
                    to="/portal"
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-xs font-medium transition-colors ${
                      isActive('/portal')
                        ? 'bg-indigo-600/15 text-indigo-400 font-semibold border border-indigo-500/30'
                        : 'text-[var(--text)] hover:bg-[var(--panel-subtle)]'
                    }`}
                  >
                    <Clock className="w-4 h-4 text-indigo-400" />
                    <span>My Timesheet & Shifts</span>
                  </Link>

                  <Link
                    to="/announcements"
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-xs font-medium transition-colors ${
                      isActive('/announcements')
                        ? 'bg-indigo-600/15 text-indigo-400 font-semibold border border-indigo-500/30'
                        : 'text-[var(--text)] hover:bg-[var(--panel-subtle)]'
                    }`}
                  >
                    <MessageSquare className="w-4 h-4 text-indigo-400" />
                    <span>Team Chat</span>
                  </Link>
                </>
              )}
            </div>
          </div>
        )}
      </header>

      {/* Main Content Area */}
      <main className={`flex-1 w-full mx-auto ${isFluid ? 'max-w-none px-2 sm:px-3 lg:px-4 py-2 sm:py-2.5' : 'max-w-7xl px-4 sm:px-6 lg:px-8 py-6'}`}>
        <Outlet />
      </main>

      {/* Extracted Clean Modals */}
      <BreakSettingsModal isOpen={showBreakModal} onClose={() => setShowBreakModal(false)} />
      <LockPasswordsModal isOpen={showLockModal} onClose={() => setShowLockModal(false)} />
      <TwoFactorModal isOpen={show2FAModal} onClose={() => setShow2FAModal(false)} />
      <AccountSecurityModal isOpen={showSecurityModal} onClose={() => setShowSecurityModal(false)} />
      <OrgSwitchModal
        isOpen={showOrgSwitchModal}
        onClose={() => setShowOrgSwitchModal(false)}
        organisations={organisations}
        currentOrgId={user?.organisation_id}
        onSwitch={handleSwitchOrg}
        switching={switching}
      />

      {/* 15-Minute Session Inactivity Timeout Modal */}
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
