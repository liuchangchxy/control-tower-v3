import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface Toast {
  id: string;
  type: ToastType;
  message: string;
  duration?: number;
}

const TOAST_CLASSES: Record<ToastType, string> = {
  success: 'bg-green-900/90 text-green-200 border-green-700/50',
  error: 'bg-red-900/90 text-red-200 border-red-700/50',
  warning: 'bg-yellow-900/90 text-yellow-200 border-yellow-700/50',
  info: 'bg-blue-900/90 text-blue-200 border-blue-700/50',
};

const ICON: Record<ToastType, string> = {
  success: '✓',
  error: '✗',
  warning: '⚠',
  info: 'ℹ',
};

const DEFAULT_DURATION = 4000;

// ── Global Toast Context ────────────────────────────────────────────────────

interface ToastContextValue {
  addToast: (type: ToastType, message: string, duration?: number) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}

let _nextId = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = useCallback((type: ToastType, message: string, duration?: number) => {
    const id = `toast-${++_nextId}`;
    setToasts(prev => [...prev, { id, type, message, duration }]);
  }, []);

  const dismiss = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ addToast }}>
      {children}
      <ToastContainer toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

// ── Toast Item ──────────────────────────────────────────────────────────────

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: (id: string) => void }) {
  useEffect(() => {
    const duration = toast.duration ?? DEFAULT_DURATION;
    const timer = setTimeout(() => onDismiss(toast.id), duration);
    return () => clearTimeout(timer);
  }, [toast.id, toast.duration, onDismiss]);

  return (
    <div
      className={`flex items-center gap-3 px-4 py-3 rounded-lg border shadow-lg backdrop-blur-sm animate-in slide-in-from-right ${TOAST_CLASSES[toast.type]}`}
    >
      <span className="text-lg flex-shrink-0">{ICON[toast.type]}</span>
      <span className="text-sm flex-1">{toast.message}</span>
      <button
        onClick={() => onDismiss(toast.id)}
        className="ml-2 text-current opacity-60 hover:opacity-100 transition-opacity flex-shrink-0"
      >
        &times;
      </button>
    </div>
  );
}

// ── Toast Container ─────────────────────────────────────────────────────────

export function ToastContainer({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: string) => void }) {
  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 max-w-sm w-full pointer-events-none">
      {toasts.map(toast => (
        <div key={toast.id} className="pointer-events-auto">
          <ToastItem toast={toast} onDismiss={onDismiss} />
        </div>
      ))}
    </div>
  );
}

// ── Legacy local hook (backward compat for ServerControl) ───────────────────

export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = (type: ToastType, message: string, duration?: number) => {
    const id = `toast-local-${++_nextId}`;
    setToasts(prev => [...prev, { id, type, message, duration }]);
  };

  const dismiss = (id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  };

  return { toasts, addToast, dismiss };
}
