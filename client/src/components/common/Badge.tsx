import type { ReactNode } from 'react';

type Tone = 'neutral' | 'success' | 'warning' | 'error' | 'info';

const TONE_CLASSES: Record<Tone, string> = {
  neutral: 'bg-bg-tertiary text-text-secondary',
  success: 'bg-green-900/30 text-green-400',
  warning: 'bg-yellow-900/30 text-yellow-400',
  error: 'bg-red-900/30 text-red-400',
  info: 'bg-blue-900/30 text-blue-400',
};

interface Props {
  tone?: Tone;
  children: ReactNode;
}

export function Badge({ tone = 'neutral', children }: Props) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded ${TONE_CLASSES[tone]}`}>
      {children}
    </span>
  );
}
