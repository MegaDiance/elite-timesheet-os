import React, { useState, useEffect } from 'react';
import api from '../../services/apiClient';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Clock, CheckCircle2, AlertCircle } from 'lucide-react';

interface BreakSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const BreakSettingsModal: React.FC<BreakSettingsModalProps> = ({ isOpen, onClose }) => {
  const [form, setForm] = useState({
    break_mins_weekday: 30,
    break_mins_weekend: 0,
    break_threshold_hours: 6.0,
  });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  useEffect(() => {
    if (isOpen) {
      fetchSettings();
    }
  }, [isOpen]);

  const fetchSettings = async () => {
    setLoading(true);
    setMessage(null);
    try {
      const res = await api.get('/organisation/me');
      if (res.data?.data) {
        setForm({
          break_mins_weekday: Number(res.data.data.break_mins_weekday ?? 30),
          break_mins_weekend: Number(res.data.data.break_mins_weekend ?? 0),
          break_threshold_hours: Number(res.data.data.break_threshold_hours ?? 6),
        });
      }
    } catch (err) {
      console.error('Failed to fetch org break settings:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage(null);

    try {
      await api.put('/organisation/settings', form);
      setMessage({ text: 'Break deduction rules updated successfully.', type: 'success' });
      setTimeout(() => {
        onClose();
        setMessage(null);
      }, 1000);
    } catch (err: any) {
      setMessage({
        text: err.response?.data?.error?.message || 'Failed to update break settings.',
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
      title="Automated Break Deduction Rules"
      description="Configure meal break deduction minutes and shift threshold for Fair Work compliance."
      maxWidth="md"
    >
      {loading ? (
        <div className="py-8 text-center text-xs text-[var(--muted)]">Loading settings...</div>
      ) : (
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
            <Clock className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
            <span>
              Break deductions are automatically subtracted from total hours whenever a single shift segment equals or exceeds the threshold.
            </span>
          </div>

          <Input
            label="Weekday Break Deduction (Minutes)"
            type="number"
            min={0}
            max={180}
            step={5}
            value={form.break_mins_weekday}
            onChange={(e) => setForm({ ...form, break_mins_weekday: Number(e.target.value) })}
            helperText="Standard Fair Work award: 30 minutes"
            required
          />

          <Input
            label="Weekend Break Deduction (Minutes)"
            type="number"
            min={0}
            max={180}
            step={5}
            value={form.break_mins_weekend}
            onChange={(e) => setForm({ ...form, break_mins_weekend: Number(e.target.value) })}
            helperText="Set to 0 if weekend shifts are paid without automatic deduction"
            required
          />

          <Input
            label="Minimum Shift Duration Threshold (Hours)"
            type="number"
            min={1}
            max={24}
            step={0.5}
            value={form.break_threshold_hours}
            onChange={(e) => setForm({ ...form, break_threshold_hours: Number(e.target.value) })}
            helperText="Break is only subtracted if the shift reaches or exceeds this duration (e.g. 6.0 hours)"
            required
          />

          <div className="flex justify-end gap-2.5 pt-4 border-t border-[var(--border)]">
            <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" size="sm" loading={saving}>
              Save Break Rules
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
};
