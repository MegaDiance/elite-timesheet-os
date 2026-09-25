import React, { useState, useEffect } from 'react';
import api from '../../services/apiClient';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Badge } from '../ui/Badge';
import { ShieldCheck, ShieldAlert, KeyRound, AlertCircle, CheckCircle2 } from 'lucide-react';
import { friendlyError } from '../../services/errors';

interface TwoFactorModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Called after two-step verification is turned on or off. */
  onChange?: (enabled: boolean) => void;
}

export const TwoFactorModal: React.FC<TwoFactorModalProps> = ({ isOpen, onClose, onChange }) => {
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
        setMessage({ text: 'We have emailed you a 6-digit code.', type: 'success' });
      } else {
        setMessage({ text: res.data?.error?.message || 'The code could not be sent.', type: 'error' });
      }
    } catch (err: any) {
      setMessage({ text: friendlyError(err, 'The code could not be sent.'), type: 'error' });
    } finally {
      setActionLoading(false);
    }
  };

  const handleConfirmEnable = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!otpCode || otpCode.length !== 6 || !password) {
      setMessage({ text: 'Enter the 6-digit code and your password.', type: 'error' });
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
        setMessage({ text: 'Two-step verification is now on for your account.', type: 'success' });
        onChange?.(true);
      } else {
        setMessage({ text: res.data?.error?.message || 'Verification failed.', type: 'error' });
      }
    } catch (err: any) {
      setMessage({ text: friendlyError(err, 'Two-step verification could not be turned on. Check the code and your password.'), type: 'error' });
    } finally {
      setActionLoading(false);
    }
  };

  const handleConfirmDisable = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) {
      setMessage({ text: 'Enter your password to turn off two-step verification.', type: 'error' });
      return;
    }

    setActionLoading(true);
    setMessage(null);

    try {
      const res = await api.post('/auth/2fa/disable', { password });
      if (res.data?.success) {
        setIsEnabled(false);
        setStep('status');
        setMessage({ text: 'Two-step verification has been turned off.', type: 'success' });
        onChange?.(false);
      } else {
        setMessage({ text: res.data?.error?.message || 'Two-step verification could not be turned off.', type: 'error' });
      }
    } catch (err: any) {
      setMessage({ text: friendlyError(err, 'Incorrect password.'), type: 'error' });
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Two-step verification"
      description="Protect your SimpleHours account with a code emailed to you each time you sign in."
      maxWidth="md"
    >
      {loading ? (
        <div className="py-8 text-center text-xs text-[var(--muted)]">Checking your settings…</div>
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
                      {isEnabled ? 'Two-step verification is on' : 'Two-step verification is off'}
                    </div>
                    <div className="text-xs text-[var(--muted)]">
                      {isEnabled
                        ? 'A 6-digit code is emailed to you each time you sign in.'
                        : 'Your account is protected by your password only.'}
                    </div>
                  </div>
                </div>
                <Badge variant={isEnabled ? 'success' : 'warning'} size="sm">
                  {isEnabled ? 'On' : 'Off'}
                </Badge>
              </div>

              <div className="flex justify-end gap-2.5 pt-2">
                {isEnabled ? (
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => { setStep('disable'); setMessage(null); setPassword(''); }}
                  >
                    Turn off
                  </Button>
                ) : (
                  <Button
                    variant="primary"
                    size="sm"
                    loading={actionLoading}
                    onClick={handleStartSetup}
                    leftIcon={<KeyRound className="w-4 h-4" />}
                  >
                    Turn on
                  </Button>
                )}
              </div>
            </div>
          )}

          {step === 'setup' && (
            <form onSubmit={handleConfirmEnable} className="space-y-4">
              <div className="bg-[var(--panel-subtle)] p-3 rounded-md border border-[var(--border)] text-xs text-[var(--muted)]">
                Enter the 6-digit code we emailed you and your password to finish turning it on.
              </div>

              <Input
                label="6-digit code"
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
                label="Your password"
                type="password"
                placeholder="Your current password"
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
                  Turn on
                </Button>
              </div>
            </form>
          )}

          {step === 'disable' && (
            <form onSubmit={handleConfirmDisable} className="space-y-4">
              <div className="bg-rose-500/10 border border-rose-500/20 p-3 rounded-md text-xs text-rose-500">
                Without two-step verification, only your password is needed to sign in.
              </div>

              <Input
                label="Your password"
                type="password"
                placeholder="Confirm your password"
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
                  Turn off
                </Button>
              </div>
            </form>
          )}
        </div>
      )}
    </Modal>
  );
};
