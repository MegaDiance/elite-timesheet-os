import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { HelpCircle } from 'lucide-react';

/**
 * A small "?" beside a label that explains it in one or two sentences. Opens on click or tap
 * (hover alone is useless on phones), closes on Escape, a second click, or clicking elsewhere.
 * The explanation is announced to screen readers when opened.
 */
export function HelpTip({ label, children, align = 'left', onDark = false }: { label: string; children: ReactNode; align?: 'left' | 'right'; /** On the dark sidebar. */ onDark?: boolean }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const wrapper = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    const onClick = (e: MouseEvent) => { if (!wrapper.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onClick);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onClick);
    };
  }, [open]);

  return (
    <span ref={wrapper} className="relative inline-flex align-middle">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        aria-controls={id}
        aria-label={`What does “${label}” mean?`}
        className={`inline-flex items-center justify-center w-6 h-6 rounded-full ${onDark ? 'text-[var(--sidebar-text)] hover:text-white' : 'text-[var(--muted)] hover:text-[var(--primary-text)]'}`}
      >
        <HelpCircle className="w-3.5 h-3.5" aria-hidden="true" />
      </button>
      {open && (
        <span
          id={id}
          role="status"
          className={`absolute z-50 top-7 ${align === 'right' ? 'right-0' : 'left-0'} w-64 max-w-[80vw] p-3 rounded-lg bg-[var(--panel)] border border-[var(--border)] shadow-lg text-xs leading-relaxed text-[var(--text)] font-normal normal-case tracking-normal text-left`}
        >
          {children}
        </span>
      )}
    </span>
  );
}
