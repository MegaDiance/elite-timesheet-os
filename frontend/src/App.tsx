import { useEffect, useState, type JSX } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import { PublicLayout } from './layouts/PublicLayout';
import { Home } from './pages/public/Home';
import { Features } from './pages/public/Features';
import { Pricing } from './pages/public/Pricing';
import { FindOrg } from './pages/public/FindOrg';
import { OrgLogin } from './pages/auth/OrgLogin';

import Roster from './pages/Roster';
import Employees from './pages/Employees';
import Portal from './pages/Portal';
import Audit from './pages/Audit';
import PlatformAdmin from './pages/PlatformAdmin';
import Login from './pages/Login';
import SetupAccount from './pages/SetupAccount';
import ResetPassword from './pages/ResetPassword';
import ForgotPassword from './pages/ForgotPassword';
import SetupOrganisation from './pages/SetupOrganisation';
import AcceptInvite from './pages/AcceptInvite';
import Announcements from './pages/Announcements';
import LeaveRequests from './pages/LeaveRequests';
import Dashboard from './pages/Dashboard';

import { jwtDecode } from 'jwt-decode';

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
  if (!role) return <Navigate to="/find-organisation" replace />;
  if (role === 'Platform Admin') return <Navigate to="/platform" replace />;
  if (role === 'Employee') return <Navigate to="/portal" replace />;
  return <Navigate to="/roster" replace />;
}

function ProtectedRoute({ allowedRoles, children }: { allowedRoles: string[]; children: JSX.Element }) {
  const role = getRole();
  if (!role) return <Navigate to="/find-organisation" replace />;
  if (!allowedRoles.includes(role)) {
    if (role === 'Employee') return <Navigate to="/portal" replace />;
    return <Navigate to="/roster" replace />;
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
          <Route path="/find-organisation" element={<FindOrg />} />
          <Route path="/signin" element={<Navigate to="/find-organisation" replace />} />
        </Route>

        {/* Branded & General Authentication Routes */}
        <Route path="/login/:slug" element={<OrgLogin />} />
        <Route path="/login" element={<Login />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/setup-account" element={<SetupAccount />} />
        <Route path="/accept-invite" element={<AcceptInvite />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/setup-org" element={<SetupOrganisation />} />

        {/* Authenticated Application Shell */}
        <Route element={isAuthenticated ? <Layout /> : <Navigate to="/find-organisation" replace />}>
          <Route path="/app" element={<AppHomeRedirect />} />
          <Route 
            path="/dashboard" 
            element={
              <ProtectedRoute allowedRoles={['Admin', 'Company Admin', 'Platform Admin', 'Manager']}>
                <Dashboard />
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/roster" 
            element={
              <ProtectedRoute allowedRoles={['Admin', 'Company Admin', 'Platform Admin', 'Manager']}>
                <Roster />
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/employees" 
            element={
              <ProtectedRoute allowedRoles={['Admin', 'Company Admin', 'Platform Admin', 'Manager']}>
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
              <ProtectedRoute allowedRoles={['Admin', 'Company Admin', 'Platform Admin', 'Manager']}>
                <LeaveRequests />
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/portal" 
            element={
              <ProtectedRoute allowedRoles={['Employee', 'Manager', 'Company Admin', 'Platform Admin']}>
                <Portal />
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/audit" 
            element={
              <ProtectedRoute allowedRoles={['Admin', 'Company Admin', 'Platform Admin']}>
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
        </Route>

        {/* Catch-all fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
