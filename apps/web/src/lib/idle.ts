/**
 * Idle logout (docs/17 section 5): warn at 55 minutes of inactivity, sign out at 60. Client-side
 * complement to the server's session caps; activity in any tab of this origin counts because the
 * last-activity timestamp is shared through localStorage.
 */
import { useEffect, useRef } from 'react';

export interface IdleOptions {
  warnAfterMs?: number;
  logoutAfterMs?: number;
  onWarn: (msRemaining: number) => void;
  onLogout: () => void;
  /** Called when activity resumes after a warning, so the UI can hide the warning. */
  onActive?: () => void;
  enabled?: boolean;
}

const ACTIVITY_EVENTS: (keyof WindowEventMap)[] = [
  'mousemove',
  'mousedown',
  'keydown',
  'touchstart',
  'scroll',
  'focus',
];
const STORAGE_KEY = 'flare.lastActivity';
const CHECK_EVERY_MS = 15_000;

export function useIdleLogout(options: IdleOptions): void {
  const { warnAfterMs = 55 * 60_000, logoutAfterMs = 60 * 60_000, enabled = true } = options;
  const callbacks = useRef(options);
  useEffect(() => {
    callbacks.current = options;
  });

  useEffect(() => {
    if (!enabled) return;
    let warned = false;
    let lastLocal = Date.now();

    const stamp = (): void => {
      lastLocal = Date.now();
      try {
        localStorage.setItem(STORAGE_KEY, String(lastLocal));
      } catch {
        // storage unavailable: fall back to this tab only
      }
      if (warned) {
        warned = false;
        callbacks.current.onActive?.();
      }
    };
    const lastActivity = (): number => {
      try {
        const shared = Number(localStorage.getItem(STORAGE_KEY));
        return Number.isFinite(shared) && shared > lastLocal ? shared : lastLocal;
      } catch {
        return lastLocal;
      }
    };
    const check = (): void => {
      const idle = Date.now() - lastActivity();
      if (idle >= logoutAfterMs) {
        callbacks.current.onLogout();
        return;
      }
      if (idle >= warnAfterMs && !warned) {
        warned = true;
        callbacks.current.onWarn(logoutAfterMs - idle);
      }
    };

    stamp();
    let throttle = 0;
    const onActivity = (): void => {
      const now = Date.now();
      if (now - throttle < 1_000) return;
      throttle = now;
      stamp();
    };
    for (const ev of ACTIVITY_EVENTS) window.addEventListener(ev, onActivity, { passive: true });
    const timer = setInterval(check, CHECK_EVERY_MS);
    return () => {
      for (const ev of ACTIVITY_EVENTS) window.removeEventListener(ev, onActivity);
      clearInterval(timer);
    };
  }, [enabled, warnAfterMs, logoutAfterMs]);
}
