import { Suspense, lazy, useEffect, useRef, type JSX } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { PublicLayout } from './layouts/PublicLayout';
import { Home } from './pages/public/Home';
import NotFound from './pages/public/NotFound';
import { portalLoginPath } from './services/portal';
import { landingPath } from './utils/landing';

// Everything except the public home page is loaded when it is first opened, so a visitor to the
// website doesn't download the app, and the app doesn't download every page up front.
const named = <K extends string>(load: () => Promise<Record<K, React.ComponentType<any>>>, key: K) =>
  lazy(() => load().then(m => ({ default: m[key] })));

const Layout = lazy(() => import('./components/Layout'));
const ReauthPrompt = named(() => import('./components/modals/ReauthPrompt'), 'ReauthPrompt');
const Features = named(() => import('./pages/public/Features'), 'Features');
const Pricing = named(() => import('./pages/public/Pricing'), 'Pricing');
const OrgLogin = named(() => import('./pages/auth/OrgLogin'), 'OrgLogin');
const VerifyLogin = lazy(() => import('./pages/auth/VerifyLogin'));
const AcceptInvite = lazy(() => import('./pages/auth/AcceptInvite'));
const SignUp = lazy(() => import('./pages/auth/SignUp'));
const RecoverLoginLink = lazy(() => import('./pages/auth/RecoverLoginLink'));
const SetupOrganisation = lazy(() => import('./pages/SetupOrganisation'));
const ForgotPassword = lazy(() => import('./pages/ForgotPassword'));
const ResetPassword = lazy(() => import('./pages/ResetPassword'));

const Roster = lazy(() => import('./pages/Roster'));
const TimesheetReview = lazy(() => import('./pages/TimesheetReview'));
const Employees = lazy(() => import('./pages/Employees'));
const StaffImport = lazy(() => import('./pages/StaffImport'));
const Locations = lazy(() => import('./pages/Locations'));
const RolesPermissions = lazy(() => import('./pages/RolesPermissions'));
const LeaveRequests = lazy(() => import('./pages/LeaveRequests'));
const Reports = lazy(() => import('./pages/Reports'));
const Audit = lazy(() => import('./pages/Audit'));
const Announcements = lazy(() => import('./pages/Announcements'));
const Settings = lazy(() => import('./pages/Settings'));
const EmployeeSchedule = lazy(() => import('./pages/EmployeeSchedule'));
const EmployeeTimesheet = lazy(() => import('./pages/EmployeeTimesheet'));
const EmployeeHistory = lazy(() => import('./pages/EmployeeHistory'));
const EmployeeLeave = lazy(() => import('./pages/EmployeeLeave'));
import NoAccess from './components/NoAccess';
import { holdsHere, useAccess, type Permission } from './hooks/useAccess';
import { ActiveBranchProvider, useActiveBranch } from './hooks/useActiveBranch';

function Loading() {
  return <div className="p-10 text-center text-sm text-[var(--muted)]">Loading…</div>;
}

/**
 * Shows a page only when the signed-in account may use it. Display only — the API authorises every
 * request itself regardless of what this shows.
 *   permission: holds it (branch-level permissions are asked for the branch being worked in)
 *   anyOf:      holds at least one of them
 *   neither:    any management account (someone who holds at least one management permission)
 */
function Guard({ permission, anyOf, children }: { permission?: Permission; anyOf?: Permission[]; children: JSX.Element }) {
  const { access, loading } = useAccess();
  const { activeBranchId } = useActiveBranch();
  if (loading) return <Loading />;
  if (!access) return <Navigate to={portalLoginPath()} replace />;
  const needs = permission ? [permission] : anyOf;
  if (!needs) return access.is_manager ? children : <NoAccess />;
  const allowed = needs.some(p => holdsHere(access, p, activeBranchId));
  return allowed ? children : <NoAccess needs={needs} />;
}

/** Shows a page only to someone who works in the employee portal (a linked worker record). The counterpart of Guard. */
function EmployeeGuard({ requireTimesheets, children }: { requireTimesheets?: boolean; children: JSX.Element }) {
  const { access, loading, can } = useAccess();
  if (loading) return <Loading />;
  if (!access) return <Navigate to={portalLoginPath()} replace />;
  if (!access.is_employee || !can('portal.access')) return <NoAccess employeePortal />;
  // Employee timesheets switched off: timesheet pages (the timesheet and its history) do not exist
  // for this employee, and the API refuses them too.
  if (requireTimesheets && !access.employee_capabilities?.can_submit_timesheets) return <Navigate to="/my/schedule" replace />;
  return children;
}

