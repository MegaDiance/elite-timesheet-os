import React from 'react';
import { Calendar, Clock, Clock3, Lock, Layers, Check, ArrowRight, Building2, KeyRound, FileSpreadsheet, ScrollText, Plus } from 'lucide-react';
import { Card } from '../../components/ui/Card';
import { CtaLink } from './ui';
import { RosterIllustration } from './illustrations';

function Point({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <Check className="w-4 h-4 text-[var(--success)] shrink-0 mt-0.5" />
      <span>
        <strong className="text-[var(--text)]">{title}:</strong> {children}
      </span>
    </li>
  );
}

function SectionIcon({ children }: { children: React.ReactNode }) {
  return (
    <div className="w-10 h-10 rounded-lg bg-[var(--primary-light)] border border-[var(--primary)]/20 flex items-center justify-center text-[var(--primary)]">
      {children}
    </div>
  );
}

export const Features: React.FC = () => {
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 space-y-20">
      <div className="text-center max-w-3xl mx-auto space-y-4">
        <h1 className="text-3xl sm:text-5xl font-bold tracking-tight text-[var(--text)]">What SimpleHours does</h1>
        <p className="text-base text-[var(--muted)] leading-relaxed">
          Rosters, timesheets and payroll preparation for Australian organisations with one or more branches, run by an
          Organisation Owner and the Branch Admins they invite. Workers don't sign in.
        </p>
      </div>

      {/* Roster */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-center">
        <div className="lg:col-span-5 space-y-4">
          <SectionIcon><Calendar className="w-5 h-5" /></SectionIcon>
          <h2 className="text-2xl font-bold text-[var(--text)]">A fortnightly roster on one screen</h2>
          <p className="text-sm text-[var(--muted)] leading-relaxed">
            Each pay period runs for 14 days from a Sunday. Plan every worker's fortnight in one grid, with rostered and worked
            hours kept side by side.
          </p>
          <ul className="space-y-2.5 text-xs text-[var(--muted)]">
            <Point title="Templates">Give each worker a fortnight template and roster from it in one step.</Point>
            <Point title="Copy a day">Copy a day to other days or other workers. Days that already have worked hours are never overwritten.</Point>
            <Point title="Quick time entry">
              Type times the way you say them (<code className="text-[var(--primary)]">7</code>, <code className="text-[var(--primary)]">0730</code>,{' '}
              <code className="text-[var(--primary)]">3p</code>, <code className="text-[var(--primary)]">15:30</code>). An end time before the start is an overnight shift.
            </Point>
          </ul>
        </div>
        <div className="lg:col-span-7">
          <RosterIllustration />
        </div>
      </div>

      {/* Segments */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-center">
        <div className="lg:col-span-7 order-2 lg:order-1">
          <Card className="p-6 space-y-3 bg-[var(--panel-subtle)]">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-[var(--text)]">Wednesday 1 April</span>
              <span className="text-[var(--muted)]">3 segments</span>
            </div>
            {[
              { type: 'Normal Work', time: '07:00 – 11:00' },
              { type: 'TIL', time: '11:00 – 12:00' },
              { type: 'Normal Work', time: '15:00 – 19:00' },
            ].map((seg, i) => (
              <div key={i} className="flex items-center justify-between bg-[var(--panel)] p-3 rounded-lg border border-[var(--border)] text-xs">
                <span className="font-medium text-[var(--text)]">{seg.type}</span>
                <span className="font-mono text-[var(--muted)]">{seg.time}</span>
              </div>
            ))}
            <div className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--primary)]">
              <Plus className="w-3.5 h-3.5" /> Add segment
            </div>
          </Card>
        </div>
        <div className="lg:col-span-5 space-y-4 order-1 lg:order-2">
          <SectionIcon><Layers className="w-5 h-5" /></SectionIcon>
          <h2 className="text-2xl font-bold text-[var(--text)]">Days with more than one segment</h2>
          <p className="text-sm text-[var(--muted)] leading-relaxed">
            Real days aren't one block of time. A day in SimpleHours is a list of segments, so split shifts and part-day leave
            are recorded exactly as they happened.
          </p>
          <ul className="space-y-2.5 text-xs text-[var(--muted)]">
            <Point title="Segment types">Normal Work, Sick Leave, Annual Leave, TIL, LWIP (leave without pay) and Other.</Point>
            <Point title="Checked as you go">Overlapping or backwards times are caught before they're saved.</Point>
            <Point title="Unplanned work">Record shifts that weren't on the roster so they show up in reports.</Point>
          </ul>
        </div>
      </div>

      {/* Breaks */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
        <div className="space-y-4">
          <SectionIcon><Clock className="w-5 h-5" /></SectionIcon>
          <h2 className="text-2xl font-bold text-[var(--text)]">Unpaid breaks worked out for you</h2>
          <p className="text-sm text-[var(--muted)] leading-relaxed">
            Set your organisation's break rule once. SimpleHours applies it to every day, on the roster and on timesheets.
          </p>
          <ul className="space-y-2.5 text-xs text-[var(--muted)]">
            <Point title="Once per day">The break comes off when the day's segments reach your threshold, not once per segment.</Point>
            <Point title="Weekday and weekend">Use a different break length on Saturdays and Sundays.</Point>
            <Point title="Public holidays">Hours on your organisation's public holidays are reported separately.</Point>
          </ul>
        </div>
        <Card className="p-6 space-y-3 bg-[var(--panel-subtle)] text-xs">
          <div className="font-semibold text-[var(--text)] pb-2 border-b border-[var(--border)]">Break rule</div>
          {[
            { label: 'Weekday break', value: '30 min' },
            { label: 'Weekend break', value: '0 min' },
            { label: 'Applies from', value: '6 hours per day' },
          ].map(row => (
            <div key={row.label} className="flex items-center justify-between">
              <span className="text-[var(--muted)]">{row.label}</span>
              <span className="font-mono font-semibold text-[var(--text)]">{row.value}</span>
            </div>
          ))}
        </Card>
      </div>

      {/* Timesheets & locks */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
        <div className="space-y-4">
          <SectionIcon><Lock className="w-5 h-5" /></SectionIcon>
          <h2 className="text-2xl font-bold text-[var(--text)]">Approvals and per-branch locks</h2>
          <p className="text-sm text-[var(--muted)] leading-relaxed">
            Record the hours actually worked against the roster, then sign each worker's fortnight off.
          </p>
          <ul className="space-y-2.5 text-xs text-[var(--muted)]">
            <Point title="Approve and reopen">Approve one worker or many at once. Reopen a timesheet to correct it, then approve it again.</Point>
            <Point title="Roster lock">Stops changes to a branch's rostered shifts for the fortnight, while worked hours can still be entered.</Point>
            <Point title="Timesheet lock">Freezes a branch's timesheets for the fortnight once payroll is done.</Point>
            <Point title="Password protected">Locking and unlocking needs your own password or the organisation's lock password.</Point>
          </ul>
        </div>
        <Card className="p-6 space-y-3 bg-[var(--panel-subtle)] text-xs">
          <div className="font-semibold text-[var(--text)] pb-2 border-b border-[var(--border)]">Fortnight starting 29 March</div>
          {[
            { branch: 'Richmond', roster: true, timesheet: true },
            { branch: 'Footscray', roster: true, timesheet: false },
            { branch: 'Geelong', roster: false, timesheet: false },
          ].map(row => (
            <div key={row.branch} className="flex items-center justify-between gap-2">
              <span className="font-medium text-[var(--text)]">{row.branch}</span>
              <span className="flex gap-1.5">
                <span className={`px-2 py-0.5 rounded-md text-[10px] font-semibold ${row.roster ? 'bg-[var(--warn-light)] text-[var(--warn)]' : 'bg-[var(--panel)] text-[var(--muted)] border border-[var(--border)]'}`}>
                  Roster {row.roster ? 'locked' : 'open'}
                </span>
                <span className={`px-2 py-0.5 rounded-md text-[10px] font-semibold ${row.timesheet ? 'bg-[var(--warn-light)] text-[var(--warn)]' : 'bg-[var(--panel)] text-[var(--muted)] border border-[var(--border)]'}`}>
                  Timesheets {row.timesheet ? 'locked' : 'open'}
                </span>
              </span>
            </div>
          ))}
        </Card>
      </div>

      {/* Reports */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
        <Card className="p-6 space-y-3 bg-[var(--panel-subtle)] text-xs order-2 lg:order-1">
          <div className="font-semibold text-[var(--text)] pb-2 border-b border-[var(--border)]">Payroll hours · one worker</div>
          <div className="grid grid-cols-3 gap-2 text-center">
            {[
              { label: 'Normal', value: '60.00' },
              { label: 'Saturday', value: '7.50' },
              { label: 'Sunday', value: '0.00' },
              { label: 'Sick', value: '7.60' },
              { label: 'Annual', value: '0.00' },
              { label: 'LWIP', value: '0.00' },
            ].map(cell => (
              <div key={cell.label} className="bg-[var(--panel)] p-2 rounded-lg border border-[var(--border)]">
                <div className="text-[10px] uppercase text-[var(--muted)] font-semibold">{cell.label}</div>
                <div className="font-mono font-bold text-[var(--text)]">{cell.value}</div>
              </div>
            ))}
          </div>
        </Card>
        <div className="space-y-4 order-1 lg:order-2">
          <SectionIcon><FileSpreadsheet className="w-5 h-5" /></SectionIcon>
          <h2 className="text-2xl font-bold text-[var(--text)]">Reports ready for payroll</h2>
          <p className="text-sm text-[var(--muted)] leading-relaxed">
            Each fortnight's report totals every worker's hours by category, for one branch or the whole organisation.
          </p>
          <ul className="space-y-2.5 text-xs text-[var(--muted)]">
            <Point title="Categories">Normal, Saturday, Sunday and public holiday hours, Sick Leave, Annual Leave, TIL, LWIP, Other and unplanned hours.</Point>
            <Point title="Variance">Contracted, rostered and worked hours side by side, with the approval status of each timesheet.</Point>
            <Point title="Export">Download as CSV, or print it or save it as a PDF, for whoever runs your payroll.</Point>
            <Point title="Preparation, not payroll">SimpleHours prepares the hours. It doesn't pay anyone, calculate tax or super, or connect to payroll software.</Point>
          </ul>
        </div>
      </div>

      {/* Roles & security */}
      <div className="border-t border-[var(--border)] pt-16">
        <h2 className="text-2xl font-bold text-center text-[var(--text)] mb-8">Access and security</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { icon: <Building2 className="w-5 h-5 text-[var(--primary)] mx-auto" />, title: 'Owner and Branch Admins', text: 'Branch Admins only see their branches, checked on the server' },
            { icon: <KeyRound className="w-5 h-5 text-[var(--primary)] mx-auto" />, title: 'Two-step verification', text: 'Optional email codes at sign-in' },
            { icon: <Clock3 className="w-5 h-5 text-[var(--primary)] mx-auto" />, title: 'Automatic sign-out', text: 'After 15 minutes of inactivity' },
            { icon: <ScrollText className="w-5 h-5 text-[var(--primary)] mx-auto" />, title: 'Audit log', text: 'Changes, for the Organisation Owner' },
          ].map(card => (
            <div key={card.title} className="p-4 rounded-lg bg-[var(--panel)] border border-[var(--border)] text-center space-y-1">
              {card.icon}
              <h3 className="font-semibold text-xs text-[var(--text)]">{card.title}</h3>
              <p className="text-[11px] text-[var(--muted)]">{card.text}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="text-center pt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
        <CtaLink to="/signup" size="lg">
          Get started
          <ArrowRight aria-hidden="true" className="w-4 h-4" />
        </CtaLink>
        <CtaLink to="/login" size="lg" variant="secondary">
          Sign in
        </CtaLink>
      </div>
    </div>
  );
};
