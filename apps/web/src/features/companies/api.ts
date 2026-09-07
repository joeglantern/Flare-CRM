/**
 * Companies (docs/09 · Companies).
 *
 * GAP-06: the DTO has `website` (a full URL) and `industry`; there is no `domain` and no `size`.
 * The list shows the website hostname and size lives as a custom field.
 * GAP-07: there is no deal aggregate on the DTO, so the open-deals column is computed client-side
 * from /deals?companyId for the visible page only, which is why it is not sortable.
 */
import type {
  CompanyDto,
  ContactDto,
  CreateCompanyBody,
  DealDto,
  UpdateCompanyBody,
} from '@crm/shared';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { http, type OffsetList, type Query } from '@/lib/api/client';
import { qk } from '@/lib/query';
import { MAX_PAGE_SIZE } from '@crm/shared';

export interface CompanyFilters extends Query {
  q?: string;
  ownerId?: string;
  industry?: string;
  sort?: string;
  page?: number;
  pageSize?: number;
}

export function useCompanies(filters: CompanyFilters = {}, enabled = true) {
  return useQuery({
    queryKey: qk.list('companies', filters),
    enabled,
    queryFn: (): Promise<OffsetList<CompanyDto>> =>
      http.list<CompanyDto>('/api/v1/companies', filters),
  });
}

export function useCompany(id: string | null) {
  return useQuery({
    queryKey: qk.entity('company', id ?? ''),
    enabled: id !== null && id !== '',
    queryFn: () => http.get<CompanyDto>(`/api/v1/companies/${id ?? ''}`),
  });
}

export function useCompanyContacts(id: string | null, enabled = true) {
  return useQuery({
    queryKey: qk.list('company-contacts', { id }),
    enabled: enabled && id !== null,
    queryFn: () =>
      http.list<ContactDto>(`/api/v1/companies/${id ?? ''}/contacts`, { pageSize: MAX_PAGE_SIZE }),
  });
}

export function useCompanySearch(q: string) {
  return useQuery({
    queryKey: qk.list('companies-search', { q }),
    enabled: q.trim().length >= 2,
    staleTime: 30_000,
    queryFn: () => http.list<CompanyDto>('/api/v1/companies', { q, pageSize: 10 }),
    select: (r) => r.data,
  });
}

/** GAP-07: one small deals query per visible company, batched with useQueries. */
export function useCompanyDealTotals(companyIds: string[], enabled: boolean) {
  const results = useQueries({
    queries: companyIds.map((id) => ({
      queryKey: qk.list('company-deal-total', { id }),
      enabled,
      staleTime: 60_000,
      queryFn: () =>
        http.list<DealDto>('/api/v1/deals', {
          companyId: id,
          status: 'open',
          pageSize: MAX_PAGE_SIZE,
        }),
      select: (r: OffsetList<DealDto>) => ({
        count: r.page.total,
        value: r.data.reduce((a, d) => a + d.value, 0),
      }),
    })),
  });
  const map: Record<string, { count: number; value: number } | undefined> = {};
  companyIds.forEach((id, i) => {
    map[id] = results[i]?.data;
  });
  return { map, loading: results.some((r) => r.isPending) };
}

export function useCompanyMutations() {
  const qc = useQueryClient();
  const invalidate = (id?: string) => {
    void qc.invalidateQueries({ queryKey: qk.list('companies') });
    if (id !== undefined) {
      void qc.invalidateQueries({ queryKey: qk.entity('company', id) });
      void qc.invalidateQueries({ queryKey: qk.timeline('company', id) });
    }
  };
  return {
    create: useMutation({
      mutationFn: (body: CreateCompanyBody | Record<string, unknown>) =>
        http.post<CompanyDto>('/api/v1/companies', body),
      onSuccess: (c) => {
        invalidate(c.id);
      },
    }),
    update: useMutation({
      mutationFn: ({
        id,
        body,
      }: {
        id: string;
        body: UpdateCompanyBody | Record<string, unknown>;
      }) => http.patch<CompanyDto>(`/api/v1/companies/${id}`, body),
      onSuccess: (c) => {
        invalidate(c.id);
      },
    }),
    remove: useMutation({
      mutationFn: (id: string) => http.del(`/api/v1/companies/${id}`),
      onSuccess: (_r, id) => {
        invalidate(id);
      },
    }),
  };
}
