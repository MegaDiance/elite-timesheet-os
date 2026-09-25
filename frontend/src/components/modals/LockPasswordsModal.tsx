import React, { useEffect, useState } from 'react';
import api from '../../services/apiClient';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Lock, CheckCircle2, AlertCircle, Info } from 'lucide-react';
import { friendlyError } from '../../services/errors';

interface LockPasswordsModalProps {
  isOpen: boolean;
  onClose: () => void;
  hasRosterLockPassword?: boolean;
  hasTimesheetLockPassword?: boolean;
}

const EMPTY_FORM = {
  new_roster_lock_password: '',
  new_timesheet_lock_password: '',
  remove_roster: false,
  remove_timesheet: false,
  current_password: '',
};

/** Organisation Owner only: sets or clears the shared passwords that can lock and unlock rosters and timesheets. */
export const LockPasswordsModal: React.FC<LockPasswordsModalProps> = ({
  isOpen,
  onClose,
  hasRosterLockPassword = false,
  hasTimesheetLockPassword = false,
}) => {
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  useEffect(() => {
    if (isOpen) {
      setForm(EMPTY_FORM);
      setMessage(null);
    }
  }, [isOpen]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    // Only the fields being changed are sent: an omitted field keeps its password, an empty one clears it.
    const body: Record<string, string> = { current_password: form.current_password };
    if (form.remove_roster) body.new_roster_lock_password = '';
    else if (form.new_roster_lock_password) body.new_roster_lock_password = form.new_roster_lock_password;
    if (form.remove_timesheet) body.new_timesheet_lock_password = '';
    else if (form.new_timesheet_lock_password) body.new_timesheet_lock_password = form.new_timesheet_lock_password;

    if (Object.keys(body).length === 1) {
      setMessage({ text: 'Enter a new lock password, or choose one to remove.', type: 'error' });
      return;
    }
    if ([body.new_roster_lock_password, body.new_timesheet_lock_password].some(p => p && p.length < 4)) {
      setMessage({ text: 'Lock passwords must be at least 4 characters.', type: 'error' });
      return;
    }
    if (!form.current_password) {
      setMessage({ text: 'Enter your account password to confirm.', type: 'error' });
      return;
    }

    setSaving(true);
    setMessage(null);
    try {
      const res = await api.put('/organisation/lock-passwords', body);
      setMessage({ text: res.data?.message || 'Lock passwords updated.', type: 'success' });
      setForm(EMPTY_FORM);
      setTimeout(onClose, 1200);
    } catch (err: any) {
      setMessage({ text: friendlyError(err, 'The lock passwords could not be updated.'), type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Lock passwords"
      description="Shared passwords for locking and unlocking rosters and timesheets."
      maxWidth="md"
    >
      <form onSubmit={handleSave} className="space-y-4">
        {message && (
          <div
            className={`p-3 rounded-md text-xs flex items-center gap-2 border ${
              message.type === 'success'
                ? 'bg-[var(--success-light)] border-[var(--success)]/25 text-[var(--success)]'
                : 'bg-[var(--danger-light)] border-[var(--danger)]/25 text-[var(--danger)]'
            }`}
          >
            {message.type === 'success' ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}
            <span>{message.text}</span>
          </div>
        )}

        <div className="bg-[var(--panel-subtle)] p-3 rounded-md border border-[var(--border)] text-xs text-[var(--muted)] flex items-start gap-2.5">
          <Info className="w-4 h-4 text-[var(--primary)] shrink-0 mt-0.5" />
          <span>
            Locking or unlocking a pay period always accepts the person's own account password. A lock password is an extra,
            shared password for that kind of lock. Leave a field blank to keep the current one.
          </span>
        </div>

        <div className="space-y-2">
          <Input
            label="New roster lock password"
            type="password"
            autoComplete="new-password"
            placeholder={hasRosterLockPassword ? 'Leave blank to keep the current password' : 'Not set'}
            value={form.new_roster_lock_password}
            onChange={e => setForm({ ...form, new_roster_lock_password: e.target.value })}
            disabled={form.remove_roster}
            leftIcon={<Lock className="w-4 h-4" />}
          />
          {hasRosterLockPassword && (
            <label className="flex items-center gap-2 text-xs text-[var(--muted)] cursor-pointer">
              <input
                type="checkbox"
                checked={form.remove_roster}
                onChange={e => setForm({ ...form, remove_roster: e.target.checked, new_roster_lock_password: '' })}
                className="accent-[var(--primary)]"
              />
              Remove the roster lock password
            </label>
          )}
        </div>

        <div className="space-y-2">
          <Input
            label="New timesheet lock password"
            type="password"
            autoComplete="new-password"
            placeholder={hasTimesheetLockPassword ? 'Leave blank to keep the current password' : 'Not set'}
            value={form.new_timesheet_lock_password}
            onChange={e => setForm({ ...form, new_timesheet_lock_password: e.target.value })}
            disabled={form.remove_timesheet}
            leftIcon={<Lock className="w-4 h-4" />}
          />
          {hasTimesheetLockPassword && (
            <label className="flex items-center gap-2 text-xs text-[var(--muted)] cursor-pointer">
              <input
                type="checkbox"
                checked={form.remove_timesheet}
                onChange={e => setForm({ ...form, remove_timesheet: e.target.checked, new_timesheet_lock_password: '' })}
                className="accent-[var(--primary)]"
              />
              Remove the timesheet lock password
            </label>
          )}
        </div>

        <div className="pt-2 border-t border-[var(--border)]">
          <Input
            label="Your account password"
            type="password"
            autoComplete="current-password"
            placeholder="Confirm it's you"
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
          <Button type="submit" variant="primary" size="sm" loading={saving}>
            Save lock passwords
          </Button>
        </div>
      </form>
    </Modal>
  );
};
