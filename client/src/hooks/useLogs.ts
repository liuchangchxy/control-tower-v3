import { useState, useRef } from 'react';
import { useSSE } from './useSSE';

export function useLogs(initialLines: string[] = []) {
  const initialLinesRef = useRef(initialLines);
  const [lines, setLines] = useState<string[]>(initialLines);

  useSSE<{ line: string }>('/logs/stream', {
    onMessage: ({ line }) => {
      setLines(prev => [...prev, line].slice(-2000));
    },
    // Restore initial logs on reconnect (server may have restarted)
    onOpen: () => setLines(initialLinesRef.current),
  });

  return lines;
}
