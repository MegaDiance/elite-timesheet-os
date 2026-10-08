import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { MoreHorizontal } from 'lucide-react';

export interface MenuItem {
  label: string;
  onSelect: () => void;
  icon?: ReactNode;
  danger?: boolean;
  disabled?: boolean;
}

interface Props {
  items: MenuItem[];
  /** Read by screen readers, e.g. "More actions for Branch Manager". */
  label: string;
  align?: 'left' | 'right';
  /** Replaces the default "…" button face. */
  trigger?: ReactNode;
  className?: string;
}

/**
 * The "…" overflow menu for secondary actions, so a row keeps one obvious primary action.
 * A real menu button: Enter, Space or ArrowDown opens it, arrow keys move, Escape or Tab closes
 * it and focus returns to the button.
 */
export function Menu({ items, label, align = 'right', trigger, className = '' }: Props) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const id = useId();
  const visible = items.filter(i => !i.disabled);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!listRef.current?.contains(e.target as Node) && !buttonRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    listRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    return () => document.removeEventListener('pointerdown', onPointer);
  }, [open]);

  if (visible.length === 0) return null;

  const close = (returnFocus = true) => {
    setOpen(false);
    if (returnFocus) buttonRef.current?.focus();
  };

  const onListKey = (e: React.KeyboardEvent) => {
    const buttons = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); buttons[(at + 1) % buttons.length]?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); buttons[(at - 1 + buttons.length) % buttons.length]?.focus(); }
    else if (e.key === 'Home') { e.preventDefault(); buttons[0]?.focus(); }
    else if (e.key === 'End') { e.preventDefault(); buttons[buttons.length - 1]?.focus(); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'Tab') close(false);
  };

  return (
    <div className={`relative inline-block ${className}`}>
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={label}
        onClick={e => { e.stopPropagation(); setOpen(o => !o); }}
        onKeyDown={e => { if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); } }}
        className="inline-flex items-center justify-center min-w-9 h-9 px-2 rounded-md text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--glass-8)] focus-visible:outline-2 focus-visible:outline-[var(--primary)] cursor-pointer"
      >
        {trigger ?? <MoreHorizontal className="w-4 h-4" aria-hidden="true" />}
      </button>
      {open && (
        <ul
          ref={listRef}
          id={id}
          role="menu"
          aria-label={label}
          onKeyDown={onListKey}
          className={`absolute z-40 mt-1 min-w-44 py-1 rounded-md border border-[var(--border)] bg-[var(--panel)] shadow-md ${align === 'right' ? 'right-0' : 'left-0'}`}
        >
          {visible.map(item => (
            <li key={item.label} role="none">
              <button
                type="button"
                role="menuitem"
                tabIndex={-1}
                onClick={e => { e.stopPropagation(); close(); item.onSelect(); }}
                className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-[var(--hover-row)] focus:bg-[var(--hover-row)] focus:outline-none cursor-pointer ${
                  item.danger ? 'text-[var(--danger)]' : 'text-[var(--text)]'
                }`}
              >
                {item.icon && <span className="shrink-0 [&_svg]:w-4 [&_svg]:h-4" aria-hidden="true">{item.icon}</span>}
                {item.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
