import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Mail, ArrowRight, AlertCircle, CheckCircle2, Clock, ArrowLeft } from 'lucide-react';
import api from '../../services/apiClient';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Card } from '../../components/ui/Card';

/**
 * First step of setting up an organisation: we email a single-use setup link. The response is the
 * same whether or not the address already has an account.
 */
export default function SignUp() {
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) {
      setError('Enter a valid email address.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await api.post('/signup/request', { email: clean });
      setSentTo(clean);
    } catch (err: any) {
      setError(err.response?.data?.error?.message || 'We couldn’t send your setup link. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col justify-center py-12 px-4 sm:px-6 lg:px-8 bg-[var(--bg)] text-[var(--text)]">
      <div className="sm:mx-auto sm:w-full sm:max-w-md space-y-6">
        <div className="text-center space-y-2">
          <Link to="/" className="inline-flex" aria-label="SimpleHours home">
            <div className="w-12 h-12 rounded-xl bg-[var(--primary)] flex items-center justify-center text-white mx-auto shadow-sm">
              <Clock className="w-6 h-6" />
            </div>
          </Link>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--text)]">Set up your organisation</h1>
          <p className="text-xs text-[var(--muted)]">
            You'll be the Organisation Owner. You can add branches and invite Branch Admins once you're set up.
          </p>
        </div>

        <Card className="p-8 space-y-5">
          {sentTo ? (
            <div className="text-center space-y-4 py-2">
              <div className="w-12 h-12 rounded-full bg-[var(--success-light)] text-[var(--success)] flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-6 h-6" />
              </div>
              <h2 className="text-base font-bold text-[var(--text)]">Check your email</h2>
              <p className="text-xs text-[var(--muted)] leading-relaxed">
                Check your email for a link to set up your organisation. We sent it to{' '}
                <strong className="text-[var(--text)]">{sentTo}</strong>. The link works once and expires in 24 hours.
              </p>
              <button
                type="button"
                onClick={() => setSentTo(null)}
                className="text-xs text-[var(--primary)] hover:underline"
              >
                Use a different email
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4" noValidate>
              {error && (
                <div role="alert" className="p-3 rounded-md bg-[var(--danger-light)] border border-[var(--danger)]/25 text-xs text-[var(--danger)] flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}
              <Input
                label="Your email"
                type="email"
                autoComplete="email"
                placeholder="you@example.com.au"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
                leftIcon={<Mail className="w-4 h-4" />}
              />
              <Button type="submit" variant="primary" size="md" className="w-full" loading={submitting} rightIcon={<ArrowRight className="w-4 h-4" />}>
                Email me a setup link
              </Button>
            </form>
          )}
        </Card>

        <div className="text-center text-xs text-[var(--muted)] space-y-2">
          <p>
            Already use SimpleHours?{' '}
            <Link to="/login" className="font-semibold text-[var(--primary)] hover:underline">Sign in</Link>
          </p>
          <Link to="/" className="inline-flex items-center gap-1 hover:text-[var(--text)]">
            <ArrowLeft className="w-3.5 h-3.5" /> Back to home
          </Link>
        </div>
      </div>
    </div>
  );
}
