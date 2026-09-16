import React, { useState, useEffect } from 'react';
import api from '../../services/apiClient';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Badge } from '../ui/Badge';
import { ShieldCheck, ShieldAlert, KeyRound, AlertCircle, CheckCircle2 } from 'lucide-react';

interface TwoFactorModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const TwoFactorModal: React.FC<TwoFactorModalProps> = ({ isOpen, onClose }) => {
  const [isEnabled, setIsEnabled] = useState(false);
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<'status' | 'setup' | 'disable'>('status');
  
  // Setup inputs
  const [otpCode, setOtpCode] = useState('');
  const [password, setPassword] = useState('');
  
  // Feedback
  const [actionLoading, setActionLoading] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  useEffect(() => {
    if (isOpen) {
      fetch2FAStatus();
      setStep('status');
      setMessage(null);
      setOtpCode('');
      setPassword('');
    }
  }, [isOpen]);

  const fetch2FAStatus = async () => {
    setLoading(true);
    try {
      const res = await api.get('/auth/2fa/status');
      if (res.data?.success) {
        setIsEnabled(Boolean(res.data.data?.enabled));
      }
    } catch (err) {
      console.warn('Failed to load 2FA status:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleStartSetup = async () => {
    setActionLoading(true);
    setMessage(null);
    try {
      const res = await api.post('/auth/2fa/send-setup-code');
      if (res.data?.success) {
        setStep('setup');
        setMessage({ text: 'A 6-digit verification code has been dispatched to your email.', type: 'success' });
      } else {
        setMessage({ text: res.data?.error?.message || 'Failed to dispatch code.', type: 'error' });
      }
    } catch (err: any) {
      setMessage({ text: err.response?.data?.error?.message || 'Failed to dispatch setup code.', type: 'error' });
    } finally {
      setActionLoading(false);
    }
  };

  const handleConfirmEnable = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!otpCode || otpCode.length !== 6 || !password) {
      setMessage({ text: 'Please provide both the 6-digit code and your current password.', type: 'error' });
      return;
    }

    setActionLoading(true);
    setMessage(null);

    try {
      const res = await api.post('/auth/2fa/enable', {
        code: otpCode.trim(),
        password,
      });

      if (res.data?.success) {
        setIsEnabled(true);
        setStep('status');
        setMessage({ text: 'Two-Factor Authentication is now active on your account.', type: 'success' });
      } else {
        setMessage({ text: res.data?.error?.message || 'Verification failed.', type: 'error' });
      }
    } catch (err: any) {
      setMessage({ text: err.response?.data?.error?.message || 'Failed to activate 2FA. Code or password may be invalid.', type: 'error' });
    } finally {
      setActionLoading(false);
    }
  };

  const handleConfirmDisable = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) {
      setMessage({ text: 'Password is required to disable 2FA.', type: 'error' });
      return;
    }

    setActionLoading(true);
    setMessage(null);

    try {
      const res = await api.post('/auth/2fa/disable', { password });
      if (res.data?.success) {
        setIsEnabled(false);
        setStep('status');
        setMessage({ text: 'Two-Factor Authentication has been disabled.', type: 'success' });
      } else {
        setMessage({ text: res.data?.error?.message || 'Failed to disable 2FA.', type: 'error' });
      }
    } catch (err: any) {
      setMessage({ text: err.response?.data?.error?.message || 'Incorrect password.', type: 'error' });
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Two-Step Verification (2FA)"
      description="Protect your timesheet account and identity with an email verification code required on sign-in."
      maxWidth="md"
    >
      {loading ? (
        <div className="py-8 text-center text-xs text-[var(--muted)]">Checking security status...</div>
      ) : (
        <div className="space-y-5">
          {message && (
            <div
              className={`p-3 rounded-md text-xs flex items-center gap-2 ${
                message.type === 'success'
                  ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-500'
                  : 'bg-rose-500/10 border border-rose-500/20 text-rose-500'
              }`}
            >
              {message.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 shrink-0" />
              ) : (
                <AlertCircle className="w-4 h-4 shrink-0" />
              )}
              <span>{message.text}</span>
            </div>
          )}

          {step === 'status' && (
            <div className="space-y-4">
              <div className="p-4 rounded-lg bg-[var(--panel-subtle)] border border-[var(--border)] flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div
                    className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                      isEnabled ? 'bg-emerald-500/10 text-emerald-500' : 'bg-amber-500/10 text-amber-500'
                    }`}
                  >
                    {isEnabled ? <ShieldCheck className="w-5 h-5" /> : <ShieldAlert className="w-5 h-5" />}
                  </div>
                  <div>
                    <div className="font-semibold text-sm text-[var(--text)]">
                      {isEnabled ? 'Two-Factor is Active' : 'Two-Factor is Disabled'}
                    </div>
                    <div className="text-xs text-[var(--muted)]">
                      {isEnabled
                        ? 'A 6-digit OTP code will be sent to your work email on sign-in.'
                        : 'Your account is currently protected by password only.'}
                    </div>
                  </div>
                </div>
                <Badge variant={isEnabled ? 'success' : 'warning'} size="sm">
                  {isEnabled ? 'Active' : 'Off'}
                </Badge>
              </div>

              <div className="flex justify-end gap-2.5 pt-2">
                {isEnabled ? (
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => { setStep('disable'); setMessage(null); setPassword(''); }}
                  >
                    Disable 2FA
                  </Button>
                ) : (
                  <Button
                    variant="primary"
                    size="sm"
                    loading={actionLoading}
                    onClick={handleStartSetup}
                    leftIcon={<KeyRound className="w-4 h-4" />}
                  >
                    Enable 2FA Protection
                  </Button>
                )}
              </div>
            </div>
          )}

          {step === 'setup' && (
            <form onSubmit={handleConfirmEnable} className="space-y-4">
              <div className="bg-[var(--panel-subtle)] p-3 rounded-md border border-[var(--border)] text-xs text-[var(--muted)]">
                We sent a 6-digit verification code to your email. Enter it below and verify your password to complete activation.
              </div>

              <Input
                label="6-Digit Verification Code"
                type="text"
                placeholder="123456"
                value={otpCode}
                onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                maxLength={6}
                required
                autoFocus
                className="text-center font-mono tracking-widest text-base"
              />

              <Input
                label="Confirm Account Password"
                type="password"
                placeholder="Your current account password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />

              <div className="flex justify-between items-center pt-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => { setStep('status'); setMessage(null); }}
                >
                  Cancel
                </Button>
                <Button type="submit" variant="primary" size="sm" loading={actionLoading}>
                  Confirm & Activate
                </Button>
              </div>
            </form>
          )}

          {step === 'disable' && (
            <form onSubmit={handleConfirmDisable} className="space-y-4">
              <div className="bg-rose-500/10 border border-rose-500/20 p-3 rounded-md text-xs text-rose-500">
                Warning: Disabling 2FA reduces account security. You will only need a password to sign in.
              </div>

              <Input
                label="Account Password"
                type="password"
                placeholder="Confirm your password to turn off 2FA"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoFocus
              />

              <div className="flex justify-between items-center pt-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => { setStep('status'); setMessage(null); }}
                >
                  Cancel
                </Button>
                <Button type="submit" variant="danger" size="sm" loading={actionLoading}>
                  Confirm Disable
                </Button>
              </div>
            </form>
          )}
        </div>
      )}
    </Modal>
  );
};
