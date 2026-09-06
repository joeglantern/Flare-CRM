/**
 * SocketProvider (Component Inventory · Hooks and providers): one cookie-authenticated Socket.IO
 * connection for the session, typed from packages/shared/src/socket-events.ts, with rejoin on
 * reconnect. Connection status drives the offline banner.
 */
import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { connectSocket, disconnectSocket, useSocketStatus } from '@/lib/socket/client';

export type SocketStatus = 'connecting' | 'live' | 'offline';

interface SocketState {
  status: SocketStatus;
  /** Browser connectivity, separate from the socket: used for the offline banner. */
  online: boolean;
}

const SocketContext = createContext<SocketState>({ status: 'connecting', online: true });

export function SocketProvider({ children }: { children: ReactNode }) {
  const { connected, lastError } = useSocketStatus();
  const online = useOnline();

  useEffect(() => {
    connectSocket();
    return () => {
      disconnectSocket();
    };
  }, []);

  const value = useMemo<SocketState>(
    () => ({
      status: connected ? 'live' : lastError !== null ? 'offline' : 'connecting',
      online,
    }),
    [connected, lastError, online],
  );

  return <SocketContext value={value}>{children}</SocketContext>;
}

export function useSocketState(): SocketState {
  return useContext(SocketContext);
}

function useOnline(): boolean {
  const [online, setOnline] = useStateSafe(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine,
  );
  useEffect(() => {
    const up = () => {
      setOnline(true);
    };
    const down = () => {
      setOnline(false);
    };
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, [setOnline]);
  return online;
}

import { useCallback, useState } from 'react';

function useStateSafe<T>(init: () => T): [T, (v: T) => void] {
  const [v, set] = useState(init);
  return [
    v,
    useCallback((next: T) => {
      set(next);
    }, []),
  ];
}
