/**
 * Calls list, detail and recordings (docs/09 · Calls).
 * A company's calls come from `companyId` on GET /calls (formerly GAP-08).
 */
import type { CallDto, RecordingHistoryEntryDto } from '@crm/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {} from 'react';
import { http, type OffsetList, type Query } from '@/lib/api/client';
import { qk } from '@/lib/query';

export interface CallFilters extends Query {
  direction?: string;
  status?: string;
  userId?: string;
  mine?: 'true' | 'false';
  contactId?: string;
  companyId?: string;
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

/** Who has played this call's recording, most recent first (formerly GAP-12). */
export function useRecordingHistory(callId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: qk.list('recording-history', { callId }),
    enabled: enabled && callId !== null,
    queryFn: () =>
      http.get<RecordingHistoryEntryDto[]>(`/api/v1/calls/${callId ?? ''}/recording-history`),
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
  const query = useQuery({
    queryKey: qk.list('missed-calls', filters),
    enabled,
    queryFn: (): Promise<OffsetList<MissedCall>> =>
      http.list<MissedCall>('/api/v1/reports/calls/missed', filters),
  });
  // `rows` is what every consumer reads; the query state comes along for loading and errors.
  return { ...query, rows: query.data?.data ?? [], total: query.data?.page.total ?? 0 };
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
