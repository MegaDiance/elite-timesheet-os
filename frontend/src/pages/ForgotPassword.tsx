import React, { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import api from '../services/apiClient';
import { portalLoginPath } from '../services/portal';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Clock, ArrowLeft, Mail, AlertCircle, CheckCircle2 } from 'lucide-react';

const SLUG_RE = /^[a-z0-9-]{1,64}$/;

export default function ForgotPassword() {
  // The portal this was opened from (/login/:slug → "Forgot password?"), so the emailed link
  // brings the user back to that organisation's sign-in page. There is no generic sign-in page.
  const [searchParams] = useSearchParams();
  const orgParam = searchParams.get('org') || '';
  const org = SLUG_RE.test(orgParam) ? orgParam : null;
  const backTo = org ? `/login/${org}` : portalLoginPath();
  const backLabel = backTo === '/' ? 'Back to the home page' : 'Back to sign in';
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus('loading');

    try {
      const res = await api.post('/auth/forgot-password', { email: email.trim(), ...(org ? { organisation_slug: org } : {}) });
      // The same answer whether or not the email has an account. The server's own wording is
      // shown, because while email is turned off it explains how to get a reset link instead.
      setStatus('success');
      setMessage(res.data?.message || 'If an account exists for that email, we\u2019ve sent it a link to reset the password.');
    } catch (err: any) {
      setStatus('error');
      setMessage(err.response?.data?.error?.message || 'We couldn\u2019t send a reset link right now. Please try again.');
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-[var(--bg)] text-[var(--text)] p-4">
      <div className="w-full max-w-md space-y-6">
        {/* Brand Header */}
        <div className="text-center space-y-2">
          <div className="w-10 h-10 rounded-xl bg-[var(--primary-light)] text-[var(--primary)] flex items-center justify-center mx-auto">
            <Clock className="w-5 h-5" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--text)]">
            Reset Password
          </h1>
          <p className="text-xs text-[var(--muted)]">
            Enter your email and we'll send you a link to reset your password
          </p>
        </div>

        <Card className="p-6 sm:p-8 space-y-5">
          {status === 'success' ? (
            <div className="space-y-4">
              <div className="p-4 rounded-lg bg-[var(--success-light)] border border-[var(--success)]/25 text-[var(--success)] text-xs font-medium leading-relaxed text-center flex items-center gap-2 justify-center">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>{message}</span>
              </div>
              <p className="text-xs text-[var(--muted)] text-center leading-relaxed">
                The link works once and expires in 1 hour. Check your spam folder if it doesn't arrive.
              </p>
              <Link to={backTo} className="block">
                <Button variant="primary" size="md" className="w-full">
                  {backLabel}
                </Button>
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <Input
                label="Email"
                type="email"
                required
                placeholder="you@example.com.au"
                value={email}
                onChange={e => setEmail(e.target.value)}
                leftIcon={<Mail className="w-4 h-4 text-[var(--muted)]" />}
              />

              {status === 'error' && (
                <div className="p-3 rounded-lg bg-[var(--danger-light)] border border-[var(--danger)]/25 text-[var(--danger)] text-xs flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{message}</span>
                </div>
              )}

              <Button
                type="submit"
                variant="primary"
                size="md"
                className="w-full"
                loading={status === 'loading'}
              >
                Send reset link
              </Button>

              <div className="text-center pt-2">
                <Link
                  to={backTo}
                  className="inline-flex items-center gap-1.5 text-xs text-[var(--muted)] hover:text-[var(--text)] transition-colors"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>{backLabel}</span>
                </Link>
              </div>
            </form>
          )}
        </Card>
      </div>
    </div>
  );
}
