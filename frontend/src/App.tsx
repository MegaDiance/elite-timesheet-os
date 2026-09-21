import { useEffect, useState, type JSX } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import { PublicLayout } from './layouts/PublicLayout';
import { Home } from './pages/public/Home';
import { Features } from './pages/public/Features';
import { Pricing } from './pages/public/Pricing';
import { PortalAccess } from './pages/public/PortalAccess';
import { OrgLogin } from './pages/auth/OrgLogin';
import PlatformGate from './pages/auth/PlatformGate';

import Roster from './pages/Roster';
import Employees from './pages/Employees';
import Audit from './pages/Audit';
import PlatformAdmin from './pages/PlatformAdmin';
import Login from './pages/Login';
import SetupAccount from './pages/SetupAccount';
import ResetPassword from './pages/ResetPassword';
import ForgotPassword from './pages/ForgotPassword';
import Locations from './pages/Locations';
import AcceptLocationInvite from './pages/auth/AcceptLocationInvite';
import SetupOrganisation from './pages/SetupOrganisation';
import AcceptInvite from './pages/AcceptInvite';
import VerifyLogin from './pages/auth/VerifyLogin';
import Announcements from './pages/Announcements';
import LeaveRequests from './pages/LeaveRequests';
import Dashboard from './pages/Dashboard';
import Reports from './pages/Reports';
import Settings from './pages/Settings';

import { jwtDecode } from 'jwt-decode';
import EmployeeTimesheet from './pages/EmployeeTimesheet';
import EmployeeSchedule from './pages/EmployeeSchedule';
import EmployeeHistory from './pages/EmployeeHistory';
import TimesheetReview from './pages/TimesheetReview';

interface DecodedToken {
  role?: string;
}

function getRole(): string | null {
  const token = localStorage.getItem('token');
  if (!token) return null;
  try {
    const decoded = jwtDecode<DecodedToken>(token);
    return decoded.role || null;
  } catch {
    return null;
  }
}

function AppHomeRedirect() {
  const role = getRole();
  if (!role) return <Navigate to="/portal-access" replace />;
  if (role === 'Platform Admin') return <Navigate to="/platform" replace />;
  return <Navigate to="/dashboard" replace />;
}

function ProtectedRoute({ allowedRoles, children }: { allowedRoles: string[]; children: JSX.Element }) {
  const role = getRole();
  if (!role) return <Navigate to="/portal-access" replace />;
  const isAuthorized = allowedRoles.includes(role) || 
    (role === 'Owner' && (allowedRoles.includes('Admin') || allowedRoles.includes('Company Admin') || allowedRoles.includes('Manager') || allowedRoles.includes('Owner')));
  if (!isAuthorized) {
    if (role === 'Platform Admin') return <Navigate to="/platform" replace />;
    return <Navigate to="/dashboard" replace />;
  }
  return children;
}

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(!!localStorage.getItem('token'));

  useEffect(() => {
    const handleAuthChange = () => {
      setIsAuthenticated(!!localStorage.getItem('token'));
    };
    window.addEventListener('auth-change', handleAuthChange);
    return () => window.removeEventListener('auth-change', handleAuthChange);
  }, []);

  return (
    <BrowserRouter>
      <Routes>
        {/* Public SaaS Website Layout */}
        <Route element={<PublicLayout />}>
          <Route path="/" element={<Home />} />
          <Route path="/features" element={<Features />} />
          <Route path="/pricing" element={<Pricing />} />
          <Route path="/portal-access" element={<PortalAccess />} />
          <Route path="/find-organisation" element={<Navigate to="/portal-access" replace />} />
          <Route path="/signin" element={<Navigate to="/portal-access" replace />} />
        </Route>

        {/* Branded & General Authentication Routes */}
        <Route path="/login/:slug" element={<OrgLogin />} />
        <Route path="/login" element={<Login />} />
        <Route path="/verify-login" element={<VerifyLogin />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/setup-account" element={<SetupAccount />} />
        <Route path="/accept-invite" element={<AcceptInvite />} />
        <Route path="/accept-location-invite" element={<AcceptLocationInvite />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/setup-org" element={<SetupOrganisation />} />
        <Route path="/setup-organisation" element={<SetupOrganisation />} />
        
        {/* Unlisted Secret Platform Admin Console Gateway */}
        <Route path="/platform-gate" element={<PlatformGate />} />
        <Route path="/platform-login" element={<PlatformGate />} />

        {/* Authenticated Application Shell */}
        <Route element={isAuthenticated ? <Layout /> : <Navigate to="/portal-access" replace />}>
          <Route path="/app" element={<AppHomeRedirect />} />
          <Route 
            path="/dashboard" 
            element={
              <ProtectedRoute allowedRoles={['Admin', 'Company Admin', 'Platform Admin', 'Manager', 'Employee', 'Owner']}>
                <Dashboard />
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/locations" 
            element={
              <ProtectedRoute allowedRoles={['Admin', 'Company Admin', 'Platform Admin', 'Owner']}>
                <Locations />
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/roster" 
            element={
              <ProtectedRoute allowedRoles={['Admin', 'Company Admin', 'Platform Admin', 'Manager', 'Owner']}>
                <Roster />
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/employees" 
            element={
              <ProtectedRoute allowedRoles={['Admin', 'Company Admin', 'Platform Admin', 'Manager', 'Owner']}>
                <Employees />
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/announcements" 
            element={<Announcements />} 
          />
          <Route 
            path="/leave-requests" 
            element={
              <ProtectedRoute allowedRoles={['Admin', 'Company Admin', 'Platform Admin', 'Manager', 'Owner']}>
                <LeaveRequests />
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/reports" 
            element={
              <ProtectedRoute allowedRoles={['Admin', 'Company Admin', 'Platform Admin', 'Manager', 'Owner']}>
                <Reports />
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/timesheet" 
            element={
              <ProtectedRoute allowedRoles={['Admin', 'Company Admin', 'Platform Admin', 'Manager', 'Employee', 'Owner']}>
                <EmployeeTimesheet />
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/schedule" 
            element={
              <ProtectedRoute allowedRoles={['Admin', 'Company Admin', 'Platform Admin', 'Manager', 'Employee', 'Owner']}>
                <EmployeeSchedule />
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/history" 
            element={
              <ProtectedRoute allowedRoles={['Admin', 'Company Admin', 'Platform Admin', 'Manager', 'Employee', 'Owner']}>
                <EmployeeHistory />
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/timesheets" 
            element={
              <ProtectedRoute allowedRoles={['Admin', 'Company Admin', 'Platform Admin', 'Manager', 'Owner']}>
                <TimesheetReview />
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/portal" 
            element={
              <ProtectedRoute allowedRoles={['Employee', 'Manager', 'Company Admin', 'Platform Admin', 'Owner']}>
                <EmployeeTimesheet />
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/audit" 
            element={
              <ProtectedRoute allowedRoles={['Admin', 'Company Admin', 'Platform Admin', 'Owner']}>
                <Audit />
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/platform" 
            element={
              <ProtectedRoute allowedRoles={['Platform Admin']}>
                <PlatformAdmin />
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/settings" 
            element={
              <ProtectedRoute allowedRoles={['Admin', 'Company Admin', 'Platform Admin', 'Manager', 'Employee']}>
                <Settings />
              </ProtectedRoute>
            } 
          />
        </Route>

        {/* Catch-all fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
