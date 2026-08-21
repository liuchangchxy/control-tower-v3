import type { HTMLAttributes } from 'react';

interface Props extends HTMLAttributes<HTMLDivElement> {
  title?: string;
}

export function Card({ title, className, children, ...props }: Props) {
  return (
    <div
      {...props}
      className={`bg-bg-secondary border border-border rounded-[var(--radius-lg)] p-4 ${className ?? ''}`}
    >
      {title && <h3 className="text-text-secondary text-sm font-medium mb-3">{title}</h3>}
      {children}
    </div>
  );
}
