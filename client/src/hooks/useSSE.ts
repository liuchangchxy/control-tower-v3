import { useEffect, useRef } from 'react';

interface Options<T> {
  onMessage: (data: T) => void;
  enabled?: boolean;
  /** Called when the SSE connection errors. EventSource will auto-reconnect. */
  onError?: () => void;
}

export function useSSE<T = unknown>(path: string, opts: Options<T>) {
  const optsRef = useRef(opts);
  optsRef.current = opts;

  useEffect(() => {
    if (opts.enabled === false) return;

    // All server routes are mounted under /api/
    const url = path.startsWith('/api/') ? path : `/api${path}`;
    const es = new EventSource(url);

    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data) as T;
        optsRef.current.onMessage(data);
      } catch (err) {
        console.error('SSE parse error:', err);
      }
    };

    es.onerror = () => {
      console.error('SSE error (will auto-reconnect):', optsRef.current);
      // Don't close — let EventSource handle reconnection automatically
      optsRef.current.onError?.();
    };

    return () => es.close();
  }, [path, opts.enabled]);
}
