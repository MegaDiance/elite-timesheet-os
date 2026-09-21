import React, { useState, useEffect } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { 
  MapPin, 
  ShieldCheck, 
  Lock, 
  User, 
  Mail, 
  ArrowRight, 
  AlertCircle,
  Clock
} from 'lucide-react';
import api from '../../services/apiClient';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';

interface InviteData {
  email: string;
  role: string;
  location_name: string;
  org_name: string;
  org_slug: string;
  user_exists: boolean;
  user_name: string | null;
}

export default function AcceptLocationInvite() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [inviteData, setInviteData] = useState<InviteData | null>(null);

  // Form State
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!token) {
      setError('Missing invitation token in URL.');
      setLoading(false);
      return;
    }

    const verifyToken = async () => {
      setLoading(true);
      try {
        const res = await api.get(`/locations/verify-invite?token=${encodeURIComponent(token.trim())}`);
        if (res.data?.success && res.data?.data) {
          setInviteData(res.data.data);
          if (res.data.data.user_name) {
            setFullName(res.data.data.user_name);
          }
        } else {
          setError(res.data?.error?.message || 'Invalid or expired invitation token.');
        }
      } catch (err: any) {
        setError(err.response?.data?.error?.message || 'Invalid or expired invitation token.');
      } finally {
        setLoading(false);
      }
    };

    verifyToken();
  }, [token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;

    if (!inviteData?.user_exists) {
      if (password.length < 8) {
        setError('Password must be at least 8 characters long.');
        return;
      }
      if (password !== confirmPassword) {
        setError('Passwords do not match.');
        return;
      }
    }

    setSubmitting(true);
    setError(null);

    try {
      // Accepting never signs anyone in. Existing accounts must already be signed in
      // (the API client sends the current session); new accounts sign in afterwards.
      const res = await api.post('/locations/accept-invite', {
        token: token.trim(),
        password: inviteData?.user_exists ? undefined : password
      });

      if (res.data?.success) {
        if (res.data.data?.requires_sign_in) {
          navigate('/login', { replace: true });
        } else {
          navigate('/dashboard', { replace: true });
        }
      } else {
        setError(res.data?.error?.message || 'Failed to accept invitation.');
      }
    } catch (err: any) {
      if (err.response?.data?.error?.code === 'SIGN_IN_REQUIRED') {
        setError('Please sign in to your existing account first, then open the invitation link from your email again.');
      } else {
        setError(err.response?.data?.error?.message || 'Failed to accept invitation.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--bg)] font-['Inter',sans-serif]">
        <div className="flex flex-col items-center gap-3 text-[var(--muted)]">
          <div className="w-8 h-8 border-2 border-[var(--primary)] border-t-transparent rounded-full animate-spin"></div>
          <p className="text-xs font-medium">Verifying location invitation...</p>
        </div>
      </div>
    );
  }

  if (error && !inviteData) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-[var(--bg)] font-['Inter',sans-serif]">
        <Card className="max-w-md w-full p-8 text-center space-y-4">
          <div className="w-12 h-12 rounded-full bg-rose-500/10 text-rose-500 flex items-center justify-center mx-auto">
            <AlertCircle className="w-6 h-6" />
          </div>
          <h2 className="text-xl font-bold text-[var(--text)]">Invitation Expired or Invalid</h2>
          <p className="text-xs text-[var(--muted)] leading-relaxed">
            {error}
          </p>
          <div className="pt-2">
            <Link to="/portal-access">
              <Button variant="primary" size="md" className="w-full">
                Return to Workplace Portal
              </Button>
            </Link>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col justify-center py-12 px-4 sm:px-6 lg:px-8 bg-[var(--bg)] font-['Inter',sans-serif]">
      <div className="sm:mx-auto sm:w-full sm:max-w-md space-y-6">
        {/* Brand Header */}
        <div className="text-center space-y-2">
          <div className="w-12 h-12 rounded-xl bg-[var(--primary)] flex items-center justify-center text-white font-bold text-xl mx-auto shadow-sm">
            <Clock className="w-6 h-6" />
          </div>
          <div className="text-[11px] font-bold uppercase tracking-wider text-[var(--primary)]">
            SimpleHours Workforce
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--text)]">
            Join {inviteData?.location_name}
          </h1>
          <p className="text-xs text-[var(--muted)]">
            {inviteData?.org_name} has invited you as a <strong className="text-[var(--text)] uppercase">{inviteData?.role}</strong>
          </p>
        </div>

        {/* Location Invite Card */}
        <Card className="p-8 space-y-6">
          {/* Location Summary Strip */}
          <div className="p-3.5 bg-[var(--panel-subtle)] border border-[var(--border)] rounded-xl flex items-center justify-between text-xs">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-[var(--primary-light)] text-[var(--primary)] flex items-center justify-center">
                <MapPin className="w-4 h-4" />
              </div>
              <div>
                <div className="font-bold text-[var(--text)]">{inviteData?.location_name}</div>
                <div className="text-[11px] text-[var(--muted)]">{inviteData?.org_name}</div>
              </div>
            </div>
            <Badge variant="purple" size="sm">
              {inviteData?.role === 'manager' ? 'Location Manager' : inviteData?.role}
            </Badge>
          </div>

          {error && (
            <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-xs text-rose-500 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              label="Assigned Email Address"
              type="email"
              value={inviteData?.email || ''}
              disabled
              leftIcon={<Mail className="w-4 h-4" />}
              className="opacity-75 cursor-not-allowed bg-[var(--input-bg)]"
            />

            {!inviteData?.user_exists ? (
              <>
                <Input
                  label="Your Full Name *"
                  type="text"
                  placeholder="e.g. Sarah Jenkins"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  required
                  autoFocus
                  leftIcon={<User className="w-4 h-4" />}
                />

                <Input
                  label="Create Secure Password *"
                  type="password"
                  placeholder="At least 8 characters"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  leftIcon={<Lock className="w-4 h-4" />}
                />

                <Input
                  label="Confirm Password *"
                  type="password"
                  placeholder="Repeat your password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  leftIcon={<Lock className="w-4 h-4" />}
                />
              </>
            ) : (
              <div>
                <p className="text-xs text-[var(--muted)] leading-relaxed">
                  You already have a SimpleHours account for this email. Make sure you are signed in to that account in this browser, then accept to join <strong>{inviteData.location_name}</strong>.
                </p>
              </div>
            )}

            <div className="pt-2">
              <Button
                type="submit"
                variant="primary"
                size="md"
                className="w-full"
                loading={submitting}
                rightIcon={<ArrowRight className="w-4 h-4" />}
              >
                Accept & Launch Workspace
              </Button>
            </div>
          </form>

          <div className="pt-3 border-t border-[var(--border)] flex items-center justify-center gap-1.5 text-xs text-[var(--muted)]">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
            <span>Strict multi-location security enforced</span>
          </div>
        </Card>
      </div>
    </div>
  );
}