/** Re-reads access on every in-app navigation, so a page switched off elsewhere disappears from the nav on the next click. */
function AccessSync() {
  const { pathname } = useLocation();
  const { refresh } = useAccess();
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    void refresh();
  }, [pathname, refresh]);
  return null;
}

function AppShell() {
  const { access, loading } = useAccess();
  if (!localStorage.getItem('token')) return <Navigate to={portalLoginPath()} replace />;
  if (loading && !access) return <Loading />;
  if (!access) return <Navigate to={portalLoginPath()} replace />;
  return (
    <ActiveBranchProvider>
      <AccessSync />
      <Layout />
      {/* After the page, so it sits above any dialog that triggered it. */}
      <ReauthPrompt />
    </ActiveBranchProvider>
  );
}

/** There is no dashboard: everyone lands on the page they work in (see utils/landing). */
function DefaultLanding() {
  const { access, loading } = useAccess();
  if (loading) return <Loading />;
  const path = landingPath(access);
  return path ? <Navigate to={path} replace /> : <NoAccess />;
}

/** Old addresses (bookmarks, emails) keep working. */
function Moved({ to }: { to: string }) {
  const { search, hash } = useLocation();
  return <Navigate to={`${to}${search}${hash}`} replace />;
}

export default function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<Loading />}>
      <Routes>
        {/* Public website */}
        <Route element={<PublicLayout />}>
          <Route path="/" element={<Home />} />
          <Route path="/features" element={<Features />} />
          <Route path="/pricing" element={<Pricing />} />
        </Route>

        {/* Sign-in and account set-up */}
        {/* Sign-in only exists at an organisation's own link. /login is deliberately not a sign-in page. */}
        <Route path="/login/:slug" element={<OrgLogin />} />
        <Route path="/login" element={<NotFound offerLinkRecovery />} />
        <Route path="/recover-login-link" element={<RecoverLoginLink />} />
        <Route path="/verify-login" element={<VerifyLogin />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/signup" element={<SignUp />} />
        <Route path="/setup-organisation" element={<SetupOrganisation />} />
        <Route path="/accept-invite" element={<AcceptInvite kind="team" />} />
        <Route path="/accept-employee-invite" element={<AcceptInvite kind="employee" />} />

        {/* Signed-in application */}
        <Route element={<AppShell />}>
          <Route path="/app" element={<DefaultLanding />} />
          <Route path="/timesheets" element={<Guard permission="timesheets.view"><TimesheetReview /></Guard>} />
          <Route path="/schedule" element={<Guard permission="rosters.view"><Roster /></Guard>} />
          <Route path="/leave" element={<Guard permission="leave.view"><LeaveRequests /></Guard>} />
          <Route path="/staff" element={<Guard anyOf={['employees.view', 'rosters.view']}><Employees /></Guard>} />
          <Route path="/staff/import" element={<Guard permission="employees.create"><StaffImport /></Guard>} />
          <Route path="/reports" element={<Guard permission="payroll.view"><Reports /></Guard>} />
          <Route path="/announcements" element={<Guard><Announcements /></Guard>} />
          <Route path="/settings" element={<Guard><Settings /></Guard>} />
          <Route path="/settings/branches" element={<Guard><Locations /></Guard>} />
          <Route path="/settings/roles" element={<Guard anyOf={['roles.manage', 'users.manage']}><RolesPermissions /></Guard>} />
          <Route path="/settings/audit" element={<Guard permission="audit.view"><Audit /></Guard>} />
          <Route path="/dashboard" element={<Moved to="/app" />} />
          <Route path="/roster" element={<Moved to="/schedule" />} />
          <Route path="/leave-requests" element={<Moved to="/leave" />} />
          <Route path="/workers" element={<Moved to="/staff" />} />
          <Route path="/branches" element={<Moved to="/settings/branches" />} />
          <Route path="/audit" element={<Moved to="/settings/audit" />} />

          {/* Employee portal */}
          <Route path="/my/schedule" element={<EmployeeGuard><EmployeeSchedule /></EmployeeGuard>} />
          <Route path="/my/timesheet" element={<EmployeeGuard requireTimesheets><EmployeeTimesheet /></EmployeeGuard>} />
          <Route path="/my/history" element={<EmployeeGuard requireTimesheets><EmployeeHistory /></EmployeeGuard>} />
          <Route path="/my/leave" element={<EmployeeGuard><EmployeeLeave /></EmployeeGuard>} />
        </Route>

        {/* Anything else is not a page — the server answers these with a 404 as well. */}
        <Route path="*" element={<NotFound />} />
      </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
