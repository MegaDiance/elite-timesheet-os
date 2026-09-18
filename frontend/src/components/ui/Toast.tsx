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
    setTimeout(() => {
      removeToast(id);
    }, 4000);
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
      {/* Toast Notification Container */}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm w-full pointer-events-none px-4 sm:px-0">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto flex items-center justify-between gap-3 px-4 py-3 rounded-lg shadow-xl text-xs font-medium border animate-in slide-in-from-bottom-2 fade-in duration-200 ${
              t.type === 'success'
                ? 'bg-[var(--panel)] text-emerald-400 border-emerald-500/30'
                : t.type === 'error'
                ? 'bg-[var(--panel)] text-rose-400 border-rose-500/30'
                : t.type === 'warning'
                ? 'bg-[var(--panel)] text-amber-400 border-amber-500/30'
                : 'bg-[var(--panel)] text-indigo-400 border-indigo-500/30'
            }`}
          >
            <div className="flex items-center gap-2.5 min-w-0">
              {t.type === 'success' && <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />}
              {t.type === 'error' && <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />}
              {t.type === 'warning' && <AlertTriangle className="w-4 h-4 shrink-0 text-amber-400" />}
              {t.type === 'info' && <Info className="w-4 h-4 shrink-0 text-indigo-400" />}
              <span className="truncate text-[var(--text)]">{t.message}</span>
            </div>
            <button
              onClick={() => removeToast(t.id)}
              className="p-1 hover:bg-[var(--panel-subtle)] rounded text-[var(--muted)] hover:text-[var(--text)] transition-colors cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
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
