import React, { useEffect, useState } from 'react';
import api from '../../services/apiClient';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Lock, AlertCircle } from 'lucide-react';
import { friendlyError } from '../../services/errors';
import { useToast } from '../ui/Toast';

interface RecoveryPasswordModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Called after a save or removal, so the page can re-read whether one is set. */
  onSaved: () => void;
  isSet: boolean;
}

const EMPTY_FORM = { next: '', confirm: '', remove: false, current_password: '' };

/**
 * Owner only: sets or removes the company recovery password. With the company name it shows the
 * private link on /recover-link, so the server requires the same strength as an account password.
 */
export const RecoveryPasswordModal: React.FC<RecoveryPasswordModalProps> = ({ isOpen, onClose, onSaved, isSet }) => {
  const toast = useToast();
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setForm(EMPTY_FORM);
      setError(null);
    }
  }, [isOpen]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.remove) {
      if (form.next.length < 8 || !/[A-Za-z]/.test(form.next) || !/[0-9]/.test(form.next)) {
        setError('Use at least 8 characters, with letters and numbers.');
        return;
      }
      if (form.next !== form.confirm) {
        setError('Passwords don’t match.');
        return;
      }
    }
    if (!form.current_password) {
      setError('Enter your account password.');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const res = await api.put('/organisation/recovery-password', {
        current_password: form.current_password,
        new_recovery_password: form.remove ? null : form.next,
      });
      toast.success(res.data?.message || (form.remove ? 'Recovery password removed' : 'Recovery password saved'));
      setForm(EMPTY_FORM);
      onSaved();
      onClose();
    } catch (err: any) {
      setError(friendlyError(err, 'Recovery password not saved.'));
      setForm(f => ({ ...f, current_password: '' }));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Company recovery password" maxWidth="md">
      <form onSubmit={handleSave} className="space-y-4">
        {error && (
          <div role="alert" className="p-3 rounded-md text-xs flex items-center gap-2 border bg-[var(--danger-light)] border-[var(--danger)]/25 text-[var(--danger)]">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <p className="text-xs text-[var(--muted)] leading-relaxed">
          Anyone with your company name and this password can see your private link. Don’t reuse your account password.
        </p>

        {!form.remove && (
          <>
            <Input
              label="New recovery password"
              type="password"
              autoComplete="new-password"
              value={form.next}
              onChange={e => setForm({ ...form, next: e.target.value })}
              leftIcon={<Lock className="w-4 h-4" />}
            />
            <Input
              label="Confirm recovery password"
              type="password"
              autoComplete="new-password"
              value={form.confirm}
              onChange={e => setForm({ ...form, confirm: e.target.value })}
              leftIcon={<Lock className="w-4 h-4" />}
            />
          </>
        )}
        {isSet && (
          <label className="flex items-center gap-2 text-xs text-[var(--muted)] cursor-pointer">
            <input
              type="checkbox"
              checked={form.remove}
              onChange={e => setForm({ ...form, remove: e.target.checked, next: '', confirm: '' })}
              className="accent-[var(--primary)]"
            />
            Remove the recovery password
          </label>
        )}

        <div className="pt-2 border-t border-[var(--border)]">
          <Input
            label="Your account password"
            type="password"
            autoComplete="current-password"
            value={form.current_password}
            onChange={e => setForm({ ...form, current_password: e.target.value })}
            required
            leftIcon={<Lock className="w-4 h-4" />}
          />
        </div>

        <div className="flex justify-end gap-2.5 pt-4 border-t border-[var(--border)]">
          <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" variant={form.remove ? 'danger' : 'primary'} size="sm" loading={saving}>
            {form.remove ? 'Remove password' : 'Save password'}
          </Button>
        </div>
      </form>
    </Modal>
  );
};
