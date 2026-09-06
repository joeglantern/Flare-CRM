/**
 * Contacts (docs/09 · Contacts). Offset paginated (GAP-01) with cursor timelines and notes.
 */
import type {
  ContactDto,
  ContactSummaryDto,
  CreateContactBody,
  UpdateContactBody,
} from '@crm/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { http, type OffsetList, type Query } from '@/lib/api/client';
import { qk } from '@/lib/query';

export interface ContactFilters extends Query {
  q?: string;
  ownerId?: string;
  companyId?: string;
  tag?: string;
  source?: string;
  doNotCall?: 'true' | 'false';
  sort?: string;
  page?: number;
  pageSize?: number;
}

/** The list endpoint answers with the compact summary; the detail endpoint with the full DTO. */
export function useContacts(filters: ContactFilters = {}, enabled = true) {
  return useQuery({
    queryKey: qk.list('contacts', filters),
    enabled,
    queryFn: (): Promise<OffsetList<ContactSummaryDto>> =>
      http.list<ContactSummaryDto>('/api/v1/contacts', filters),
  });
}

export function useContact(id: string | null) {
  return useQuery({
    queryKey: qk.entity('contact', id ?? ''),
    enabled: id !== null && id !== '',
    queryFn: () => http.get<ContactDto>(`/api/v1/contacts/${id ?? ''}`),
  });
}

/** Typeahead for the contact picker; the phone disambiguates people with the same name. */
export function useContactSearch(q: string, enabled = true) {
  return useQuery({
    queryKey: qk.list('contacts-search', { q }),
    enabled: enabled && q.trim().length >= 2,
    staleTime: 30_000,
    queryFn: () => http.list<ContactSummaryDto>('/api/v1/contacts', { q, pageSize: 10 }),
    select: (r) => r.data,
  });
}

export function useContactMutations() {
  const qc = useQueryClient();
  const invalidate = (id?: string) => {
    void qc.invalidateQueries({ queryKey: qk.list('contacts') });
    if (id !== undefined) {
      void qc.invalidateQueries({ queryKey: qk.entity('contact', id) });
      void qc.invalidateQueries({ queryKey: qk.timeline('contact', id) });
    }
  };
  return {
    create: useMutation({
      mutationFn: (body: CreateContactBody | Record<string, unknown>) =>
        http.post<ContactDto>('/api/v1/contacts', body),
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
        body: UpdateContactBody | Record<string, unknown>;
      }) => http.patch<ContactDto>(`/api/v1/contacts/${id}`, body),
      onSuccess: (c) => {
        invalidate(c.id);
      },
    }),
    remove: useMutation({
      mutationFn: (id: string) => http.del(`/api/v1/contacts/${id}`),
      onSuccess: (_r, id) => {
        invalidate(id);
      },
    }),
    restore: useMutation({
      mutationFn: (id: string) => http.post<ContactDto>(`/api/v1/contacts/${id}/restore`),
      onSuccess: (c) => {
        invalidate(c.id);
      },
    }),
    erase: useMutation({
      mutationFn: (id: string) => http.post(`/api/v1/contacts/${id}/erase`),
      onSuccess: () => {
        invalidate();
      },
    }),
    /**
     * GAP-02: the API takes sourceId only and the target always wins, so field-level choice is a
     * pre-edit of the target followed by the merge. The dialog says so explicitly.
     */
    merge: useMutation({
      mutationFn: ({ targetId, sourceId }: { targetId: string; sourceId: string }) =>
        http.post<ContactDto>(`/api/v1/contacts/${targetId}/merge`, { sourceId }),
      onSuccess: (c) => {
        invalidate(c.id);
      },
    }),
    bulk: useMutation({
      mutationFn: (body: {
        action: 'assign' | 'tag' | 'untag' | 'delete';
        ids: string[];
        ownerId?: string | null;
        tag?: string;
      }) => http.post<{ updated: number }>('/api/v1/contacts/bulk', body),
      onSuccess: () => {
        invalidate();
      },
    }),
    setAvatar: useMutation({
      mutationFn: async ({ id, file }: { id: string; file: File }) => {
        const form = new FormData();
        form.append('file', file);
        const res = await fetch(`/api/v1/contacts/${id}/avatar`, {
          method: 'POST',
          body: form,
          credentials: 'include',
        });
        if (!res.ok) throw new Error('Upload failed');
        return (await res.json()) as { data: ContactDto };
      },
      onSuccess: (r) => {
        invalidate(r.data.id);
      },
    }),
    addPhone: useMutation({
      mutationFn: ({ id, body }: { id: string; body: unknown }) =>
        http.post<ContactDto>(`/api/v1/contacts/${id}/phones`, body),
      onSuccess: (c) => {
        invalidate(c.id);
      },
    }),
    updatePhone: useMutation({
      mutationFn: ({ id, phoneId, body }: { id: string; phoneId: string; body: unknown }) =>
        http.patch<ContactDto>(`/api/v1/contacts/${id}/phones/${phoneId}`, body),
      onSuccess: (c) => {
        invalidate(c.id);
      },
    }),
    removePhone: useMutation({
      mutationFn: ({ id, phoneId }: { id: string; phoneId: string }) =>
        http.del<ContactDto>(`/api/v1/contacts/${id}/phones/${phoneId}`),
      onSuccess: (c) => {
        invalidate(c.id);
      },
    }),
    addEmail: useMutation({
      mutationFn: ({ id, body }: { id: string; body: unknown }) =>
        http.post<ContactDto>(`/api/v1/contacts/${id}/emails`, body),
      onSuccess: (c) => {
        invalidate(c.id);
      },
    }),
    removeEmail: useMutation({
      mutationFn: ({ id, emailId }: { id: string; emailId: string }) =>
        http.del<ContactDto>(`/api/v1/contacts/${id}/emails/${emailId}`),
      onSuccess: (c) => {
        invalidate(c.id);
      },
    }),
  };
}

export interface DuplicateMatch {
  contact: ContactSummaryDto;
  matchedOn: 'phone' | 'email';
  value: string;
}

export function useDuplicates(params: { phone?: string; email?: string }, enabled = true) {
  return useQuery({
    queryKey: qk.list('contact-duplicates', params),
    enabled: enabled && (params.phone !== undefined || params.email !== undefined),
    queryFn: () => http.get<DuplicateMatch[]>('/api/v1/contacts/duplicates', params),
  });
}
