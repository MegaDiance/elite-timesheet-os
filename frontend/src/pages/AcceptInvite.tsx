import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import api from '../services/apiClient';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Clock, ShieldCheck, AlertCircle } from 'lucide-react';

export default function AcceptInvite() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const navigate = useNavigate();
  
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [status, setStatus] = useState<'validating' | 'idle' | 'loading' | 'error'>('validating');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!token) {
      setStatus('error');
      setMessage('Invalid or missing invitation token. Please check your invitation link.');
      return;
    }

    api.get(`/auth/invitation?token=${token}`)
      .then(res => {
        if (res.data?.data?.email) {
          setEmail(res.data.data.email);
          setStatus('idle');
        } else {
          setStatus('error');
          setMessage('Unable to read email from invitation.');
        }
      })
      .catch(err => {
        setStatus('error');
        setMessage(err.response?.data?.error || 'Invalid or expired invitation token.');
      });
  }, [token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) {
      setStatus('error');
      setMessage('Password must be at least 8 characters long.');
      return;
    }

    if (password !== confirmPassword) {
      setStatus('error');
      setMessage('Passwords do not match.');
      return;
    }

    setStatus('loading');
    
    try {
      await api.post('/auth/claim-invitation', { token, password });
      navigate('/login?setup=success');
    } catch (err: any) {
      setStatus('error');
      setMessage(err.response?.data?.error || 'Failed to complete setup. Please try again.');
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
            Simple Hours
          </h1>
          <p className="text-xs text-[var(--muted)]">
            Set up your account password to join your organisation
          </p>
        </div>

        <Card className="p-6 sm:p-8 space-y-5">
          {status === 'validating' ? (
            <div className="py-8 text-center text-xs text-[var(--muted)] flex items-center justify-center gap-2">
              <Clock className="w-4 h-4 animate-spin text-[var(--primary)]" />
              <span>Validating invitation token...</span>
            </div>
          ) : status === 'error' && !email ? (
            <div className="space-y-4">
              <div className="p-3.5 rounded-lg bg-[var(--danger-light)] border border-[var(--danger)]/25 text-[var(--danger)] text-xs flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{message}</span>
              </div>
              <Link to="/portal-access" className="block">
                <Button variant="secondary" size="md" className="w-full">
                  Return to Sign In
                </Button>
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-[var(--text)] mb-1">
                  Email Address
                </label>
                <input 
                  type="email" 
                  disabled 
                  value={email}
                  className="w-full px-3.5 py-2 bg-[var(--panel-subtle)] border border-[var(--border)] rounded-lg text-[var(--muted)] text-sm cursor-not-allowed"
                />
              </div>

              <div>
                <Input
                  label="Create Password"
                  type="password"
                  required
                  placeholder="At least 8 characters"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  helperText="Minimum 8 characters with letters and numbers"
                />
              </div>

              <div>
                <Input
                  label="Confirm Password"
                  type="password"
                  required
                  placeholder="Re-enter password"
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                />
              </div>

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
                Complete Account Setup
              </Button>
            </form>
          )}
        </Card>

        <div className="text-center text-xs text-[var(--muted)] flex items-center justify-center gap-1.5">
          <ShieldCheck className="w-4 h-4 text-[var(--success)]" />
          <span>Encrypted Account Credential Setup</span>
        </div>
      </div>
    </div>
  );
}
