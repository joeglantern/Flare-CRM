/**
 * Inbox: channels, conversations and messages (docs/11).
 *
 * GAP-04: the conversations query has `mine` and `assigneeId` but no team scope, and there is no
 * bulk endpoint. The Team chip is therefore shown to managers only and resolves to
 * `assigneeId in (team roster)` client-side; no bulk bar is drawn on the inbox.
 * GAP-05: there is no template list endpoint, so template names come from the channel config or
 * are typed, and a send failure surfaces the Meta error code.
 */
import type { ChannelDto, ConversationDto, MessageDto, SendMessageBody } from '@crm/shared';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { http, type CursorList, type Query } from '@/lib/api/client';
import { qk } from '@/lib/query';

export interface ConversationFilters extends Query {
  status?: string;
  assigneeId?: string;
  mine?: 'true' | 'false';
  unassigned?: 'true';
  channelId?: string;
  contactId?: string;
  q?: string;
}

export function useChannels(enabled = true) {
  return useQuery({
    queryKey: qk.list('channels'),
    enabled,
    staleTime: 5 * 60_000,
    queryFn: () => http.get<ChannelDto[]>('/api/v1/channels'),
  });
}

export function useConversations(filters: ConversationFilters = {}, enabled = true) {
  return useInfiniteQuery({
    queryKey: qk.list('conversations', filters),
    enabled,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }): Promise<CursorList<ConversationDto>> =>
      http.cursor<ConversationDto>('/api/v1/conversations', {
        limit: 30,
        ...filters,
        ...(pageParam !== null ? { cursor: pageParam } : {}),
      }),
    getNextPageParam: (last) => (last.page.hasMore ? last.page.cursor : undefined),
  });
}

export function useConversation(id: string | null) {
  return useQuery({
    queryKey: qk.entity('conversation', id ?? ''),
    enabled: id !== null && id !== '',
    queryFn: () => http.get<ConversationDto>(`/api/v1/conversations/${id ?? ''}`),
  });
}

export function useMessages(conversationId: string | null) {
  return useInfiniteQuery({
    queryKey: qk.list('messages', { conversationId }),
    enabled: conversationId !== null && conversationId !== '',
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }): Promise<CursorList<MessageDto>> =>
      http.cursor<MessageDto>(`/api/v1/conversations/${conversationId ?? ''}/messages`, {
        limit: 40,
        ...(pageParam !== null ? { cursor: pageParam } : {}),
      }),
    getNextPageParam: (last) => (last.page.hasMore ? last.page.cursor : undefined),
  });
}

export function useConversationMutations(conversationId?: string) {
  const qc = useQueryClient();
  const invalidate = (id?: string) => {
    void qc.invalidateQueries({ queryKey: qk.list('conversations') });
    const target = id ?? conversationId;
    if (target !== undefined) {
      void qc.invalidateQueries({ queryKey: qk.entity('conversation', target) });
      void qc.invalidateQueries({ queryKey: qk.list('messages', { conversationId: target }) });
    }
  };
  return {
    send: useMutation({
      mutationFn: ({ id, body }: { id: string; body: SendMessageBody | Record<string, unknown> }) =>
        http.post<MessageDto>(`/api/v1/conversations/${id}/messages`, body),
      onSuccess: (_m, { id }) => {
        invalidate(id);
      },
    }),
    start: useMutation({
      mutationFn: (body: { channelId: string; contactId: string; phoneId?: string }) =>
        http.post<ConversationDto>('/api/v1/conversations', body),
      onSuccess: (c) => {
        invalidate(c.id);
      },
    }),
    markRead: useMutation({
      mutationFn: (id: string) => http.post<ConversationDto>(`/api/v1/conversations/${id}/read`),
      onSuccess: (c) => {
        invalidate(c.id);
      },
    }),
    assign: useMutation({
      mutationFn: ({ id, assigneeId }: { id: string; assigneeId: string | null }) =>
        http.post<ConversationDto>(`/api/v1/conversations/${id}/assign`, { assigneeId }),
      onSuccess: (c) => {
        invalidate(c.id);
      },
    }),
    setStatus: useMutation({
      mutationFn: ({ id, action }: { id: string; action: 'close' | 'reopen' | 'archive' }) =>
        http.post<ConversationDto>(`/api/v1/conversations/${id}/${action}`),
      onSuccess: (c) => {
        invalidate(c.id);
      },
    }),
    upload: useMutation({
      mutationFn: async (file: File) => {
        const form = new FormData();
        form.append('file', file);
        const res = await fetch('/api/v1/attachments', {
          method: 'POST',
          body: form,
          credentials: 'include',
        });
        if (!res.ok) throw new Error('Upload failed');
        return ((await res.json()) as { data: { id: string; fileName: string; url: string } }).data;
      },
    }),
  };
}

export function useChannelMutations() {
  const qc = useQueryClient();
  const done = () => {
    void qc.invalidateQueries({ queryKey: qk.list('channels') });
  };
  return {
    create: useMutation({
      mutationFn: (body: unknown) => http.post<ChannelDto>('/api/v1/channels', body),
      onSuccess: done,
    }),
    update: useMutation({
      mutationFn: ({ id, body }: { id: string; body: unknown }) =>
        http.patch<ChannelDto>(`/api/v1/channels/${id}`, body),
      onSuccess: done,
    }),
  };
}

/**
 * GAP-05: template names are configured on the channel (`config.templates`) or typed by hand;
 * Meta owns approval and exposes no list endpoint we can call.
 */
export interface TemplateDef {
  name: string;
  language: string;
  /** Body with {{1}} placeholders, when it has been recorded in the channel config. */
  body?: string;
  params: number;
}

export function templatesOf(channel: ChannelDto | undefined): TemplateDef[] {
  const raw = channel?.config.templates;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((t): TemplateDef[] => {
    if (typeof t !== 'object' || t === null) return [];
    const o = t as Record<string, unknown>;
    if (typeof o.name !== 'string') return [];
    return [
      {
        name: o.name,
        language: typeof o.language === 'string' ? o.language : 'en',
        ...(typeof o.body === 'string' ? { body: o.body } : {}),
        params: typeof o.params === 'number' ? o.params : countPlaceholders(o.body),
      },
    ];
  });
}

function countPlaceholders(body: unknown): number {
  if (typeof body !== 'string') return 0;
  const found = new Set(body.match(/\{\{\s*(\d+)\s*\}\}/g) ?? []);
  return found.size;
}

/** 24 h customer-service window (docs/11). */
export function windowState(lastInboundAt: string | null): {
  open: boolean;
  closesAt: string | null;
  msLeft: number;
} {
  if (lastInboundAt === null) return { open: false, closesAt: null, msLeft: 0 };
  const closes = new Date(lastInboundAt).getTime() + 24 * 60 * 60 * 1000;
  const msLeft = closes - Date.now();
  return {
    open: msLeft > 0,
    closesAt: new Date(closes).toISOString(),
    msLeft: Math.max(0, msLeft),
  };
}
