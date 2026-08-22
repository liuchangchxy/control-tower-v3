import { useState, useEffect, useCallback } from 'react';
import type { SystemInfo } from '../types';

export function useSystem() {
  const [system, setSystem] = useState<SystemInfo | null>(null);

  const fetchSystem = useCallback(async () => {
    try {
      const res = await fetch('/api/gpu/system');
      const json = await res.json();
      if (json.ok) setSystem(json.data);
    } catch {
      // transient fetch error — keep previous data
    }
  }, []);

  useEffect(() => {
    fetchSystem();
    const timer = setInterval(fetchSystem, 3000);
    return () => clearInterval(timer);
  }, [fetchSystem]);

  return { system };
}
