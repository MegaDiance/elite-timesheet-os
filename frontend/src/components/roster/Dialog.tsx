import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { X } from 'lucide-react';

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/** Open dialogs, innermost last: only the top one answers Escape and keeps Tab inside itself. */
const openDialogs: number[] = [];
let nextDialogId = 1;

const SIZES = {
  sm: 'max-w-md',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-5xl',
} as const;

interface DialogProps {
  title: ReactNode;
  description?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: keyof typeof SIZES;
  /** While true (e.g. during a save) Escape, the backdrop and the close button do nothing. */
  closeDisabled?: boolean;
  /** When given, the body and footer are one form, so Enter in a field submits it. */
  onSubmit?: (e: FormEvent<HTMLFormElement>) => void;
}

/**
 * Accessible modal dialog: role="dialog", aria-modal, labelled by its title, Escape closes,
 * Tab stays inside, and focus returns to where it was when the dialog closes.
 */
export function Dialog({ title, description, onClose, children, footer, size = 'md', closeDisabled = false, onSubmit }: DialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [returnFocusTo] = useState(() => (typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null));

  const onCloseRef = useRef(onClose);
  const closeDisabledRef = useRef(closeDisabled);
  useEffect(() => {
    onCloseRef.current = onClose;
    closeDisabledRef.current = closeDisabled;
  });

  useEffect(() => {
    const id = nextDialogId++;
    openDialogs.push(id);
    const panel = panelRef.current;
    if (panel && !panel.contains(document.activeElement)) {
      const target = bodyRef.current?.querySelector<HTMLElement>(FOCUSABLE) ?? panel.querySelector<HTMLElement>(FOCUSABLE) ?? panel;
      target.focus();
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // Listening on the document (not the panel) keeps Escape and Tab working even when focus has
    // fallen back to <body>, e.g. after the focused button was disabled while saving.
    const onKeyDown = (e: KeyboardEvent) => {
      const current = panelRef.current;
      if (!current || openDialogs[openDialogs.length - 1] !== id) return;
      if (e.key === 'Escape') {
        e.stopPropagation();
        if (!closeDisabledRef.current) onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const nodes = Array.from(current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(n => n.offsetParent !== null);
      if (nodes.length === 0) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (!current.contains(document.activeElement)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      } else if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      const index = openDialogs.indexOf(id);
      if (index >= 0) openDialogs.splice(index, 1);
      document.body.style.overflow = previousOverflow;
      if (returnFocusTo && document.contains(returnFocusTo)) returnFocusTo.focus();
    };
  }, [returnFocusTo]);

  const content = (
    <>
      <div ref={bodyRef} className="flex-1 min-h-0 overflow-y-auto px-4 sm:px-5 py-4">
        {children}
      </div>
      {footer && <div className="px-4 sm:px-5 py-3 border-t border-[var(--border)] bg-[var(--panel)] rounded-b-2xl">{footer}</div>}
    </>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4">
      <div className="fixed inset-0 bg-black/60 backdrop-blur-xs" aria-hidden="true" onClick={closeDisabled ? undefined : onClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        className={`relative z-10 w-full ${SIZES[size]} max-h-[calc(100vh-1rem)] sm:max-h-[92vh] flex flex-col bg-[var(--panel)] text-[var(--text)] border border-[var(--border)] rounded-2xl shadow-2xl outline-none`}
      >
        <div className="flex items-start justify-between gap-3 px-4 sm:px-5 py-3.5 border-b border-[var(--border)]">
          <div className="min-w-0">
            <h2 id={titleId} className="text-base font-bold text-[var(--text)] leading-snug">{title}</h2>
            {description && <div id={descriptionId} className="text-xs text-[var(--muted)] mt-0.5">{description}</div>}
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={closeDisabled}
            aria-label="Close"
            className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--glass-8)] transition-colors disabled:opacity-40 cursor-pointer"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
        {onSubmit ? (
          <form
            onSubmit={onSubmit}
            noValidate
            className="flex-1 min-h-0 flex flex-col"
            onKeyDown={e => {
              // Enter in a text field saves, without relying on the browser's implicit submission.
              const target = e.target as HTMLElement;
              if (e.key !== 'Enter' || e.nativeEvent.isComposing || !(target instanceof HTMLInputElement)) return;
              if (['checkbox', 'radio', 'button', 'submit'].includes(target.type)) return;
              e.preventDefault();
              e.currentTarget.requestSubmit();
            }}
          >
            {content}
          </form>
        ) : (
          content
        )}
      </div>
    </div>
  );
}

/** Shared button styles for dialogs and toolbars. */
export const buttonClass = {
  primary:
    'inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold bg-[var(--primary)] hover:bg-[var(--primary-h)] text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer',
  secondary:
    'inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-[var(--panel-subtle)] text-[var(--text)] border border-[var(--border)] hover:bg-[var(--glass-8)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer',
  quiet:
    'inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--glass-8)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer',
  danger:
    'inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-[var(--danger-light)] text-[var(--danger)] border border-[var(--danger)]/30 hover:bg-[var(--danger)]/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer',
} as const;

export const inputClass =
  'bg-[var(--input-bg)] border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-xs text-[var(--text)] outline-none focus:border-[var(--primary)] focus:ring-1 focus:ring-[var(--primary)] read-only:opacity-70 read-only:cursor-default disabled:opacity-60';
