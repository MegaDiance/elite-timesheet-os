import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Lock } from 'lucide-react';
import api from '../../services/apiClient';
import { onPasswordRequested } from '../../services/reauth';
import { Modal } from '../ui/Modal';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';

/** Asks for the account password when the server needs it again before a sensitive change. */
export function ReauthPrompt() {
  const [pending, setPending] = useState<{ message: string; resolve: (ok: boolean) => void } | null>(null);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Whatever is waiting is answered "no" if the prompt goes away (e.g. sign-out), so nothing hangs.
  const pendingRef = useRef<{ resolve: (ok: boolean) => void } | null>(null);
  useEffect(() => { pendingRef.current = pending; }, [pending]);

  useEffect(() => {
    onPasswordRequested(next => {
      setPassword('');
      setError(null);
      setPending(next);
    });
    return () => {
      onPasswordRequested(null);
      pendingRef.current?.resolve(false);
    };
  }, []);

  const finish = (ok: boolean) => {
    pending?.resolve(ok);
    setPending(null);
    setPassword('');
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!password) {
      setError('Enter your password.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.post('/auth/reauthenticate', { password });
      finish(true);
    } catch (err: any) {
      setPassword('');
      setError(err?.response?.status === 429
        ? 'Too many attempts. Please wait a while before trying again.'
        : 'That password isn’t correct.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen={pending !== null} onClose={() => !busy && finish(false)} title="Confirm it’s you" maxWidth="sm">
      <form onSubmit={submit} className="space-y-4" noValidate>
        <p className="text-sm text-[var(--muted)]">{pending?.message}</p>
        <Input
          label="Your password"
          type="password"
          autoComplete="current-password"
          autoFocus
          value={password}
          onChange={e => setPassword(e.target.value)}
          error={error ?? undefined}
          leftIcon={<Lock className="w-4 h-4" />}
        />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={() => finish(false)} disabled={busy}>Cancel</Button>
          <Button type="submit" variant="primary" size="sm" loading={busy}>Continue</Button>
        </div>
      </form>
    </Modal>
  );
}
