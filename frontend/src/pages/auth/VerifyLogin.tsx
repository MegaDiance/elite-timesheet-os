import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import api from '../../services/apiClient';
import { 
  ShieldAlert, 
  CheckCircle2, 
  AlertCircle, 
  ArrowRight, 
  Mail, 
  KeyRound, 
  Clock, 
  ArrowLeft 
} from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Card } from '../../components/ui/Card';

export default function VerifyLogin() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const queryToken = searchParams.get('token') || '';
  const queryEmail = searchParams.get('email') || '';

  const [email, setEmail] = useState(queryEmail);
  const [token, setToken] = useState(queryToken);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (queryEmail) setEmail(queryEmail);
    if (queryToken) setToken(queryToken);
  }, [queryEmail, queryToken]);

  const handleVerify = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!email.trim() || !token.trim()) {
      setError('Please provide both your email address and the security verification token.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await api.post('/auth/verify-login', {
        email: email.trim(),
        token: token.trim(),
      });

      if (res.data?.success && res.data?.data?.token) {
        setSuccess(true);
        const { token: sessionToken, user } = res.data.data;
        localStorage.setItem('token', sessionToken);
        localStorage.setItem('user', JSON.stringify(user));
        localStorage.setItem('session_last_active', Date.now().toString());
        if (user.organisation_id) {
          localStorage.setItem('current_org_id', user.organisation_id);
        }
        window.dispatchEvent(new Event('auth-change'));

        setTimeout(() => {
          navigate('/app');
        }, 1200);
      } else {
        setError(res.data?.error?.message || 'Verification failed. Please try again.');
      }
    } catch (err: any) {
      const msg = err.response?.data?.error?.message || 'Invalid or expired verification challenge. Please sign in again.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col justify-center py-12 px-4 sm:px-6 lg:px-8 bg-[var(--bg)] text-[var(--text)]">
      <div className="sm:mx-auto sm:w-full sm:max-w-md space-y-6">
        {/* Brand Header */}
        <div className="text-center space-y-2">
          <Link to="/" className="inline-flex items-center gap-2 group">
            <div className="w-10 h-10 rounded-lg bg-indigo-600 flex items-center justify-center text-white shadow-sm group-hover:bg-indigo-500 transition-colors">
              <Clock className="w-5 h-5" />
            </div>
          </Link>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--text)]">
            Security Verification
          </h1>
          <p className="text-xs text-[var(--muted)]">
            Confirm your identity for an unrecognised sign-in attempt
          </p>
        </div>

        <Card className="p-8 shadow-sm space-y-5">
          {success ? (
            <div className="text-center py-6 space-y-3">
              <div className="w-12 h-12 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-6 h-6" />
              </div>
              <h3 className="text-base font-bold text-[var(--text)]">Identity Verified</h3>
              <p className="text-xs text-[var(--muted)]">
                Your sign-in has been securely authorized. Redirecting to your workspace...
              </p>
            </div>
          ) : (
            <>
              <div className="p-3.5 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-start gap-3">
                <ShieldAlert className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                <div className="text-xs text-[var(--text)] space-y-1">
                  <div className="font-semibold text-amber-400">Suspicious Login Challenge</div>
                  <p className="text-[var(--muted)] leading-relaxed">
                    We detected a sign-in from a new device, network, or location. Please confirm your security authorization token sent to your email.
                  </p>
                </div>
              </div>

              {error && (
                <div className="bg-rose-500/10 border border-rose-500/20 text-rose-500 p-3 rounded-md text-xs flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}

              <form onSubmit={handleVerify} className="space-y-4">
                <Input
                  label="Work Email Address"
                  type="email"
                  required
                  placeholder="you@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  leftIcon={<Mail className="w-4 h-4" />}
                />

                <Input
                  label="Verification Token / Code"
                  type="text"
                  required
                  placeholder="Enter token received via email"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  leftIcon={<KeyRound className="w-4 h-4" />}
                  className="font-mono text-sm"
                />

                <Button
                  type="submit"
                  variant="primary"
                  size="md"
                  className="w-full"
                  loading={loading}
                  rightIcon={<ArrowRight className="w-4 h-4" />}
                >
                  Verify & Sign In
                </Button>
              </form>

              <div className="pt-2 flex items-center justify-between text-xs border-t border-[var(--border)]">
                <Link
                  to="/login"
                  className="text-[var(--muted)] hover:text-[var(--text)] inline-flex items-center gap-1"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>Back to Sign In</span>
                </Link>
                <Link
                  to="/portal-access"
                  className="text-indigo-400 hover:underline"
                >
                  Workplace Access
                </Link>
              </div>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
