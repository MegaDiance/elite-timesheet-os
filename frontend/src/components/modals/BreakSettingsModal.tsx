import React, { useState, useEffect } from 'react';
import api from '../../services/apiClient';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Clock, CheckCircle2, AlertCircle } from 'lucide-react';
import { friendlyError } from '../../services/errors';

interface BreakSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/** Organisation Owner only: the unpaid break deducted from each day's hours. */
export const BreakSettingsModal: React.FC<BreakSettingsModalProps> = ({ isOpen, onClose }) => {
  const [form, setForm] = useState({
    break_mins_weekday: 30,
    break_mins_weekend: 0,
    break_threshold_hours: 6,
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
    } catch (err: any) {
      setMessage({ text: friendlyError(err, 'The current break rules could not be loaded.'), type: 'error' });
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
      setMessage({ text: 'Break rules saved.', type: 'success' });
      setTimeout(() => {
        onClose();
        setMessage(null);
      }, 1000);
    } catch (err: any) {
      setMessage({
        text: friendlyError(err, 'The break rules could not be saved.'),
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
      title="Break rules"
      description="The unpaid break SimpleHours takes off each day's hours."
      maxWidth="md"
    >
      {loading ? (
        <div className="py-8 text-center text-xs text-[var(--muted)]">Loading break rules…</div>
      ) : (
        <form onSubmit={handleSave} className="space-y-4">
          {message && (
            <div
              className={`p-3 rounded-md text-xs flex items-center gap-2 border ${
                message.type === 'success'
                  ? 'bg-[var(--success-light)] border-[var(--success)]/25 text-[var(--success)]'
                  : 'bg-[var(--danger-light)] border-[var(--danger)]/25 text-[var(--danger)]'
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
            <Clock className="w-4 h-4 text-[var(--primary-text)] shrink-0 mt-0.5" />
            <span>
              The break is taken off once per day, when the day's timed segments add up to the threshold and the gaps between
              them are shorter than the break. It comes off the longest Normal Work segment. Changes apply to hours saved from now on.
            </span>
          </div>

          <Input
            label="Weekday break (minutes)"
            type="number"
            min={0}
            max={240}
            step={5}
            value={form.break_mins_weekday}
            onChange={(e) => setForm({ ...form, break_mins_weekday: Number(e.target.value) })}
            helperText="Monday to Friday."
            required
          />

          <Input
            label="Weekend break (minutes)"
            type="number"
            min={0}
            max={240}
            step={5}
            value={form.break_mins_weekend}
            onChange={(e) => setForm({ ...form, break_mins_weekend: Number(e.target.value) })}
            helperText="Saturday and Sunday. Use 0 for no weekend break."
            required
          />

          <Input
            label="Threshold (hours per day)"
            type="number"
            min={0}
            max={24}
            step={0.5}
            value={form.break_threshold_hours}
            onChange={(e) => setForm({ ...form, break_threshold_hours: Number(e.target.value) })}
            helperText="The break is only taken off days of at least this many hours."
            required
          />

          <div className="flex justify-end gap-2.5 pt-4 border-t border-[var(--border)]">
            <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" size="sm" loading={saving}>
              Save break rules
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
};
