import React, { createContext, useContext, useState, useCallback } from 'react';
import { CheckCircle2, XCircle, AlertTriangle, Info, X } from 'lucide-react';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface ToastItem {
  id: string;
  title: string;
  message?: string;
  type: ToastType;
  duration?: number;
}

interface ToastContextType {
  toasts: ToastItem[];
  showToast: (toast: Omit<ToastItem, 'id' | 'type'> & { type?: ToastType }) => void;
  removeToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback(
    ({
      title,
      message,
      type = 'success',
      duration = 4000,
    }: Omit<ToastItem, 'id' | 'type'> & { type?: ToastType }) => {
      const id = 'toast-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
      const newToast: ToastItem = { id, title, message, type, duration };

      setTimeout(() => {
        setToasts((prev) => [newToast, ...prev].slice(0, 5)); // Keep max 5
      }, 0);

      if (duration > 0) {
        setTimeout(() => {
          removeToast(id);
        }, duration + 50);
      }
    },
    [removeToast]
  );

  return (
    <ToastContext.Provider value={{ toasts, showToast, removeToast }}>
      {children}

      {/* Global Toast Render Container */}
      <div
        className="fixed top-5 right-5 z-[9999] flex flex-col gap-2.5 max-w-sm w-full pointer-events-none px-3 sm:px-0"
        aria-live="polite"
      >
        {toasts.map((toast) => {
          let bgColors = 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white';
          let iconColor = 'text-emerald-500';
          let IconComponent = CheckCircle2;

          if (toast.type === 'error') {
            iconColor = 'text-rose-500';
            IconComponent = XCircle;
          } else if (toast.type === 'warning') {
            iconColor = 'text-amber-500';
            IconComponent = AlertTriangle;
          } else if (toast.type === 'info') {
            iconColor = 'text-blue-500';
            IconComponent = Info;
          }

          return (
            <div
              key={toast.id}
              className={`pointer-events-auto p-4 rounded-2xl border shadow-xl flex items-start gap-3 transition-all transform animate-in slide-in-from-top-4 fade-in duration-200 ${bgColors}`}
            >
              <IconComponent className={`w-5 h-5 shrink-0 mt-0.5 ${iconColor}`} />

              <div className="flex-1 min-w-0 pr-1">
                <p className="font-extrabold text-xs tracking-tight">{toast.title}</p>
                {toast.message && (
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 line-clamp-2">
                    {toast.message}
                  </p>
                )}
              </div>

              <button
                onClick={() => removeToast(toast.id)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-0.5 rounded-lg transition-colors"
                title="Dismiss"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
};

export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) {
    // Return dummy fallback if unmounted
    return {
      toasts: [],
      showToast: () => {},
      removeToast: () => {},
    };
  }
  return context;
};
