'use client';

import { useCallback, useEffect, useState } from 'react';
import { messageOf } from '@/lib/api';

type LoadState<T> = { data: T | null; error: string | null; loading: boolean };

// Runs an async loader on mount and whenever it changes; `reload` runs it again
export function useLoad<T>(load: () => Promise<T>) {
  const [state, setState] = useState<LoadState<T>>({ data: null, error: null, loading: true });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    load()
      .then((data) => {
        if (!cancelled) setState({ data, error: null, loading: false });
      })
      .catch((cause: unknown) => {
        if (!cancelled) setState({ data: null, error: messageOf(cause), loading: false });
      });
    // Ignores a response that arrives after the component unmounted or reloaded
    return () => {
      cancelled = true;
    };
  }, [load, attempt]);

  const reload = useCallback(() => {
    setState((current) => ({ ...current, error: null, loading: true }));
    setAttempt((value) => value + 1);
  }, []);

  const setData = useCallback((update: (current: T) => T) => {
    setState((current) => (current.data === null ? current : { ...current, data: update(current.data) }));
  }, []);

  return { ...state, reload, setData };
}
