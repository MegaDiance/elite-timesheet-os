import { type JSX } from 'react';
import { BrowserRouter, Routes, Route, Navigate, Link } from 'react-router-dom';
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

import Dashboard from './pages/Dashboard';
import Roster from './pages/Roster';
import TimesheetReview from './pages/TimesheetReview';
import Employees from './pages/Employees';
import Locations from './pages/Locations';
import BranchAdmins from './pages/BranchAdmins';
import Reports from './pages/Reports';
import Audit from './pages/Audit';
import Announcements from './pages/Announcements';
import Settings from './pages/Settings';
import { useAccess, type Permission } from './hooks/useAccess';

function Loading() {
  return <div className="p-10 text-center text-sm text-[var(--muted)]">Loading…</div>;
}

function NoAccess() {
  return (
    <div className="max-w-md mx-auto mt-16 p-8 bg-[var(--panel)] border border-[var(--border)] rounded-2xl text-center space-y-3">
      <h1 className="text-lg font-bold text-[var(--text)]">You don’t have access to this page</h1>
      <p className="text-sm text-[var(--muted)]">
        This area is managed by the Organisation Owner. If you need it, ask the owner to change your access.
      </p>
      <Link to="/dashboard" className="inline-block text-sm font-semibold text-[var(--primary)] hover:underline">Go to the dashboard</Link>
    </div>
  );
}

/** Shows a page only when the signed-in account holds `permission`. Display only — the API enforces it too. */
function Guard({ permission, children }: { permission?: Permission; children: JSX.Element }) {
  const { access, loading, can } = useAccess();
  if (loading) return <Loading />;
  if (!access) return <Navigate to="/login" replace />;
  if (permission && !can(permission)) return <NoAccess />;
  return children;
}

function AppShell() {
  const { access, loading } = useAccess();
  if (!localStorage.getItem('token')) return <Navigate to="/login" replace />;
  if (loading && !access) return <Loading />;
  if (!access) return <Navigate to="/login" replace />;
  return <Layout />;
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
        <Route path="/login/:slug" element={<OrgLogin />} />
        <Route path="/login" element={<OrgLogin />} />
        <Route path="/verify-login" element={<VerifyLogin />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/signup" element={<SignUp />} />
        <Route path="/setup-organisation" element={<SetupOrganisation />} />
        <Route path="/accept-invite" element={<AcceptInvite />} />

        {/* Signed-in application */}
        <Route element={<AppShell />}>
          <Route path="/app" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<Guard permission="branch.view"><Dashboard /></Guard>} />
          <Route path="/roster" element={<Guard permission="rosters.manage"><Roster /></Guard>} />
          <Route path="/timesheets" element={<Guard permission="timesheets.manage"><TimesheetReview /></Guard>} />
          <Route path="/workers" element={<Guard permission="workers.manage"><Employees /></Guard>} />
          <Route path="/reports" element={<Guard permission="reports.view"><Reports /></Guard>} />
          <Route path="/branches" element={<Guard permission="branch.view"><Locations /></Guard>} />
          <Route path="/branch-admins" element={<Guard permission="branch_admins.manage"><BranchAdmins /></Guard>} />
          <Route path="/audit" element={<Guard permission="audit.view"><Audit /></Guard>} />
          <Route path="/announcements" element={<Guard><Announcements /></Guard>} />
          <Route path="/settings" element={<Guard><Settings /></Guard>} />
          <Route path="*" element={<Guard><NoAccess /></Guard>} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
