import { useEffect, useRef, type JSX } from 'react';
import { BrowserRouter, Routes, Route, Navigate, Link, useLocation } from 'react-router-dom';
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
import BranchAdmins from './pages/BranchAdmins';
import LeaveRequests from './pages/LeaveRequests';
import Reports from './pages/Reports';
import Audit from './pages/Audit';
import Announcements from './pages/Announcements';
import Settings from './pages/Settings';
import EmployeeSchedule from './pages/EmployeeSchedule';
import EmployeeTimesheet from './pages/EmployeeTimesheet';
import EmployeeHistory from './pages/EmployeeHistory';
import EmployeeLeave from './pages/EmployeeLeave';
import { useAccess, type Permission } from './hooks/useAccess';
import { ActiveBranchProvider } from './hooks/useActiveBranch';

function Loading() {
  return <div className="p-10 text-center text-sm text-[var(--muted)]">Loading…</div>;
}

function NoAccess() {
  const { access } = useAccess();
  const isEmployee = access?.role === 'EMPLOYEE';
  return (
    <div className="max-w-md mx-auto mt-16 p-8 bg-[var(--panel)] border border-[var(--border)] rounded-2xl text-center space-y-3">
      <h1 className="text-lg font-bold text-[var(--text)]">You don’t have access to this page</h1>
      <p className="text-sm text-[var(--muted)]">
        {isEmployee
          ? 'This area is for managers and owners. If you need it, ask your manager to change your access.'
          : 'This area is managed by the Organisation Owner. If you need it, ask the owner to change your access.'}
      </p>
      <Link to={isEmployee ? '/my/schedule' : '/dashboard'} className="inline-block text-sm font-semibold text-[var(--primary-text)] hover:underline">
        Go to {isEmployee ? 'my schedule' : 'the dashboard'}
      </Link>
    </div>
  );
}

/**
 * Shows a page only when the signed-in account holds `permission`. Employees hold no permissions
 * at all, so any permission check already excludes them; a bare Guard (no permission — team chat,
 * settings) additionally excludes EMPLOYEE explicitly, since those pages are the same
 * "any management account" audience the API itself restricts them to. Display only — the API
 * authorises every request itself regardless of what this shows.
 */
function Guard({ permission, children }: { permission?: Permission; children: JSX.Element }) {
  const { access, loading, can } = useAccess();
  if (loading) return <Loading />;
  if (!access) return <Navigate to={portalLoginPath()} replace />;
  if (access.role === 'EMPLOYEE') return <NoAccess />;
  if (permission && !can(permission)) return <NoAccess />;
  return children;
}

/** Shows a page only to a signed-in Employee. The counterpart of Guard for the employee portal. */
function EmployeeGuard({ requireTimesheets, children }: { requireTimesheets?: boolean; children: JSX.Element }) {
  const { access, loading } = useAccess();
  if (loading) return <Loading />;
  if (!access) return <Navigate to={portalLoginPath()} replace />;
  if (access.role !== 'EMPLOYEE') return <NoAccess />;
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

/** Employees land on their schedule; every other role lands on the dashboard. */
function DefaultLanding() {
  const { access, loading } = useAccess();
  if (loading) return <Loading />;
  return <Navigate to={access?.role === 'EMPLOYEE' ? '/my/schedule' : '/dashboard'} replace />;
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
        <Route path="/accept-invite" element={<AcceptInvite kind="branch-admin" />} />
        <Route path="/accept-employee-invite" element={<AcceptInvite kind="employee" />} />

        {/* Signed-in application */}
        <Route element={<AppShell />}>
          <Route path="/app" element={<DefaultLanding />} />
          <Route path="/dashboard" element={<Guard permission="branch.view"><Dashboard /></Guard>} />
          <Route path="/roster" element={<Guard permission="rosters.manage"><Roster /></Guard>} />
          <Route path="/timesheets" element={<Guard permission="timesheets.manage"><TimesheetReview /></Guard>} />
          <Route path="/leave-requests" element={<Guard permission="timesheets.manage"><LeaveRequests /></Guard>} />
          <Route path="/workers" element={<Guard permission="workers.manage"><Employees /></Guard>} />
          <Route path="/reports" element={<Guard permission="reports.view"><Reports /></Guard>} />
          <Route path="/branches" element={<Guard permission="branch.view"><Locations /></Guard>} />
          <Route path="/branch-admins" element={<Guard permission="branch_admins.manage"><BranchAdmins /></Guard>} />
          <Route path="/audit" element={<Guard permission="audit.view"><Audit /></Guard>} />
          <Route path="/announcements" element={<Guard><Announcements /></Guard>} />
          <Route path="/settings" element={<Guard><Settings /></Guard>} />

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
