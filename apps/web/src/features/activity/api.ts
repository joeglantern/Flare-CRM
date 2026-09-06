/**
 * Timeline and notes (docs/09 · Activity, Notes). Both are cursor paginated.
 */
import type { ActivityDto, CreateNoteBody, NoteDto } from '@crm/shared';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { http, type CursorList, type Query } from '@/lib/api/client';
import { qk } from '@/lib/query';

export type TimelineParent = 'contact' | 'company' | 'deal' | 'lead';

export interface TimelineFilters extends Query {
  types?: string;
  q?: string;
}

export function useTimeline(
  parent: TimelineParent,
  id: string | null,
  filters: TimelineFilters = {},
) {
  return useInfiniteQuery({
    queryKey: [...qk.timeline(parent === 'lead' ? 'contact' : parent, id ?? ''), filters],
    enabled: id !== null && id !== '',
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }): Promise<CursorList<ActivityDto>> =>
      http.cursor<ActivityDto>('/api/v1/activity', {
        [`${parent}Id`]: id ?? '',
        limit: 30,
        ...filters,
        ...(pageParam !== null ? { cursor: pageParam } : {}),
      }),
    getNextPageParam: (last) => (last.page.hasMore ? last.page.cursor : undefined),
  });
}

export function useNotes(parent: TimelineParent | 'call', id: string | null) {
  return useInfiniteQuery({
    queryKey: qk.list('notes', { parent, id }),
    enabled: id !== null && id !== '',
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }): Promise<CursorList<NoteDto>> =>
      http.cursor<NoteDto>('/api/v1/notes', {
        [`${parent}Id`]: id ?? '',
        limit: 20,
        ...(pageParam !== null ? { cursor: pageParam } : {}),
      }),
    getNextPageParam: (last) => (last.page.hasMore ? last.page.cursor : undefined),
  });
}

export function useNoteMutations(parent: TimelineParent | 'call', id: string | null) {
  const qc = useQueryClient();
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: qk.list('notes', { parent, id }) });
    if (id !== null && parent !== 'call') {
      void qc.invalidateQueries({
        queryKey: qk.timeline(parent === 'lead' ? 'contact' : parent, id),
      });
    }
  };
  return {
    create: useMutation({
      mutationFn: (body: CreateNoteBody | Record<string, unknown>) =>
        http.post<NoteDto>('/api/v1/notes', body),
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({ noteId, body }: { noteId: string; body: unknown }) =>
        http.patch<NoteDto>(`/api/v1/notes/${noteId}`, body),
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (noteId: string) => http.del(`/api/v1/notes/${noteId}`),
      onSuccess: invalidate,
    }),
  };
}
