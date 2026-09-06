/**
 * Deals and pipelines (docs/09 · Deals, Pipelines).
 * Stage change is optimistic — the endpoint is idempotent — and rolls back on a 409 from
 * expectedUpdatedAt (Component Inventory · StageStepper).
 */
import type { CreateDealBody, DealDto, PipelineDto, UpdateDealBody } from '@crm/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from '@/components/ui/toast';
import { http, type OffsetList, type Query } from '@/lib/api/client';
import { errorMessage, isApiError } from '@/lib/api/errors';
import { qk } from '@/lib/query';

export interface DealFilters extends Query {
  q?: string;
  pipelineId?: string;
  stageId?: string;
  ownerId?: string;
  contactId?: string;
  companyId?: string;
  status?: string;
  closeFrom?: string;
  closeTo?: string;
  sort?: string;
  page?: number;
  pageSize?: number;
}

export interface BoardColumn {
  stage: { id: string; name: string; type: string; probability: number; sortOrder: number };
  deals: DealDto[];
  totalValue: number;
  count: number;
}

/** GET /deals/board answers with the resolved pipeline id alongside its columns. */
export interface BoardResponse {
  pipelineId: string;
  columns: BoardColumn[];
}

export function useDeals(filters: DealFilters = {}, enabled = true) {
  return useQuery({
    queryKey: qk.list('deals', filters),
    enabled,
    queryFn: (): Promise<OffsetList<DealDto>> => http.list<DealDto>('/api/v1/deals', filters),
  });
}

export function useDealBoard(params: { pipelineId?: string; ownerId?: string }, enabled = true) {
  return useQuery({
    queryKey: qk.list('deal-board', params),
    enabled,
    queryFn: () => http.get<BoardResponse>('/api/v1/deals/board', params),
  });
}

export function useDeal(id: string | null) {
  return useQuery({
    queryKey: qk.entity('deal', id ?? ''),
    enabled: id !== null && id !== '',
    queryFn: () => http.get<DealDto>(`/api/v1/deals/${id ?? ''}`),
  });
}

export function useDealHistory(id: string | null) {
  return useQuery({
    queryKey: qk.entity('deal-history', id ?? ''),
    enabled: id !== null,
    queryFn: () =>
      http.get<
        {
          id: string;
          fromStage: { id: string; name: string } | null;
          toStage: { id: string; name: string };
          changedBy: { id: string; name: string } | null;
          changedAt: string;
        }[]
      >(`/api/v1/deals/${id ?? ''}/history`),
  });
}

export function usePipelines() {
  return useQuery({
    queryKey: qk.list('pipelines'),
    queryFn: () => http.get<PipelineDto[]>('/api/v1/pipelines'),
    staleTime: 5 * 60_000,
  });
}

export function useDealMutations() {
  const qc = useQueryClient();
  const invalidate = (id?: string) => {
    void qc.invalidateQueries({ queryKey: qk.list('deals') });
    void qc.invalidateQueries({ queryKey: qk.list('deal-board') });
    if (id !== undefined) {
      void qc.invalidateQueries({ queryKey: qk.entity('deal', id) });
      void qc.invalidateQueries({ queryKey: qk.entity('deal-history', id) });
      void qc.invalidateQueries({ queryKey: qk.timeline('deal', id) });
    }
  };
  return {
    create: useMutation({
      mutationFn: (body: CreateDealBody | Record<string, unknown>) =>
        http.post<DealDto>('/api/v1/deals', body),
      onSuccess: (d) => {
        invalidate(d.id);
      },
    }),
    update: useMutation({
      mutationFn: ({ id, body }: { id: string; body: UpdateDealBody | Record<string, unknown> }) =>
        http.patch<DealDto>(`/api/v1/deals/${id}`, body),
      onSuccess: (d) => {
        invalidate(d.id);
      },
    }),
    remove: useMutation({
      mutationFn: (id: string) => http.del(`/api/v1/deals/${id}`),
      onSuccess: (_r, id) => {
        invalidate(id);
      },
    }),
    bulk: useMutation({
      mutationFn: (body: {
        action: 'assign' | 'delete' | 'stage';
        ids: string[];
        ownerId?: string | null;
        stageId?: string;
      }) => http.post<{ updated: number }>('/api/v1/deals/bulk', body),
      onSuccess: () => {
        invalidate();
      },
    }),
  };
}

/**
 * Optimistic stage change with rollback. A 409 means someone else moved the deal first; the card
 * snaps back and the message says so rather than silently re-rendering.
 */
export function useChangeStage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      stageId,
      expectedUpdatedAt,
      lostReason,
    }: {
      id: string;
      stageId: string;
      expectedUpdatedAt?: string;
      lostReason?: string;
    }) =>
      http.post<DealDto>(`/api/v1/deals/${id}/stage`, {
        stageId,
        ...(expectedUpdatedAt !== undefined ? { expectedUpdatedAt } : {}),
        ...(lostReason !== undefined ? { lostReason } : {}),
      }),
    onMutate: async ({ id, stageId }) => {
      await qc.cancelQueries({ queryKey: qk.list('deal-board') });
      const snapshots = qc.getQueriesData<BoardResponse>({ queryKey: qk.list('deal-board') });
      for (const [key, board] of snapshots) {
        if (board === undefined) continue;
        const moving = board.columns.flatMap((c) => c.deals).find((d) => d.id === id);
        if (moving === undefined) continue;
        qc.setQueryData<BoardResponse>(key, {
          ...board,
          columns: board.columns.map((c) => {
            const without = c.deals.filter((d) => d.id !== id);
            if (c.stage.id !== stageId) {
              return { ...c, deals: without, count: without.length, totalValue: sum(without) };
            }
            const next = [{ ...moving }, ...without];
            return { ...c, deals: next, count: next.length, totalValue: sum(next) };
          }),
        });
      }
      return { snapshots };
    },
    onError: (err, _v, ctx) => {
      for (const [key, value] of ctx?.snapshots ?? []) qc.setQueryData(key, value);
      const stale = isApiError(err) && err.status === 409;
      toast({
        tone: 'danger',
        title: stale ? 'Someone moved this deal first' : 'Could not move the deal',
        description: stale ? 'The board has been refreshed with their change.' : errorMessage(err),
      });
    },
    onSettled: (d) => {
      void qc.invalidateQueries({ queryKey: qk.list('deal-board') });
      void qc.invalidateQueries({ queryKey: qk.list('deals') });
      if (d !== undefined) void qc.invalidateQueries({ queryKey: qk.entity('deal', d.id) });
    },
  });
}

const sum = (deals: DealDto[]): number => deals.reduce((a, d) => a + d.value, 0);
