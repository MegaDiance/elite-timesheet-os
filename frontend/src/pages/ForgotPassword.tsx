import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../services/apiClient';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Clock, ArrowLeft, Mail, AlertCircle, CheckCircle2 } from 'lucide-react';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const [deliveryNotice, setDeliveryNotice] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus('loading');
    setDeliveryNotice('');
    
    try {
      const response = await api.post('/auth/forgot-password', { email });
      setStatus('success');
      setMessage(response.data.message || 'If an account exists, a reset link was sent.');
      if (response.data.delivery_notice) {
        setDeliveryNotice(response.data.delivery_notice);
      }
    } catch (err: any) {
      setStatus('error');
      setMessage(err.response?.data?.error || err.response?.data?.error?.message || 'An error occurred while requesting password reset.');
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
            Enter your account email to receive a password recovery link
          </p>
        </div>

        <Card className="p-6 sm:p-8 space-y-5">
          {status === 'success' ? (
            <div className="space-y-4">
              <div className="p-4 rounded-lg bg-[var(--success-light)] border border-[var(--success)]/25 text-[var(--success)] text-xs font-medium leading-relaxed text-center flex items-center gap-2 justify-center">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>{message}</span>
              </div>
              {deliveryNotice && (
                <div className="p-3 rounded-lg bg-[var(--primary-light)] border border-[var(--primary)]/20 text-[var(--text)] text-xs font-medium text-center">
                  {deliveryNotice}
                </div>
              )}
              <p className="text-xs text-[var(--muted)] text-center leading-relaxed">
                Check your inbox for the reset link. It expires in 1 hour.
              </p>
              <Link to="/login" className="block">
                <Button variant="primary" size="md" className="w-full">
                  Return to Sign In
                </Button>
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <Input
                label="Account Email Address"
                type="email"
                required
                placeholder="name@company.com"
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
                Send Password Reset Link
              </Button>

              <div className="text-center pt-2">
                <Link
                  to="/login"
                  className="inline-flex items-center gap-1.5 text-xs text-[var(--muted)] hover:text-[var(--text)] transition-colors"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>Back to Sign In</span>
                </Link>
              </div>
            </form>
          )}
        </Card>
      </div>
    </div>
  );
}
