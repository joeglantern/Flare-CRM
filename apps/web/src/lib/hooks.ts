/** Small shared hooks that are not worth a file each. */
import { useEffect, useRef, useState } from 'react';

/** Debounces a value; used for search inputs so a keystroke is not a request. */
export function useDebounced<T>(value: T, ms = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => {
      setDebounced(value);
    }, ms);
    return () => {
      clearTimeout(t);
    };
  }, [value, ms]);
  return debounced;
}

/** Re-renders once a second while `active`, for live call and window timers. */
export function useNow(active: boolean, intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => {
      setNow(Date.now());
    }, intervalMs);
    return () => {
      clearInterval(t);
    };
  }, [active, intervalMs]);
  return now;
}

/** Runs an effect only after the first render, so mount does not count as a change. */
export function useUpdateEffect(fn: () => void, deps: unknown[]): void {
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    fn();
    // the caller owns the dependency list
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

/**
 * Resets local state when `key` changes, during render rather than in an effect.
 *
 * This is React's documented "adjusting state when a prop changes" pattern. Doing it in an effect
 * would paint the stale values first and then immediately paint again, which is both a flash and
 * a cascading render; doing it here means the component renders once with the right values.
 * Used by every form drawer to clear itself when it opens.
 */
export function useResetWhen(key: unknown, reset: () => void): void {
  const [seen, setSeen] = useState(key);
  if (!Object.is(seen, key)) {
    setSeen(key);
    reset();
  }
}
