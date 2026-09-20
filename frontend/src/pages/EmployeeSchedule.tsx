import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { 
  Calendar, 
  Clock, 
  ChevronLeft, 
  ChevronRight, 
  ArrowRight
} from 'lucide-react';
import api from '../services/apiClient';
import { getFortnightStart, fmtISO } from '../utils/fortnight';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Skeleton } from '../components/ui/Skeleton';
import { EmptyState } from '../components/ui/EmptyState';
import { useToast } from '../components/ui/Toast';

export default function EmployeeSchedule() {
  const toast = useToast();
  const [activeDate, setActiveDate] = useState<Date>(new Date());
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<any>(null);
  const [viewFilter, setViewFilter] = useState<'all' | 'shifts_only'>('all');

  const fnStart = getFortnightStart(activeDate);
  const fnIso = fmtISO(fnStart);

  const fetchSchedule = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get(`/portal/my-timesheet?start_date=${fnIso}`);
      if (res.data?.success) {
        setData(res.data.data);
      }
    } catch (err: any) {
      console.error('Failed to load schedule:', err);
      toast.error('Unable to fetch your schedule for this cycle.');
    } finally {
      setLoading(false);
    }
  }, [fnIso, toast]);

  useEffect(() => {
    fetchSchedule();
  }, [fetchSchedule]);

  const handlePrev = () => {
    const d = new Date(activeDate);
    d.setDate(d.getDate() - 14);
    setActiveDate(d);
  };

  const handleNext = () => {
    const d = new Date(activeDate);
    d.setDate(d.getDate() + 14);
    setActiveDate(d);
  };

  const handleCurrent = () => {
    setActiveDate(new Date());
  };

  const days: any[] = data?.days || [];
  const scheduledDays = days.filter(d => d.segments?.some((s: any) => s.roster_in && s.roster_out));
  const isPublished = data?.lock_status?.is_published ?? true;

  const [fy, fm, fd] = fnIso.split('-').map(Number);
  const fnStartDate = new Date(Date.UTC(fy, fm - 1, fd));
  const fnEndDate = new Date(fnStartDate);
  fnEndDate.setDate(fnEndDate.getDate() + 13);
  const fnDateRangeStr = `${fnStartDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${fnEndDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;

  const todayIso = new Date().toISOString().split('T')[0];

  const displayedDays = viewFilter === 'shifts_only' ? scheduledDays : days;

  return (
    <div className="space-y-6 pb-16">
      {/* 1. Header & Navigation */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-[var(--border)]">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold tracking-tight text-[var(--text)]">
              My Shift Schedule
            </h1>
            <Badge variant={isPublished ? 'success' : 'warning'} size="md">
              {isPublished ? '✓ Published Schedule' : 'Draft / Unfinalised'}
            </Badge>
          </div>
          <p className="text-xs text-[var(--muted)] mt-1.5 flex items-center gap-2">
            <span>Cycle: <strong>{fnDateRangeStr}</strong></span>
            <span>•</span>
            <span>{scheduledDays.length} scheduled shifts</span>
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Fortnight Navigator */}
          <div className="inline-flex items-center rounded-lg border border-[var(--border)] bg-[var(--panel)] p-0.5">
            <button
              onClick={handlePrev}
              className="p-1.5 rounded-md text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--panel-subtle)] transition-colors"
              title="Previous Fortnight"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              onClick={handleCurrent}
              className="px-2.5 py-1 text-xs font-semibold text-[var(--text)] hover:bg-[var(--panel-subtle)] rounded transition-colors"
            >
              Current Fortnight
            </button>
            <button
              onClick={handleNext}
              className="p-1.5 rounded-md text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--panel-subtle)] transition-colors"
              title="Next Fortnight"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          <Link to="/timesheet">
            <Button variant="primary" size="sm" rightIcon={<ArrowRight className="w-3.5 h-3.5" />}>
              Open Timesheet
            </Button>
          </Link>
        </div>
      </div>

      {/* 2. Filter Pills */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-1.5 p-1 rounded-lg bg-[var(--panel-subtle)] border border-[var(--border)]">
          <button
            type="button"
            onClick={() => setViewFilter('all')}
            className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors ${
              viewFilter === 'all'
                ? 'bg-[var(--panel)] text-[var(--text)] shadow-xs'
                : 'text-[var(--muted)] hover:text-[var(--text)]'
            }`}
          >
            All 14 Days ({days.length})
          </button>
          <button
            type="button"
            onClick={() => setViewFilter('shifts_only')}
            className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors ${
              viewFilter === 'shifts_only'
                ? 'bg-[var(--panel)] text-[var(--text)] shadow-xs'
                : 'text-[var(--muted)] hover:text-[var(--text)]'
            }`}
          >
            Working Days Only ({scheduledDays.length})
          </button>
        </div>

        <div className="text-xs text-[var(--muted)] hidden sm:block">
          Total Fortnight Rostered: <strong className="text-[var(--text)] font-mono">{data?.contracted_hours ?? 76} hrs target</strong>
        </div>
      </div>

      {/* 3. Schedule Cards List */}
      {loading ? (
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => (
            <Skeleton key={i} className="h-20 w-full rounded-xl" />
          ))}
        </div>
      ) : displayedDays.length === 0 ? (
        <EmptyState
          icon={<Calendar className="w-10 h-10 text-[var(--muted)]" />}
          title="No Working Shifts Found"
          description="You do not have any rostered shifts for this view. Enjoy your time off!"
          action={
            <Button variant="outline" size="sm" onClick={() => setViewFilter('all')}>
              Show All 14 Days
            </Button>
          }
        />
      ) : (
        <div className="space-y-3">
          {displayedDays.map((day) => {
            const seg = day.segments?.[0] || {};
            const hasShift = Boolean(seg.roster_in && seg.roster_out);
            const isToday = day.date === todayIso;

            return (
              <Card
                key={day.date}
                className={`p-4 transition-all ${
                  isToday
                    ? 'border-[var(--primary)] bg-[var(--primary-light)]/10 ring-1 ring-[var(--primary)]/30'
                    : hasShift
                    ? 'border-[var(--border)] bg-[var(--panel)]'
                    : 'border-[var(--border)]/60 bg-[var(--panel-subtle)]/40 opacity-70'
                }`}
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  {/* Left Date Column */}
                  <div className="space-y-1 sm:min-w-[200px]">
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
                          {day.holidayName || 'Public Holiday'}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-[var(--muted)]">
                      {hasShift ? `${seg.segment_type || 'Standard Shift'}` : 'Rostered Day Off'}
                    </div>
                  </div>

                  {/* Middle Hours Column */}
                  <div className="flex items-center gap-4">
                    {hasShift ? (
                      <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-[var(--panel-subtle)] border border-[var(--border)] text-center font-mono">
                          <div className="text-[10px] uppercase font-bold text-[var(--muted)]">Shift Time</div>
                          <div className="font-bold text-sm text-[var(--text)]">
                            {seg.roster_in?.substring(0, 5)} – {seg.roster_out?.substring(0, 5)}
                          </div>
                        </div>

                        <div className="text-right">
                          <div className="text-sm font-bold font-mono text-[var(--primary)]">
                            {seg.roster_hours ?? 0} hrs
                          </div>
                          <div className="text-[11px] text-[var(--muted)]">
                            30m meal break
                          </div>
                        </div>
                      </div>
                    ) : (
                      <span className="text-xs text-[var(--muted)] italic">
                        No shift scheduled
                      </span>
                    )}
                  </div>

                  {/* Right Action */}
                  <div className="sm:self-center">
                    {isToday && hasShift ? (
                      <Link to="/timesheet">
                        <Button variant="primary" size="sm" rightIcon={<Clock className="w-3.5 h-3.5" />}>
                          Record Today's Hours
                        </Button>
                      </Link>
                    ) : (
                      <span className="text-xs text-[var(--muted)]">
                        {hasShift ? 'Scheduled' : 'Off'}
                      </span>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
