/**
 * Notifications (docs/09 · Notifications). Cursor paginated; `notification:new` prepends and
 * increments the bell count.
 */
import type { NotificationDto } from '@crm/shared';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, unwrap } from '@/lib/api/client';
import { qk } from '@/lib/query';

export interface NotificationPage {
  data: NotificationDto[];
  page: { cursor: string | null; hasMore: boolean };
}

export function useNotifications(filter: { unread?: boolean } = {}) {
  return useInfiniteQuery({
    queryKey: qk.notifications(filter),
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }): Promise<NotificationPage> =>
      unwrap(
        await api.GET('/api/v1/notifications', {
          params: {
            query: {
              limit: 25,
              ...(pageParam !== null ? { cursor: pageParam } : {}),
              ...(filter.unread === true ? { unread: 'true' } : {}),
            } as never,
          },
        }),
      ),
    getNextPageParam: (last) => (last.page.hasMore ? last.page.cursor : undefined),
  });
}

export function useUnreadCount() {
  return useQuery({
    queryKey: [...qk.notifications(), 'unread-count'],
    queryFn: async (): Promise<number> =>
      unwrap(await api.GET('/api/v1/notifications/unread-count')).data.unread,
    staleTime: 15_000,
  });
}

export function useMarkNotificationRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) =>
      unwrap(await api.POST('/api/v1/notifications/{id}/read', { params: { path: { id } } })),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: qk.notifications() });
    },
  });
}

export function useMarkAllRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      unwrap(await api.POST('/api/v1/notifications/read-all'));
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: qk.notifications() });
    },
  });
}

export function useNotificationPreferences() {
  return useQuery({
    queryKey: [...qk.notifications(), 'preferences'],
    queryFn: async () =>
      unwrap(await api.GET('/api/v1/notifications/preferences')).data as {
        type: string;
        inApp: boolean;
        email: boolean;
      }[],
  });
}

export function useUpdateNotificationPreferences() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (preferences: { type: string; inApp: boolean; email: boolean }[]) =>
      unwrap(
        await api.PUT('/api/v1/notifications/preferences', { body: { preferences } as never }),
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [...qk.notifications(), 'preferences'] });
    },
  });
}

/** Where a notification takes you, derived from its `data` payload. */
export function notificationHref(n: NotificationDto): string | null {
  const d = n.data;
  const str = (k: string): string | null => {
    const v = d[k];
    return typeof v === 'string' ? v : null;
  };
  const url = str('url');
  if (url?.startsWith('/') === true) return url;
  const conv = str('conversationId');
  if (conv !== null) return `/inbox/${conv}`;
  const call = str('callId');
  if (call !== null) return `/calls/${call}`;
  const task = str('taskId');
  if (task !== null) return `/tasks?taskId=${task}`;
  const deal = str('dealId');
  if (deal !== null) return `/deals/${deal}`;
  const contact = str('contactId');
  if (contact !== null) return `/contacts/${contact}`;
  const lead = str('leadId');
  if (lead !== null) return `/leads/${lead}`;
  return null;
}
