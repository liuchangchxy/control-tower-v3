import { useEffect, useState, useCallback } from 'react';
import type { VLLMMetrics } from '../types';

// ── Shared singleton SSE connection ──────────────────────────────────────────
// Multiple components call useMetrics(); we share one EventSource to avoid
// opening duplicate connections to /server/metrics/stream.

type Listener = (data: VLLMMetrics | null, stale: boolean) => void;

let sharedES: EventSource | null = null;
let sharedMetrics: VLLMMetrics | null = null;
let sharedStale = false;
let listeners = new Set<Listener>();
let heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
const HEARTBEAT_TIMEOUT = 45000;

function notify() {
  for (const fn of listeners) fn(sharedMetrics, sharedStale);
}

function resetHeartbeat() {
  if (heartbeatTimer) clearTimeout(heartbeatTimer);
  heartbeatTimer = setTimeout(() => {
    sharedStale = true;
    notify();
  }, HEARTBEAT_TIMEOUT);
}

function ensureConnected() {
  if (sharedES) return;

  const url = '/api/server/metrics/stream';
  sharedES = new EventSource(url);

  sharedES.onopen = () => {
    sharedStale = false;
    resetHeartbeat();
    notify();
  };

  sharedES.onmessage = (e) => {
    resetHeartbeat();
    try {
      sharedMetrics = JSON.parse(e.data) as VLLMMetrics;
      sharedStale = false;
      notify();
    } catch (err) {
      console.error('SSE parse error:', err);
    }
  };

  sharedES.onerror = () => {
    if (sharedES?.readyState === EventSource.CLOSED) {
      if (heartbeatTimer) clearTimeout(heartbeatTimer);
      sharedStale = true;
      notify();
    }
  };
}

function subscribe(fn: Listener) {
  listeners.add(fn);
  ensureConnected();
  return () => {
    listeners.delete(fn);
    if (listeners.size === 0 && sharedES) {
      sharedES.close();
      sharedES = null;
      if (heartbeatTimer) clearTimeout(heartbeatTimer);
      heartbeatTimer = null;
    }
  };
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useMetrics() {
  const [metrics, setMetrics] = useState<VLLMMetrics | null>(sharedMetrics);
  const [stale, setStale] = useState(sharedStale);

  useEffect(() => {
    // Sync with current value immediately
    setMetrics(sharedMetrics);
    setStale(sharedStale);

    return subscribe((data, isStale) => {
      setMetrics(data);
      setStale(isStale);
    });
  }, []);

  return { metrics, stale };
}
