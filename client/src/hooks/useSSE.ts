import { useEffect, useRef } from 'react';

interface Options<T> {
  onMessage: (data: T) => void;
  enabled?: boolean;
  /** Called when the SSE connection gives up (readyState === CLOSED). */
  onError?: () => void;
}

export function useSSE<T = unknown>(path: string, opts: Options<T>) {
  const optsRef = useRef(opts);
  optsRef.current = opts;

  useEffect(() => {
    if (opts.enabled === false) return;

    // All server routes are mounted under /api/
    const url = path.startsWith('/api/') ? path : `/api${path}`;
    let cancelled = false; // L8: prevent stale events from old connections
    const es = new EventSource(url);

    es.onmessage = (e) => {
      if (cancelled) return; // L8: guard against stale events
      try {
        const data = JSON.parse(e.data) as T;
        optsRef.current.onMessage(data);
      } catch (err) {
        console.error('SSE parse error:', err);
      }
    };

    es.onerror = () => {
      // H8: Only fire onError when EventSource has given up (CLOSED),
      // not on every reconnection attempt (CONNECTING state).
      if (es.readyState === EventSource.CLOSED) {
        optsRef.current.onError?.();
      }
    };

    return () => {
      cancelled = true; // L8
      es.close();
    };
  }, [path, opts.enabled]);
}
