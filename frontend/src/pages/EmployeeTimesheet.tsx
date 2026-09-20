import { useState, useEffect, useCallback } from 'react';
import { 
  Clock, 
  CheckCircle2, 
  AlertCircle, 
  ChevronLeft, 
  ChevronRight, 
  Send, 
  Lock, 
  HelpCircle, 
  Copy, 
  Save
} from 'lucide-react';
import api from '../services/apiClient';
import { getFortnightStart, fmtISO } from '../utils/fortnight';
import SmartTimeInput from '../components/SmartTimeInput';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Skeleton } from '../components/ui/Skeleton';
import { useToast } from '../components/ui/Toast';
import { ContextHelpModal } from '../components/ContextHelpModal';

interface DayRecord {
  date: string;
  dayIndex: number;
  dayOfWeek: string;
  isPublicHoliday: boolean;
  holidayName?: string;
  rosteredHours: number;
  actualHours: number;
  segments: {
    id: string;
    segment_type: string;
    roster_in?: string;
    roster_out?: string;
    roster_hours?: number;
    actual_in?: string;
    actual_out?: string;
    actual_hours?: number;
    notes?: string;
  }[];
}

export default function EmployeeTimesheet() {
  const toast = useToast();
  const [activeDate, setActiveDate] = useState<Date>(new Date());
  const [loading, setLoading] = useState(true);
  const [portalData, setPortalData] = useState<any>(null);

  // Form state per day (indexed by date string 'YYYY-MM-DD')
  const [dayForms, setDayForms] = useState<Record<string, {
    actual_in: string;
    actual_out: string;
    break_mins: number;
    notes: string;
    isSaving: boolean;
    isSaved: boolean;
    error?: string;
  }>>({});

  // Submission state
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showSubmitConfirm, setShowSubmitConfirm] = useState(false);
  const [showHelpModal, setShowHelpModal] = useState(false);

  // Calculate current fortnight start ISO
  const fnStart = getFortnightStart(activeDate);
  const fnIso = fmtISO(fnStart);

  const fetchTimesheet = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get(`/portal/my-timesheet?start_date=${fnIso}`);
      if (res.data?.success) {
        setPortalData(res.data.data);

        // Populate local day forms
        const forms: Record<string, any> = {};
        const days: DayRecord[] = res.data.data.days || [];
        days.forEach(day => {
          const seg = day.segments?.[0] || {};
          forms[day.date] = {
            actual_in: seg.actual_in ? seg.actual_in.substring(0, 5) : '',
            actual_out: seg.actual_out ? seg.actual_out.substring(0, 5) : '',
            break_mins: 30,
            notes: seg.notes || '',
            isSaving: false,
            isSaved: Boolean(seg.actual_in && seg.actual_out)
          };
        });
        setDayForms(forms);
      }
    } catch (err: any) {
      console.error('Failed to load timesheet:', err);
      toast.error('Unable to load timesheet for this cycle.');
    } finally {
      setLoading(false);
    }
  }, [fnIso, toast]);

  useEffect(() => {
    fetchTimesheet();
  }, [fetchTimesheet]);

  // Navigate fortnights
  const handlePrevFortnight = () => {
    const d = new Date(activeDate);
    d.setDate(d.getDate() - 14);
    setActiveDate(d);
  };

  const handleNextFortnight = () => {
    const d = new Date(activeDate);
    d.setDate(d.getDate() + 14);
    setActiveDate(d);
  };

  const handleCurrentFortnight = () => {
    setActiveDate(new Date());
  };

  // Form field changes
  const handleFieldChange = (date: string, field: string, val: any) => {
    setDayForms(prev => ({
      ...prev,
      [date]: {
        ...prev[date],
        [field]: val,
        isSaved: false,
        error: undefined
      }
    }));
  };

  // Quick action: Match schedule
  const handleMatchSchedule = (day: DayRecord) => {
    const seg = day.segments?.[0];
    if (!seg || !seg.roster_in || !seg.roster_out) return;

    setDayForms(prev => ({
      ...prev,
      [day.date]: {
        ...prev[day.date],
        actual_in: seg.roster_in ? seg.roster_in.substring(0, 5) : '',
        actual_out: seg.roster_out ? seg.roster_out.substring(0, 5) : '',
        break_mins: 30,
        isSaved: false,
        error: undefined
      }
    }));
  };

  // Save single day hours
  const handleSaveDay = async (date: string) => {
    const form = dayForms[date];
    if (!form) return;

    if (!form.actual_in && form.actual_out) {
      setDayForms(prev => ({
        ...prev,
        [date]: { ...prev[date], error: 'Start time is missing. Please enter when you started work.' }
      }));
      return;
    }

    if (form.actual_in && !form.actual_out) {
      setDayForms(prev => ({
        ...prev,
        [date]: { ...prev[date], error: 'Finish time is missing. Please enter when you finished work.' }
      }));
      return;
    }

    setDayForms(prev => ({ ...prev, [date]: { ...prev[date], isSaving: true, error: undefined } }));

    try {
      const res = await api.post('/portal/enter-hours', {
        record_date: date,
        actual_in: form.actual_in || null,
        actual_out: form.actual_out || null,
        break_mins: form.break_mins,
        notes: form.notes
      });

      if (res.data?.success) {
        setDayForms(prev => ({
          ...prev,
          [date]: { ...prev[date], isSaving: false, isSaved: true, error: undefined }
        }));
        toast.success(`Hours saved for ${new Date(date + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}`);
        fetchTimesheet();
      }
    } catch (err: any) {
      const msg = err.response?.data?.error?.message || 'Failed to save hours.';
      setDayForms(prev => ({
        ...prev,
        [date]: { ...prev[date], isSaving: false, error: msg }
      }));
      toast.error(msg);
    }
  };

  // Submit full timesheet
  const handleSubmitTimesheet = async () => {
    setIsSubmitting(true);
    try {
      const res = await api.post('/submissions/submit', { start_date: fnIso });
      if (res.data?.success) {
        toast.success('Timesheet submitted successfully to your manager!');
        setShowSubmitConfirm(false);
        fetchTimesheet();
      }
    } catch (err: any) {
      toast.error(err.response?.data?.error?.message || 'Failed to submit timesheet.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const submission = portalData?.submission || { status: 'Draft' };
  const lockStatus = portalData?.lock_status || { timesheet_locked: false, roster_locked: false };
  const days: DayRecord[] = portalData?.days || [];
  const totalWorked = portalData?.worked_hours ?? 0;
  const contractedHours = portalData?.contracted_hours ?? 76;
  const isLockedOrApproved = lockStatus.timesheet_locked || submission.status === 'Approved' || submission.status === 'Locked';
  const isSubmitted = submission.status === 'Submitted';

  // Format fortnight title
  const [fy, fm, fd] = fnIso.split('-').map(Number);
  const fnStartDate = new Date(Date.UTC(fy, fm - 1, fd));
  const fnEndDate = new Date(fnStartDate);
  fnEndDate.setDate(fnEndDate.getDate() + 13);
  const fnDateRangeStr = `${fnStartDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${fnEndDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;

  const todayIso = new Date().toISOString().split('T')[0];

  return (
    <div className="space-y-6 pb-16">
      {/* 1. Header & Cycle Navigation */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-[var(--border)]">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold tracking-tight text-[var(--text)]">
              My Fortnight Timesheet
            </h1>
            {/* Obvious Status Badge */}
            {submission.status === 'Approved' ? (
              <Badge variant="success" size="md">✓ Approved</Badge>
            ) : submission.status === 'Submitted' ? (
              <Badge variant="purple" size="md">⏳ Awaiting Approval</Badge>
            ) : submission.status === 'Rejected' ? (
              <Badge variant="danger" size="md">⚠️ Needs Changes</Badge>
            ) : lockStatus.timesheet_locked ? (
              <Badge variant="warning" size="md">🔒 Locked</Badge>
            ) : (
              <Badge variant="default" size="md">Draft / In Progress</Badge>
            )}
          </div>
          <p className="text-xs text-[var(--muted)] mt-1.5 flex items-center gap-2">
            <span>Pay Cycle: <strong>{fnDateRangeStr}</strong></span>
            <span>•</span>
            <span>Target: <strong>{contractedHours} hrs</strong></span>
          </p>
        </div>

        {/* Cycle Switcher Controls */}
        <div className="flex items-center gap-2">
          <div className="inline-flex items-center rounded-lg border border-[var(--border)] bg-[var(--panel)] p-0.5">
            <button
              onClick={handlePrevFortnight}
              className="p-1.5 rounded-md text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--panel-subtle)] transition-colors"
              title="Previous Fortnight"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              onClick={handleCurrentFortnight}
              className="px-2.5 py-1 text-xs font-semibold text-[var(--text)] hover:bg-[var(--panel-subtle)] rounded transition-colors"
            >
              Current Cycle
            </button>
            <button
              onClick={handleNextFortnight}
              className="p-1.5 rounded-md text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--panel-subtle)] transition-colors"
              title="Next Fortnight"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowHelpModal(true)}
            leftIcon={<HelpCircle className="w-4 h-4 text-[var(--muted)]" />}
          >
            Help
          </Button>
        </div>
      </div>

      {/* 2. Manager Feedback Banner (if rejected) */}
      {submission.status === 'Rejected' && (
        <div className="p-4 rounded-xl bg-[var(--danger-light)] border border-[var(--danger)]/30 text-[var(--danger)] text-xs space-y-1.5 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
          <div className="space-y-1 flex-1">
            <div className="font-bold text-sm">Action Needed: Timesheet Returned for Changes</div>
            <p className="text-xs leading-relaxed opacity-95">
              Your manager provided this note: <strong className="font-semibold text-[var(--danger)]">"{submission.rejection_reason || 'Please adjust your shift hours and resubmit.'}"</strong>
            </p>
            <p className="text-[11px] opacity-80 pt-0.5">
              Review the flagged days below, update your start or finish times, save your changes, and tap <strong>Submit timesheet</strong>.
            </p>
          </div>
        </div>
      )}

      {/* 3. Approved Banner */}
      {submission.status === 'Approved' && (
        <div className="p-4 rounded-xl bg-[var(--success-light)] border border-[var(--success)]/30 text-[var(--success)] text-xs flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <CheckCircle2 className="w-5 h-5 shrink-0" />
            <div>
              <div className="font-bold text-sm">Timesheet Approved ✓</div>
              <div className="text-xs opacity-90">Management has approved your recorded hours for this pay cycle.</div>
            </div>
          </div>
          <button
            onClick={() => setShowHelpModal(true)}
            className="text-xs font-semibold underline hover:opacity-80 shrink-0"
          >
            Why is this locked?
          </button>
        </div>
      )}

      {/* 4. Fortnight Summary Bar & Obvious Primary Action */}
      <Card className="p-4 sm:p-5 bg-[var(--panel-subtle)] border-[var(--border)]">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-6">
            <div>
              <div className="text-[10px] uppercase font-bold tracking-wider text-[var(--muted)]">Total Hours Recorded</div>
              <div className="text-2xl sm:text-3xl font-bold text-[var(--text)] font-mono">
                {totalWorked} <span className="text-sm font-sans font-normal text-[var(--muted)]">/ {contractedHours} hrs</span>
              </div>
            </div>

            <div className="h-8 w-px bg-[var(--border)] hidden sm:block" />

            <div>
              <div className="text-[10px] uppercase font-bold tracking-wider text-[var(--muted)]">Cycle Progress</div>
              <div className="text-sm font-semibold text-[var(--text)] mt-0.5">
                {days.filter(d => (d.segments?.[0]?.actual_in && d.segments?.[0]?.actual_out)).length} of 14 days recorded
              </div>
            </div>
          </div>

          {/* Primary Action Button */}
          <div>
            {isLockedOrApproved ? (
              <Button
                variant="outline"
                size="md"
                disabled
                leftIcon={<Lock className="w-4 h-4 text-[var(--muted)]" />}
              >
                {submission.status === 'Approved' ? 'Approved & Finalised' : 'Timesheet Locked'}
              </Button>
            ) : isSubmitted ? (
              <Button
                variant="secondary"
                size="md"
                disabled
                leftIcon={<Clock className="w-4 h-4 text-[var(--primary)]" />}
              >
                Submitted (Under Review)
              </Button>
            ) : (
              <Button
                variant="primary"
                size="md"
                onClick={() => setShowSubmitConfirm(true)}
                rightIcon={<Send className="w-4 h-4" />}
                className="w-full sm:w-auto"
              >
                {submission.status === 'Rejected' ? 'Resubmit Timesheet' : 'Submit Timesheet'}
              </Button>
            )}
          </div>
        </div>
      </Card>

      {/* 5. 14 Days Form List */}
      {loading ? (
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => (
            <Skeleton key={i} className="h-24 w-full rounded-xl" />
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between text-xs text-[var(--muted)] px-1">
            <span className="font-semibold uppercase tracking-wider">Day-by-Day Shifts</span>
            <span>Tap "Save" after editing any day</span>
          </div>

          {days.map((day) => {
            const form = dayForms[day.date] || {
              actual_in: '',
              actual_out: '',
              break_mins: 30,
              notes: '',
              isSaving: false,
              isSaved: false
            };

            const seg = day.segments?.[0] || {};
            const hasRosteredShift = Boolean(seg.roster_in && seg.roster_out);
            const isToday = day.date === todayIso;

            return (
              <Card
                key={day.date}
                className={`p-4 transition-colors ${
                  isToday 
                    ? 'border-[var(--primary)]/60 bg-[var(--primary-light)]/10 ring-1 ring-[var(--primary)]/30' 
                    : form.isSaved
                    ? 'border-[var(--border)] bg-[var(--panel)]'
                    : 'border-[var(--border)] bg-[var(--panel)]'
                }`}
              >
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  {/* Day Date & Schedule Info */}
                  <div className="space-y-1 min-w-[200px]">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-sm text-[var(--text)]">
                        {day.dayOfWeek}, {new Date(day.date + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                      </span>
                      {isToday && (
                        <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-[var(--primary)] text-white">
                          Today
                        </span>
                      )}
                      {day.isPublicHoliday && (
                        <span className="px-1.5 py-0.2 rounded text-[10px] font-semibold bg-[var(--warn-light)] text-[var(--warn)]">
                          {day.holidayName || 'Holiday'}
                        </span>
                      )}
                    </div>

                    <div className="text-xs text-[var(--muted)]">
                      {hasRosteredShift ? (
                        <span>
                          Scheduled: <strong className="text-[var(--text)] font-mono">{seg.roster_in?.substring(0, 5)} – {seg.roster_out?.substring(0, 5)}</strong> ({seg.roster_hours ?? 0} hrs)
                        </span>
                      ) : (
                        <span className="italic">No shift scheduled (Rostered Day Off)</span>
                      )}
                    </div>
                  </div>

                  {/* Form Inputs (Start, Finish, Break, Save) */}
                  <div className="flex-1 flex flex-wrap items-center gap-3">
                    {/* Start Time */}
                    <div className="flex-1 min-w-[100px] max-w-[140px]">
                      <label className="block text-[10px] uppercase font-bold text-[var(--muted)] mb-1">
                        Start Time
                      </label>
                      <SmartTimeInput
                        value={form.actual_in}
                        onChange={(val: string) => handleFieldChange(day.date, 'actual_in', val)}
                        disabled={isLockedOrApproved}
                        placeholder="09:00"
                        className="w-full"
                      />
                    </div>

                    {/* Finish Time */}
                    <div className="flex-1 min-w-[100px] max-w-[140px]">
                      <label className="block text-[10px] uppercase font-bold text-[var(--muted)] mb-1">
                        Finish Time
                      </label>
                      <SmartTimeInput
                        value={form.actual_out}
                        onChange={(val: string) => handleFieldChange(day.date, 'actual_out', val)}
                        disabled={isLockedOrApproved}
                        placeholder="17:00"
                        className="w-full"
                      />
                    </div>

                    {/* Meal Break */}
                    <div className="w-24">
                      <label className="block text-[10px] uppercase font-bold text-[var(--muted)] mb-1">
                        Break
                      </label>
                      <select
                        value={form.break_mins}
                        onChange={(e) => handleFieldChange(day.date, 'break_mins', Number(e.target.value))}
                        disabled={isLockedOrApproved}
                        className="w-full px-2 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--panel)] text-xs text-[var(--text)]"
                      >
                        <option value={0}>0 min</option>
                        <option value={15}>15 min</option>
                        <option value={30}>30 min</option>
                        <option value={45}>45 min</option>
                        <option value={60}>60 min</option>
                      </select>
                    </div>

                    {/* Calculated Daily Hours Badge */}
                    <div className="min-w-[70px] text-center pt-3 sm:pt-4">
                      <span className="text-xs font-mono font-bold px-2 py-1 rounded bg-[var(--panel-subtle)] border border-[var(--border)] text-[var(--text)] inline-block">
                        {seg.actual_hours !== undefined && seg.actual_hours > 0 ? `${seg.actual_hours} hrs` : '--'}
                      </span>
                    </div>

                    {/* Actions: Match Schedule + Save */}
                    {!isLockedOrApproved && (
                      <div className="flex items-center gap-2 pt-3 sm:pt-4">
                        {hasRosteredShift && !form.actual_in && (
                          <button
                            type="button"
                            onClick={() => handleMatchSchedule(day)}
                            className="text-xs font-semibold text-[var(--primary)] hover:underline flex items-center gap-1 shrink-0"
                            title="Fill with scheduled shift times"
                          >
                            <Copy className="w-3.5 h-3.5" />
                            Match Schedule
                          </button>
                        )}

                        <Button
                          variant={form.isSaved ? 'outline' : 'primary'}
                          size="sm"
                          onClick={() => handleSaveDay(day.date)}
                          loading={form.isSaving}
                          disabled={isLockedOrApproved}
                          leftIcon={form.isSaved ? <CheckCircle2 className="w-3.5 h-3.5 text-[var(--success)]" /> : <Save className="w-3.5 h-3.5" />}
                        >
                          {form.isSaved ? 'Saved' : 'Save'}
                        </Button>
                      </div>
                    )}
                  </div>
                </div>

                {/* Inline Error (if any) */}
                {form.error && (
                  <div className="mt-2.5 p-2 rounded-lg bg-[var(--danger-light)] border border-[var(--danger)]/30 text-[var(--danger)] text-xs flex items-center gap-1.5">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>{form.error}</span>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {/* 6. Submit Confirmation Modal */}
      {showSubmitConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="w-full max-w-md bg-[var(--panel)] border border-[var(--border)] rounded-2xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-[var(--primary-light)] text-[var(--primary)]">
                <Send className="w-6 h-6" />
              </div>
              <div>
                <h3 className="font-bold text-base text-[var(--text)]">Submit Your Timesheet</h3>
                <p className="text-xs text-[var(--muted)]">Send completed hours to management</p>
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-[var(--panel-subtle)] border border-[var(--border)] space-y-1.5 text-xs">
              <div className="flex justify-between">
                <span className="text-[var(--muted)]">Pay Fortnight:</span>
                <span className="font-semibold text-[var(--text)]">{fnDateRangeStr}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--muted)]">Total Worked Hours:</span>
                <span className="font-bold text-[var(--text)] font-mono">{totalWorked} hrs</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--muted)]">Contracted Target:</span>
                <span className="text-[var(--text)]">{contractedHours} hrs</span>
              </div>
            </div>

            <p className="text-xs text-[var(--muted)] leading-relaxed">
              Once submitted, your manager will review and approve your timesheet. You can make corrections anytime if returned for changes.
            </p>

            <div className="flex items-center justify-end gap-2 pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowSubmitConfirm(false)}
                disabled={isSubmitting}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={handleSubmitTimesheet}
                loading={isSubmitting}
                rightIcon={<Send className="w-3.5 h-3.5" />}
              >
                Confirm & Submit
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* 7. Context Help Modal */}
      <ContextHelpModal
        isOpen={showHelpModal}
        onClose={() => setShowHelpModal(false)}
      />
    </div>
  );
}
