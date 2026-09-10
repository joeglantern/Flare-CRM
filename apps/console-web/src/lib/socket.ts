/**
 * The console's own socket, typed from the shared contract (docs/21). One per tab, cookie
 * handshake, websocket only. It carries what the fleet screen needs to be live rather than polled:
 * a stack coming or going, and an entitlements document moving from pending to acked.
 */
import type { ConsoleServerEventName, ConsoleServerPayload, ConsoleToOwner } from '@crm/shared';
import { useEffect } from 'react';
import { io, type Socket } from 'socket.io-client';
import { create } from 'zustand';

export type ConsoleSocket = Socket<ConsoleToOwner, Record<string, never>>;

interface SocketState {
  connected: boolean;
  /** Set when the handshake was refused: no session, or two-factor not set up. */
  lastError: string | null;
}

export const useSocketStatus = create<SocketState>(() => ({ connected: false, lastError: null }));

let socket: ConsoleSocket | null = null;

export function getSocket(): ConsoleSocket {
  if (socket) return socket;
  socket = io({
    path: '/socket.io',
    withCredentials: true,
    transports: ['websocket'],
    autoConnect: false,
    reconnection: true,
    reconnectionDelay: 1_000,
    reconnectionDelayMax: 10_000,
  });
  socket.on('connect', () => {
    useSocketStatus.setState({ connected: true, lastError: null });
  });
  socket.on('disconnect', () => {
    useSocketStatus.setState({ connected: false });
  });
  socket.on('connect_error', (err: Error) => {
    useSocketStatus.setState({ connected: false, lastError: err.message });
  });
  return socket;
}

export function connectSocket(): ConsoleSocket {
  const s = getSocket();
  if (!s.connected && !s.active) s.connect();
  return s;
}

export function disconnectSocket(): void {
  if (!socket) return;
  socket.disconnect();
  useSocketStatus.setState({ connected: false, lastError: null });
}

/** Subscribe to one console event for the lifetime of a component. */
export function useConsoleEvent<E extends ConsoleServerEventName>(
  event: E,
  handler: (payload: ConsoleServerPayload<E>) => void,
): void {
  useEffect(() => {
    const s = getSocket();
    // Socket.IO types listeners per event; the cast keeps this function's own signature exact.
    s.on(event, handler as never);
    return () => {
      s.off(event, handler as never);
    };
  }, [event, handler]);
}
