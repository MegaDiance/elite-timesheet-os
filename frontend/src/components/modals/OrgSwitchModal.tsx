import React, { useEffect, useRef, useState, type FormEvent } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Check, ArrowRight, KeyRound } from 'lucide-react';
import api from '../../services/apiClient';
import { errorCode, friendlyError } from '../../services/errors';
import { storeSession } from '../../hooks/useAccess';
import { forgetActiveBranches } from '../../hooks/useActiveBranch';

/** One entry of GET /auth/organisations. */
interface OrganisationChoice {
  id: string;
  name: string;
  roles: string[];
  is_current: boolean;
}

interface OrgSwitchModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type Step = 'password' | 'choose';

/**
 * Switching organisation is a sensitive step, so it is two steps:
 *   1. only a password field. Nothing about other organisations is fetched or shown until the
 *      server has accepted the password (POST /auth/reauthenticate, valid for a few minutes);
 *   2. the list (GET /auth/organisations), then POST /auth/switch-organisation.
 * If the server says the re-entry has expired (REAUTH_REQUIRED) we go back to step 1. On success
 * the new session is stored and the whole app reloads, so no React state or cached data from the
 * previous organisation survives. The password lives only in the input's state: it is cleared as
 * soon as it has been sent, and everything is discarded when the modal closes.
 */
export const OrgSwitchModal: React.FC<OrgSwitchModalProps> = (props) => (props.isOpen ? <OpenOrgSwitchModal {...props} /> : null);

function OpenOrgSwitchModal({ onClose }: OrgSwitchModalProps) {
  const [step, setStep] = useState<Step>('password');
  const [password, setPassword] = useState('');
  const [organisations, setOrganisations] = useState<OrganisationChoice[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const passwordRef = useRef<HTMLInputElement>(null);

  // Back on the password step (after a wrong password or an expired re-entry): put the cursor in the field.
  useEffect(() => {
    if (step === 'password' && !busy) passwordRef.current?.focus();
  }, [step, error, note, busy]);

  const backToPassword = (message: string) => {
    setOrganisations([]);
    setStep('password');
    setNote(message);
    setError('');
  };

  const loadOrganisations = async () => {
    try {
      const res = await api.get('/auth/organisations');
      const list = res.data?.data;
      setOrganisations(Array.isArray(list) ? list : []);
      setStep('choose');
    } catch (err) {
      if (errorCode(err) === 'REAUTH_REQUIRED') backToPassword('For your security, please enter your password again.');
      else setError(friendlyError(err, 'Could not load your organisations. Please try again.'));
    }
  };

  const submitPassword = async (e: FormEvent) => {
    e.preventDefault();
    if (!password || busy) return;
    setBusy(true);
    setError('');
    setNote('');
    const attempt = password;
    // The password is sent once and not kept: the field is emptied right away, whatever the outcome.
    setPassword('');
    try {
      await api.post('/auth/reauthenticate', { password: attempt });
    } catch (err) {
      // A wrong password says only that it is not correct (the server's own words); a 429 says to wait.
      setError(friendlyError(err, 'Could not check your password. Please try again.'));
      setBusy(false);
      return;
    }
    await loadOrganisations();
    setBusy(false);
  };

  const switchTo = async (orgId: string) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const res = await api.post('/auth/switch-organisation', { organisation_id: orgId });
      const token = res.data?.data?.token;
      if (!token) throw new Error('No session returned');
      storeSession(token, res.data?.data?.portal_path);
      forgetActiveBranches();
      // A full page load, so nothing from the previous organisation stays in memory.
      window.location.assign('/app');
    } catch (err) {
      if (errorCode(err) === 'REAUTH_REQUIRED') backToPassword('For your security, please enter your password again.');
      else setError(friendlyError(err, 'Could not switch organisation. Please try again.'));
      setBusy(false);
    }
  };

  const close = () => {
    setPassword('');
    setOrganisations([]);
    onClose();
  };

  return (
    <Modal
      isOpen
      onClose={close}
      title="Switch organisation"
      description={step === 'password' ? 'Enter your password to switch organisation.' : 'Choose the organisation you want to work in.'}
      maxWidth="md"
    >
      {step === 'password' ? (
        <form onSubmit={submitPassword} className="space-y-4" noValidate>
          {note && <p role="status" className="text-sm text-[var(--muted)]">{note}</p>}
          <div>
            <label htmlFor="org-switch-password" className="block text-xs font-semibold text-[var(--muted)] uppercase tracking-wider mb-1.5">
              Your password
            </label>
            <div className="relative flex items-center">
              <KeyRound className="absolute left-3 w-4 h-4 text-[var(--muted)] pointer-events-none" aria-hidden="true" />
              <input
                id="org-switch-password"
                ref={passwordRef}
                type="password"
                autoComplete="current-password"
                autoFocus
                value={password}
                onChange={e => setPassword(e.target.value)}
                disabled={busy}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? 'org-switch-error' : undefined}
                className={`w-full text-sm bg-[var(--input-bg)] text-[var(--text)] border ${error ? 'border-rose-500' : 'border-[var(--border)]'} rounded-md pl-9 pr-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 disabled:opacity-50`}
              />
            </div>
            {error && <p id="org-switch-error" role="alert" className="mt-1.5 text-sm text-rose-500 font-medium">{error}</p>}
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={close}>Cancel</Button>
            <Button type="submit" size="sm" loading={busy} disabled={!password}>Continue</Button>
          </div>
        </form>
      ) : (
        <div className="space-y-3">
          {error && <p role="alert" className="text-sm text-rose-500 font-medium">{error}</p>}
          <div className="divide-y divide-[var(--border)] border border-[var(--border)] rounded-lg overflow-hidden">
            {organisations.map((org) => (
              <button
                key={org.id}
                type="button"
                disabled={org.is_current || busy}
                onClick={() => switchTo(org.id)}
                className={`w-full p-3.5 flex items-center justify-between gap-3 text-left transition-colors ${
                  org.is_current ? 'bg-[var(--panel-subtle)]/70 cursor-default' : 'hover:bg-[var(--hover-row)] cursor-pointer disabled:opacity-60'
                }`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-8 h-8 rounded bg-[var(--panel-subtle)] border border-[var(--border)] flex items-center justify-center text-xs font-bold text-[var(--text)] shrink-0">
                    {org.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-[var(--text)] flex items-center gap-2">
                      <span className="truncate">{org.name}</span>
                      {org.is_current && (
                        <span className="text-[10px] font-semibold text-[var(--success)] bg-[var(--success-light)] px-1.5 rounded border border-[var(--success)]/20 shrink-0">
                          Current
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-[var(--muted)]">{org.roles.join(', ')}</div>
                  </div>
                </div>

                {org.is_current ? (
                  <span className="w-6 h-6 rounded-full bg-[var(--success-light)] text-[var(--success)] flex items-center justify-center shrink-0">
                    <Check className="w-3.5 h-3.5" aria-hidden="true" />
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-[var(--primary-text)] shrink-0">
                    Switch <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
                  </span>
                )}
              </button>
            ))}
          </div>

          <div className="flex justify-end pt-2">
            <Button variant="ghost" size="sm" onClick={close} disabled={busy}>Close</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
