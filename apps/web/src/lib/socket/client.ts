/**
 * Socket.IO client typed from the shared contract (docs/10). One socket per tab, cookie auth,
 * websocket transport only (Caddy and the dev proxy both forward upgrades). The connection is
 * owned by the authenticated shell: connect after `me` resolves, disconnect on sign-out.
 */
import type { ClientToServerEvents, ServerEventName, ServerToClientEvents } from '@crm/shared';
import { io, type Socket } from 'socket.io-client';
import { useEffect } from 'react';
import { create } from 'zustand';

export type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

interface SocketState {
  connected: boolean;
  /** Set when the server refused the handshake (no session, banned, too many sockets). */
  lastError: string | null;
  reconnects: number;
}

export const useSocketStatus = create<SocketState>(() => ({
  connected: false,
  lastError: null,
  reconnects: 0,
}));

let socket: AppSocket | null = null;

export function getSocket(): AppSocket {
  if (socket) return socket;
  socket = io({
    path: '/socket.io',
    withCredentials: true,
    transports: ['websocket'],
    autoConnect: false,
    reconnection: true,
    reconnectionDelay: 1_000,
    reconnectionDelayMax: 10_000,
    randomizationFactor: 0.4,
  });
  socket.on('connect', () => {
    useSocketStatus.setState((s) => ({
      connected: true,
      lastError: null,
      reconnects: s.reconnects,
    }));
  });
  socket.on('disconnect', () => {
    useSocketStatus.setState({ connected: false });
  });
  socket.on('connect_error', (err) => {
    useSocketStatus.setState((s) => ({
      connected: false,
      lastError: err.message,
      reconnects: s.reconnects + 1,
    }));
  });
  socket.io.on('reconnect', () => {
    useSocketStatus.setState((s) => ({ ...s, reconnects: s.reconnects + 1 }));
  });
  return socket;
}

export function connectSocket(): AppSocket {
  const s = getSocket();
  if (!s.connected && !s.active) s.connect();
  return s;
}

export function disconnectSocket(): void {
  if (!socket) return;
  socket.disconnect();
  useSocketStatus.setState({ connected: false, lastError: null });
}

/** Subscribe to one server event for the lifetime of a component. */
export function useSocketEvent<E extends ServerEventName>(
  event: E,
  handler: ServerToClientEvents[E],
): void {
  useEffect(() => {
    const s = getSocket();
    // Socket.IO's listener typing is per-event; the cast keeps the public signature exact.
    s.on(event, handler as never);
    return () => {
      s.off(event, handler as never);
    };
  }, [event, handler]);
}

/** Run a callback on every (re)connect: used to refetch ringing calls and unread counts (docs/17 section 3). */
export function useOnSocketConnect(handler: () => void): void {
  useEffect(() => {
    const s = getSocket();
    s.on('connect', handler);
    return () => {
      s.off('connect', handler);
    };
  }, [handler]);
}

export const rooms = {
  watch(type: string, id: string): void {
    getSocket().emit('entity:watch', { type, id });
  },
  unwatch(type: string, id: string): void {
    getSocket().emit('entity:unwatch', { type, id });
  },
  joinConversation(conversationId: string): void {
    getSocket().emit('conv:join', { conversationId });
  },
  leaveConversation(conversationId: string): void {
    getSocket().emit('conv:leave', { conversationId });
  },
};

/** Keep an entity room joined while a detail view is mounted. */
export function useWatchEntity(type: string, id: string | undefined): void {
  useEffect(() => {
    if (!id) return;
    rooms.watch(type, id);
    return () => {
      rooms.unwatch(type, id);
    };
  }, [type, id]);
}
