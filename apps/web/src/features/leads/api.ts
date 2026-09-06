/**
 * Leads (docs/09 · Leads), including conversion (Flows · Lead to deal).
 */
import type { ConvertLeadBody, CreateLeadBody, LeadDto, UpdateLeadBody } from '@crm/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { http, type OffsetList, type Query } from '@/lib/api/client';
import { qk } from '@/lib/query';

export interface LeadFilters extends Query {
  q?: string;
  status?: string;
  source?: string;
  ownerId?: string;
  sort?: string;
  page?: number;
  pageSize?: number;
}

export function useLeads(filters: LeadFilters = {}, enabled = true) {
  return useQuery({
    queryKey: qk.list('leads', filters),
    enabled,
    queryFn: (): Promise<OffsetList<LeadDto>> => http.list<LeadDto>('/api/v1/leads', filters),
  });
}

export function useLead(id: string | null) {
  return useQuery({
    queryKey: qk.entity('lead', id ?? ''),
    enabled: id !== null && id !== '',
    queryFn: () => http.get<LeadDto>(`/api/v1/leads/${id ?? ''}`),
  });
}

export interface ConvertResult {
  lead: LeadDto;
  contactId: string;
  dealId: string | null;
  companyId: string | null;
}

export function useLeadMutations() {
  const qc = useQueryClient();
  const invalidate = (id?: string) => {
    void qc.invalidateQueries({ queryKey: qk.list('leads') });
    if (id !== undefined) {
      void qc.invalidateQueries({ queryKey: qk.entity('lead', id) });
      void qc.invalidateQueries({ queryKey: qk.timeline('lead', id) });
    }
  };
  return {
    create: useMutation({
      mutationFn: (body: CreateLeadBody | Record<string, unknown>) =>
        http.post<LeadDto>('/api/v1/leads', body),
      onSuccess: (l) => {
        invalidate(l.id);
      },
    }),
    update: useMutation({
      mutationFn: ({ id, body }: { id: string; body: UpdateLeadBody | Record<string, unknown> }) =>
        http.patch<LeadDto>(`/api/v1/leads/${id}`, body),
      onSuccess: (l) => {
        invalidate(l.id);
      },
    }),
    remove: useMutation({
      mutationFn: (id: string) => http.del(`/api/v1/leads/${id}`),
      onSuccess: (_r, id) => {
        invalidate(id);
      },
    }),
    bulk: useMutation({
      mutationFn: (body: {
        action: 'assign' | 'delete' | 'status';
        ids: string[];
        ownerId?: string | null;
        status?: string;
      }) => http.post<{ updated: number }>('/api/v1/leads/bulk', body),
      onSuccess: () => {
        invalidate();
      },
    }),
    convert: useMutation({
      mutationFn: ({ id, body }: { id: string; body: ConvertLeadBody | Record<string, unknown> }) =>
        http.post<ConvertResult>(`/api/v1/leads/${id}/convert`, body),
      onSuccess: (_r, { id }) => {
        invalidate(id);
        void qc.invalidateQueries({ queryKey: qk.list('contacts') });
        void qc.invalidateQueries({ queryKey: qk.list('deals') });
        void qc.invalidateQueries({ queryKey: qk.list('deal-board') });
        void qc.invalidateQueries({ queryKey: qk.list('companies') });
      },
    }),
  };
}
