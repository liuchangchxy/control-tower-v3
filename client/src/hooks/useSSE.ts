import { useEffect, useRef } from 'react';

interface Options<T> {
  onMessage: (data: T) => void;
  enabled?: boolean;
  /** Called when the SSE connection gives up (readyState === CLOSED). */
  onError?: () => void;
  /** Called when the SSE connection opens (or reconnects). */
  onOpen?: () => void;
  /** Heartbeat timeout in ms. If no message received within this time, trigger onError. Default: 45000 (3× server heartbeat). */
  heartbeatTimeout?: number;
}

export function useSSE<T = unknown>(path: string, opts: Options<T>) {
  const optsRef = useRef(opts);
  optsRef.current = opts;

  useEffect(() => {
    if (opts.enabled === false) return;

    // All server routes are mounted under /api/
    const url = path.startsWith('/api/') ? path : `/api${path}`;
    let cancelled = false;
    let heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
    const timeout = opts.heartbeatTimeout ?? 45000;

    const resetHeartbeat = () => {
      if (heartbeatTimer) clearTimeout(heartbeatTimer);
      heartbeatTimer = setTimeout(() => {
        // No message received within timeout — server may be dead
        if (!cancelled) {
          console.warn(`SSE heartbeat timeout on ${url}`);
          optsRef.current.onError?.();
        }
      }, timeout);
    };

    const es = new EventSource(url);

    es.onopen = () => {
      if (cancelled) return;
      resetHeartbeat();
      optsRef.current.onOpen?.();
    };

    es.onmessage = (e) => {
      if (cancelled) return;
      resetHeartbeat(); // any message resets the heartbeat timer
      try {
        const data = JSON.parse(e.data) as T;
        optsRef.current.onMessage(data);
      } catch (err) {
        console.error('SSE parse error:', err);
      }
    };

    es.onerror = () => {
      if (cancelled) return;
      // Only fire onError when EventSource has given up (CLOSED),
      // not on every reconnection attempt (CONNECTING state).
      if (es.readyState === EventSource.CLOSED) {
        if (heartbeatTimer) clearTimeout(heartbeatTimer);
        optsRef.current.onError?.();
      }
    };

    return () => {
      cancelled = true;
      if (heartbeatTimer) clearTimeout(heartbeatTimer);
      es.close();
    };
  }, [path, opts.enabled]);
}
