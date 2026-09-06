/**
 * Calls list, detail and recordings (docs/09 · Calls).
 * GAP-08: there is no companyId filter, so a company's calls are fetched by its contact ids.
 * GAP-12: playback is audited but the history is not on the DTO, so call detail links to the
 * filtered audit log instead of duplicating a list.
 */
import type { CallDto } from '@crm/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { http, type OffsetList, type Query } from '@/lib/api/client';
import { qk } from '@/lib/query';

export interface CallFilters extends Query {
  direction?: string;
  status?: string;
  userId?: string;
  mine?: 'true' | 'false';
  contactId?: string;
  unmatched?: 'true';
  hasRecording?: 'true' | 'false';
  number?: string;
  from?: string;
  to?: string;
  sort?: string;
  page?: number;
  pageSize?: number;
}

export function useCalls(filters: CallFilters = {}, enabled = true) {
  return useQuery({
    queryKey: qk.list('calls', filters),
    enabled,
    queryFn: (): Promise<OffsetList<CallDto>> => http.list<CallDto>('/api/v1/calls', filters),
  });
}

export function useCall(id: string | null) {
  return useQuery({
    queryKey: qk.entity('call', id ?? ''),
    enabled: id !== null && id !== '',
    queryFn: () => http.get<CallDto>(`/api/v1/calls/${id ?? ''}`),
  });
}

/**
 * A missed call plus what we can work out about it (Calls · Missed calls).
 *
 * GAP-17: the API has no "called back" flag and no repeat-caller count. GET /reports/calls/missed
 * is a filtered call list and nothing more. Both are derived here from calls we already have:
 * a missed call counts as returned when a later outbound call went to the same number, and the
 * attempt count is how many times that number rang unanswered inside the window. Both are honest
 * about the window they were computed over rather than pretending to be server truth.
 */
export interface MissedCall extends CallDto {
  /** How many times this number called and was missed within the loaded window. */
  attempts: number;
  /** True when an outbound call to this number happened after the miss. */
  returned: boolean;
  returnedAt: string | null;
}

export function useMissedCalls(filters: Query = {}, enabled = true) {
  const missed = useQuery({
    queryKey: qk.list('missed-calls', filters),
    enabled,
    queryFn: (): Promise<OffsetList<CallDto>> =>
      http.list<CallDto>('/api/v1/reports/calls/missed', filters),
  });

  // One extra query covering the same window, so "called back" is answered without N requests.
  const oldest = missed.data?.data.at(-1)?.startedAt;
  const callbacks = useQuery({
    queryKey: qk.list('missed-callbacks', { from: oldest }),
    enabled: enabled && oldest !== undefined,
    queryFn: (): Promise<OffsetList<CallDto>> =>
      http.list<CallDto>('/api/v1/calls', { direction: 'outbound', from: oldest, pageSize: 200 }),
  });

  const rows: MissedCall[] = useMemo(() => {
    const source = missed.data?.data ?? [];
    const outbound = callbacks.data?.data ?? [];
    const attemptsByNumber = new Map<string, number>();
    for (const c of source) {
      if (c.externalNumber === null) continue;
      attemptsByNumber.set(c.externalNumber, (attemptsByNumber.get(c.externalNumber) ?? 0) + 1);
    }
    return source.map((c) => {
      const back =
        c.externalNumber === null
          ? undefined
          : outbound.find(
              (o) => o.externalNumber === c.externalNumber && o.startedAt > c.startedAt,
            );
      return {
        ...c,
        attempts: c.externalNumber === null ? 1 : (attemptsByNumber.get(c.externalNumber) ?? 1),
        returned: back !== undefined,
        returnedAt: back?.startedAt ?? null,
      };
    });
  }, [missed.data, callbacks.data]);

  return {
    ...missed,
    rows,
    total: missed.data?.page.total ?? 0,
    /** True while the call-back lookup is still running; the flags are not final yet. */
    derivingCallbacks: callbacks.isPending && oldest !== undefined,
  };
}

export function useDeleteRecording() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (callId: string) => http.del(`/api/v1/calls/${callId}/recording`),
    onSuccess: (_r, callId) => {
      void qc.invalidateQueries({ queryKey: qk.entity('call', callId) });
      void qc.invalidateQueries({ queryKey: qk.list('calls') });
    },
  });
}

/** Same-origin stream; the browser handles range requests for seeking. */
export function recordingUrl(callId: string): string {
  return `/api/v1/calls/${callId}/recording`;
}
