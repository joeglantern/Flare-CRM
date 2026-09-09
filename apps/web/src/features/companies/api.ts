/**
 * Companies (docs/09 · Companies).
 *
 * GAP-06: the DTO has `website` (a full URL) and `industry`; there is no `domain` and no `size`.
 * The list shows the website hostname and size lives as a custom field.
 * Open deals are part of the company DTO (formerly GAP-07).
 */
import type { CompanyDto, ContactDto, CreateCompanyBody, UpdateCompanyBody } from '@crm/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
