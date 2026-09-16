import React, { useState } from 'react';
import api from '../../services/apiClient';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Lock, CheckCircle2, AlertCircle, ShieldAlert } from 'lucide-react';

interface LockPasswordsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const LockPasswordsModal: React.FC<LockPasswordsModalProps> = ({ isOpen, onClose }) => {
  const [form, setForm] = useState({
    new_roster_lock_password: '',
    new_timesheet_lock_password: '',
    current_password: '',
  });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.current_password) {
      setMessage({ text: 'Your current account password is required to verify identity.', type: 'error' });
      return;
    }

    setSaving(true);
    setMessage(null);

    try {
      await api.put('/organisation/lock-passwords', form);
      setMessage({ text: 'Lock passwords updated successfully.', type: 'success' });
      setForm({ new_roster_lock_password: '', new_timesheet_lock_password: '', current_password: '' });
      setTimeout(() => {
        onClose();
        setMessage(null);
      }, 1200);
    } catch (err: any) {
      setMessage({
        text: err.response?.data?.error?.message || 'Failed to update lock passwords. Please check your password.',
        type: 'error',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Fortnight Lock Passwords"
      description="Configure dedicated passwords to independently protect roster edits and timesheet finalisation."
      maxWidth="md"
    >
      <form onSubmit={handleSave} className="space-y-4">
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

        <div className="bg-[var(--panel-subtle)] p-3 rounded-md border border-[var(--border)] text-xs text-[var(--muted)] flex items-start gap-2.5">
          <ShieldAlert className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
          <span>
            Leaving either lock password blank will retain the existing password without changes. Company Admin master password always retains override capability.
          </span>
        </div>

        <Input
          label="New Roster Lock Password"
          type="password"
          placeholder="Leave blank to keep existing password"
          value={form.new_roster_lock_password}
          onChange={(e) => setForm({ ...form, new_roster_lock_password: e.target.value })}
          helperText="Protects draft roster schedules from unauthorized modifications"
          leftIcon={<Lock className="w-4 h-4" />}
        />

        <Input
          label="New Timesheet Lock Password"
          type="password"
          placeholder="Leave blank to keep existing password"
          value={form.new_timesheet_lock_password}
          onChange={(e) => setForm({ ...form, new_timesheet_lock_password: e.target.value })}
          helperText="Freezes employee clock-in and actual hours before payroll export"
          leftIcon={<Lock className="w-4 h-4" />}
        />

        <div className="pt-2 border-t border-[var(--border)]">
          <Input
            label="Current Administrator Password (Required)"
            type="password"
            placeholder="Verify your account password"
            value={form.current_password}
            onChange={(e) => setForm({ ...form, current_password: e.target.value })}
            required
            leftIcon={<Lock className="w-4 h-4" />}
          />
        </div>

        <div className="flex justify-end gap-2.5 pt-4 border-t border-[var(--border)]">
          <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" size="sm" loading={saving}>
            Update Passwords
          </Button>
        </div>
      </form>
    </Modal>
  );
};
