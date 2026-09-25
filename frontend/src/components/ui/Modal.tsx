import React, { useId, useRef } from 'react';
import { X } from 'lucide-react';
import { useDialogFocus } from '../roster/Dialog';

export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  children: React.ReactNode;
  maxWidth?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '4xl';
}

const maxWidthStyles = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl',
  '2xl': 'max-w-2xl',
  '4xl': 'max-w-4xl',
};

/**
 * Accessible modal: labelled by its own title, Escape and the backdrop close it, Tab stays inside,
 * and focus goes back to whatever opened it (the same behaviour as the roster's Dialog).
 */
export const Modal: React.FC<ModalProps> = (props) => (props.isOpen ? <OpenModal {...props} /> : null);

function OpenModal({ onClose, title, description, children, maxWidth = 'md' }: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  useDialogFocus(panelRef, onClose, false, bodyRef);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/60 backdrop-blur-xs transition-opacity" onClick={onClose} aria-hidden="true" />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        className={`relative w-full ${maxWidthStyles[maxWidth]} max-h-[calc(100dvh-2rem)] flex flex-col bg-[var(--panel)] border border-[var(--border)] rounded-xl shadow-2xl z-10 overflow-hidden outline-none animate-in fade-in zoom-in-95 duration-150`}
      >
        {(title || description) && (
          <div className="px-6 py-4 border-b border-[var(--border)] flex items-start justify-between gap-3 shrink-0">
            <div>
              {title && <h2 id={titleId} className="text-base font-semibold text-[var(--text)]">{title}</h2>}
              {description && <p id={descriptionId} className="text-sm text-[var(--muted)] mt-0.5">{description}</p>}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="text-[var(--muted)] hover:text-[var(--text)] p-2 -m-1 rounded-md hover:bg-[var(--glass-8)] transition-colors cursor-pointer"
              aria-label="Close"
            >
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
        )}

        <div ref={bodyRef} className="p-6 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}
