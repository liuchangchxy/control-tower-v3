import { useEffect } from 'react';
import type { ReactNode } from 'react';

interface Props {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
}

export function Modal({ open, onClose, title, children }: Props) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="bg-bg-secondary border border-border rounded-[var(--radius-lg)] p-6 max-w-lg w-full mx-4"
        onClick={e => e.stopPropagation()}
      >
        {title && <h2 className="text-lg font-semibold mb-4 text-text-primary">{title}</h2>}
        {children}
      </div>
    </div>
  );
}
