import { useEffect, useRef, type JSX } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import Layout from './components/Layout';
import { PublicLayout } from './layouts/PublicLayout';
import { Home } from './pages/public/Home';
import { Features } from './pages/public/Features';
import { Pricing } from './pages/public/Pricing';
import { OrgLogin } from './pages/auth/OrgLogin';
import VerifyLogin from './pages/auth/VerifyLogin';
import AcceptInvite from './pages/auth/AcceptInvite';
import SignUp from './pages/auth/SignUp';
import SetupOrganisation from './pages/SetupOrganisation';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import NotFound from './pages/public/NotFound';
import { portalLoginPath } from './services/portal';

import Dashboard from './pages/Dashboard';
import Roster from './pages/Roster';
import TimesheetReview from './pages/TimesheetReview';
import Employees from './pages/Employees';
import Locations from './pages/Locations';
import RolesPermissions from './pages/RolesPermissions';
import LeaveRequests from './pages/LeaveRequests';
import Reports from './pages/Reports';
import Audit from './pages/Audit';
import Announcements from './pages/Announcements';
import Settings from './pages/Settings';
import EmployeeSchedule from './pages/EmployeeSchedule';
import EmployeeTimesheet from './pages/EmployeeTimesheet';
import EmployeeHistory from './pages/EmployeeHistory';
import EmployeeLeave from './pages/EmployeeLeave';
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
    </ActiveBranchProvider>
  );
}

/** Managers land on the dashboard; someone who is only an employee lands on their schedule. */
function DefaultLanding() {
  const { access, loading } = useAccess();
  if (loading) return <Loading />;
  if (access?.is_manager) return <Navigate to="/dashboard" replace />;
  if (access?.is_employee) return <Navigate to="/my/schedule" replace />;
  return <NoAccess />;
}

export default function App() {
  return (
    <BrowserRouter>
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
        <Route path="/login" element={<NotFound />} />
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
          <Route path="/dashboard" element={<Guard><Dashboard /></Guard>} />
          <Route path="/roster" element={<Guard permission="rosters.view"><Roster /></Guard>} />
          <Route path="/timesheets" element={<Guard permission="timesheets.view"><TimesheetReview /></Guard>} />
          <Route path="/leave-requests" element={<Guard permission="leave.view"><LeaveRequests /></Guard>} />
          <Route path="/workers" element={<Guard anyOf={['employees.view', 'rosters.view']}><Employees /></Guard>} />
          <Route path="/reports" element={<Guard permission="payroll.view"><Reports /></Guard>} />
          <Route path="/branches" element={<Guard><Locations /></Guard>} />
          <Route path="/audit" element={<Guard permission="audit.view"><Audit /></Guard>} />
          <Route path="/announcements" element={<Guard><Announcements /></Guard>} />
          <Route path="/settings" element={<Guard><Settings /></Guard>} />
          <Route path="/settings/roles" element={<Guard anyOf={['roles.manage', 'users.manage']}><RolesPermissions /></Guard>} />

          {/* Employee portal */}
          <Route path="/my/schedule" element={<EmployeeGuard><EmployeeSchedule /></EmployeeGuard>} />
          <Route path="/my/timesheet" element={<EmployeeGuard requireTimesheets><EmployeeTimesheet /></EmployeeGuard>} />
          <Route path="/my/history" element={<EmployeeGuard requireTimesheets><EmployeeHistory /></EmployeeGuard>} />
          <Route path="/my/leave" element={<EmployeeGuard><EmployeeLeave /></EmployeeGuard>} />
        </Route>

        {/* Anything else is not a page — the server answers these with a 404 as well. */}
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  );
}
