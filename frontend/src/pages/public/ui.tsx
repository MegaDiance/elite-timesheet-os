import React from 'react';
import { Link, type LinkProps } from 'react-router-dom';
import { Check } from 'lucide-react';

/** Shared building blocks for the public website. Presentational only: no data, no API calls. */

const focusRing =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--primary)]';

const ctaBase = `inline-flex items-center justify-center gap-2 rounded-md font-semibold whitespace-nowrap transition-colors ${focusRing}`;

const ctaVariants = {
  primary: 'bg-[var(--primary)] text-white hover:bg-[var(--primary-h)]',
  secondary:
    'border border-[var(--border-hover)] bg-[var(--panel)] text-[var(--text)] hover:bg-[var(--panel-subtle)]',
};

const ctaSizes = {
  sm: 'h-9 px-3.5 text-sm',
  md: 'h-10 px-4 text-sm',
  lg: 'h-12 px-6 text-base',
};

type CtaLinkProps = LinkProps & {
  variant?: keyof typeof ctaVariants;
  size?: keyof typeof ctaSizes;
};

/** A link styled as a button (a real <a>, never a button nested in a link). */
export function CtaLink({ variant = 'primary', size = 'md', className = '', ...props }: CtaLinkProps) {
  return <Link className={`${ctaBase} ${ctaVariants[variant]} ${ctaSizes[size]} ${className}`} {...props} />;
}

/** Small label above a section heading, marked with a short accent rule. */
export function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-center gap-2.5 text-sm font-semibold text-[var(--text)]">
      <span aria-hidden="true" className="h-0.5 w-5 rounded-full bg-[var(--primary)]" />
      {children}
    </p>
  );
}

/** Eyebrow, h2 and lead paragraph for a page section. */
export function SectionIntro({
  id,
  eyebrow,
  title,
  children,
  className = '',
}: {
  id: string;
  eyebrow?: string;
  title: string;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
      <h2 id={id} className={`${eyebrow ? 'mt-4' : ''} text-3xl font-semibold tracking-tight text-[var(--text)] sm:text-4xl`}>
        {title}
      </h2>
      {children && <div className="mt-4 text-base leading-relaxed text-[var(--text)]/75 sm:text-lg">{children}</div>}
    </div>
  );
}

/** A checked list item with a bold lead-in. */
export function Point({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span
        aria-hidden="true"
        className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--primary-light)] text-[var(--primary-text)]"
      >
        <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
      </span>
      <span className="text-[var(--text)]/75">
        <strong className="font-semibold text-[var(--text)]">{title}.</strong> {children}
      </span>
    </li>
  );
}

/** A framed, clearly labelled product illustration. The drawing itself is hidden from screen readers; the caption describes it. */
export function MockFrame({
  title,
  meta,
  caption,
  children,
  className = '',
}: {
  title: React.ReactNode;
  meta?: React.ReactNode;
  caption: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <figure className={className}>
      <div
        aria-hidden="true"
        className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--panel)] shadow-sm select-none"
      >
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-[var(--border)] px-4 py-3">
          <div className="flex min-w-0 items-center gap-2 text-sm font-semibold text-[var(--text)]">{title}</div>
          {meta && <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--text)]/70">{meta}</div>}
        </div>
        <div className="bg-[var(--panel-subtle)]/60 p-3 sm:p-4">{children}</div>
      </div>
      <figcaption className="mt-3 text-xs text-[var(--text)]/70">{caption}</figcaption>
    </figure>
  );
}

/** A small neutral chip used inside illustrations. */
export function Chip({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'neutral' | 'primary' | 'success' }) {
  const tones = {
    neutral: 'border-[var(--border)] bg-[var(--panel-subtle)] text-[var(--text)]/80',
    primary: 'border-transparent bg-[var(--primary-light)] text-[var(--text)]',
    success: 'border-transparent bg-[var(--success-light)] text-[var(--text)]',
  };
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-medium ${tones[tone]}`}>
      {tone === 'success' && <span className="h-1.5 w-1.5 rounded-full bg-[var(--success)]" />}
      {children}
    </span>
  );
}
