import { useState } from 'react';
import { useSSE } from './useSSE';

export function useLogs(initialLines: string[] = []) {
  const [lines, setLines] = useState<string[]>(initialLines);

  useSSE<{ line: string }>('/logs/stream', {
    onMessage: ({ line }) => {
      setLines(prev => [...prev, line].slice(-2000));
    },
  });

  return lines;
}
