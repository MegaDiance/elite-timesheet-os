import React from 'react';
import { ArrowRight, Building2, Clock3, KeyRound, Layers, Link2, Lock, ScrollText, ServerCog } from 'lucide-react';
import { CtaLink } from './ui';

const ITEMS = [
  { icon: Building2, title: 'Organisations kept apart', text: 'Each organisation’s data is separate from every other.' },
  { icon: Layers, title: 'Access by branch and role', text: 'People see only the branches and pages their role allows.' },
  { icon: Link2, title: 'Private company link', text: 'Each organisation signs in through its own link. Lost it? Recover it with your company name and recovery password.' },
  { icon: KeyRound, title: 'Two-step verification', text: 'Optionally confirm each sign-in with an emailed code.' },
  { icon: Clock3, title: 'Automatic sign-out', text: 'Sessions end after 15 minutes of inactivity.' },
  { icon: Lock, title: 'Password to lock', text: 'Locking a pay period’s roster or timesheets needs a password.' },
  { icon: ScrollText, title: 'Audit log', text: 'See who changed what in your organisation.' },
  { icon: ServerCog, title: 'Checked on the server', text: 'Every request is checked on the server, not just hidden on screen.' },
];

export const Security: React.FC = () => (
  <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-24 lg:px-8 space-y-12">
    <h1 className="text-4xl font-semibold tracking-tight text-[var(--text)] sm:text-5xl">Security</h1>
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {ITEMS.map(({ icon: Icon, title, text }) => (
        <div key={title} className="space-y-1.5 rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4">
          <Icon aria-hidden="true" className="h-5 w-5 text-[var(--primary-text)]" />
          <h2 className="text-sm font-semibold text-[var(--text)]">{title}</h2>
          <p className="text-xs leading-relaxed text-[var(--muted)]">{text}</p>
        </div>
      ))}
    </div>
    <div className="flex justify-center">
      <CtaLink to="/pricing" size="lg">
        Get started
        <ArrowRight aria-hidden="true" className="h-4 w-4" />
      </CtaLink>
    </div>
  </div>
);
