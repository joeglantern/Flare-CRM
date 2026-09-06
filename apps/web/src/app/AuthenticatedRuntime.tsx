/**
 * Runs for the whole authenticated session, independent of which page is open:
 * - opens the socket after `me` resolves and closes it on sign-out
 * - feeds call events into the call store (the popup UI only renders the store)
 * - refetches ringing calls and unread counts on every reconnect (docs/17 section 3)
 * - invalidates queries on entity:changed / call:logged / notification:new
 * - idle logout with a warning (docs/17 section 5)
 * - a single 401 handler that sends the user to sign-in once
 */
import type { ServerToClientEvents } from '@crm/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate, useRouterState } from '@tanstack/react-router';
import { useCallback, useEffect, type ReactNode } from 'react';
import { useCallStore } from '@/features/telephony/call-store';
import { onUnauthenticated } from '@/lib/api/client';
import { authClient } from '@/lib/auth/client';
import { ME_QUERY_KEY, useMe } from '@/lib/auth/me';
import { useIdleLogout } from '@/lib/idle';
import { useSessionWarning } from '@/lib/session-warning';
import { qk } from '@/lib/query';
import {
  connectSocket,
  disconnectSocket,
  useOnSocketConnect,
  useSocketEvent,
} from '@/lib/socket/client';

export function AuthenticatedRuntime({ children }: { children: ReactNode }) {
  const me = useMe();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const href = useRouterState({ select: (s) => s.location.href });
  const calls = useCallStore();

  // socket lifecycle
  useEffect(() => {
    connectSocket();
    return () => {
      disconnectSocket();
    };
  }, []);

  // one place handles session loss
  useEffect(
    () =>
      onUnauthenticated(() => {
        useCallStore.getState().reset();
        queryClient.removeQueries({ queryKey: ME_QUERY_KEY });
        void navigate({ to: '/sign-in', search: { redirect: href } });
      }),
    [queryClient, navigate, href],
  );

  // call state machine
  useSocketEvent('call:ringing', calls.onRinging);
  useSocketEvent('call:dialing', calls.onDialing);
  useSocketEvent(
    'call:answered',
    useCallback<ServerToClientEvents['call:answered']>(
      (p) => {
        calls.onAnswered(p, me.id);
      },
      [calls, me.id],
    ),
  );
  useSocketEvent('call:cancelled', calls.onCancelled);
  useSocketEvent('call:updated', calls.onUpdated);
  useSocketEvent('call:ended', calls.onEnded);
  useSocketEvent(
    'call:logged',
    useCallback<ServerToClientEvents['call:logged']>(
      (p) => {
        calls.onLogged(p);
        void queryClient.invalidateQueries({ queryKey: qk.list('calls') });
        if (p.contactId)
          void queryClient.invalidateQueries({ queryKey: qk.timeline('contact', p.contactId) });
      },
      [calls, queryClient],
    ),
  );

  // cache coherence
  useSocketEvent(
    'entity:changed',
    useCallback<ServerToClientEvents['entity:changed']>(
      (p) => {
        void queryClient.invalidateQueries({ queryKey: qk.entity(p.type, p.id) });
        void queryClient.invalidateQueries({ queryKey: qk.list(p.type) });
      },
      [queryClient],
    ),
  );
  useSocketEvent(
    'notification:new',
    useCallback<ServerToClientEvents['notification:new']>(() => {
      void queryClient.invalidateQueries({ queryKey: qk.notifications() });
    }, [queryClient]),
  );
  useOnSocketConnect(
    useCallback(() => {
      void queryClient.invalidateQueries({ queryKey: qk.notifications() });
      void queryClient.invalidateQueries({ queryKey: qk.list('calls', { live: true }) });
      void queryClient.invalidateQueries({ queryKey: qk.cti() });
    }, [queryClient]),
  );

  // idle logout
  useIdleLogout({
    onWarn: () => {
      // the designed warning dialog subscribes to this store; for now the event is enough
      useSessionWarning.getState().setWarning(true);
    },
    onActive: () => {
      useSessionWarning.getState().setWarning(false);
    },
    onLogout: () => {
      void authClient.signOut().finally(() => {
        disconnectSocket();
        queryClient.clear();
        void navigate({ to: '/sign-in', search: { redirect: href, reason: 'idle' } });
      });
    },
  });

  return children;
}
