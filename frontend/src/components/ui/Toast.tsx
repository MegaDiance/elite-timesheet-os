import React, { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import { CheckCircle2, AlertCircle, Info, AlertTriangle, X } from 'lucide-react';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

export interface ToastItem {
  id: string;
  type: ToastType;
  message: string;
}

interface ToastContextType {
  toast: {
    success: (message: string) => void;
    error: (message: string) => void;
    info: (message: string) => void;
    warning: (message: string) => void;
  };
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export const ToastProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const addToast = useCallback((type: ToastType, message: string) => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts((prev) => [...prev, { id, type, message }]);
    // Long enough to read: longer messages stay longer, and problems stay longest.
    const readingTime = Math.min(12000, 3500 + message.length * 50);
    setTimeout(() => removeToast(id), type === 'error' || type === 'warning' ? readingTime + 3000 : readingTime);
  }, [removeToast]);

  const toast = {
    success: (msg: string) => addToast('success', msg),
    error: (msg: string) => addToast('error', msg),
    info: (msg: string) => addToast('info', msg),
    warning: (msg: string) => addToast('warning', msg),
  };

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      {/* Above the phone navigation bar; announced to screen readers */}
      <div className="fixed bottom-20 md:bottom-4 right-0 md:right-4 z-[65] flex flex-col gap-2 max-w-sm w-full pointer-events-none px-4 md:px-0">
        {toasts.map((t) => {
          const Icon = t.type === 'success' ? CheckCircle2 : t.type === 'error' ? AlertCircle : t.type === 'warning' ? AlertTriangle : Info;
          const tone = t.type === 'success' ? 'var(--success)' : t.type === 'error' ? 'var(--danger)' : t.type === 'warning' ? 'var(--warn)' : 'var(--primary-text)';
          return (
            <div
              key={t.id}
              role={t.type === 'error' ? 'alert' : 'status'}
              className="pointer-events-auto flex items-start justify-between gap-3 pl-4 pr-2 py-3 rounded-lg shadow-xl text-sm border border-[var(--border)] bg-[var(--panel)] animate-in slide-in-from-bottom-2 fade-in duration-200"
              style={{ borderLeft: `4px solid ${tone}` }}
            >
              <div className="flex items-start gap-2.5 min-w-0">
                <Icon className="w-4 h-4 shrink-0 mt-0.5" style={{ color: tone }} aria-hidden="true" />
                <span className="text-[var(--text)] leading-snug">{t.message}</span>
              </div>
              <button
                type="button"
                onClick={() => removeToast(t.id)}
                className="p-1.5 hover:bg-[var(--panel-subtle)] rounded text-[var(--muted)] hover:text-[var(--text)] transition-colors cursor-pointer"
                aria-label="Dismiss"
              >
                <X className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
};

export function useToast(): ToastContextType['toast'] {
  const context = useContext(ToastContext);
  if (!context) {
    // Fallback if rendered outside provider
    return {
      success: (msg: string) => console.log('[TOAST SUCCESS]', msg),
      error: (msg: string) => console.error('[TOAST ERROR]', msg),
      info: (msg: string) => console.info('[TOAST INFO]', msg),
      warning: (msg: string) => console.warn('[TOAST WARN]', msg),
    };
  }
  return context.toast;
}
