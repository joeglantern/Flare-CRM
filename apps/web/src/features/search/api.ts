/**
 * Global search.
 *
 * GAP-13: the design assumes `GET /search?q=` returning grouped results, but no such endpoint
 * exists. The UI therefore fans out across the real list endpoints in parallel — contacts,
 * companies, deals and leads each accept `q` — and groups the results client-side. A query that
 * parses as a phone number also offers Call as the first action, using the same `q` match the
 * server already does on phone digits.
 */
import { useQuery } from '@tanstack/react-query';
import { api, unwrap } from '@/lib/api/client';
import { toE164 } from '@crm/shared';
import { formatPhone } from '@/lib/format';

export type SearchGroupKind = 'contacts' | 'companies' | 'deals' | 'leads';

export interface SearchHit {
  id: string;
  kind: SearchGroupKind;
  title: string;
  subtitle?: string | null;
  meta?: string | null;
  /** E.164 for the dial action on contact and lead hits. */
  e164?: string | null;
  avatarUrl?: string | null;
  href: string;
}

export interface SearchResults {
  groups: { kind: SearchGroupKind; label: string; hits: SearchHit[] }[];
  total: number;
  /** Set when the query itself is a dialable number. */
  dialable: string | null;
}

const LABEL: Record<SearchGroupKind, string> = {
  contacts: 'Contacts',
  companies: 'Companies',
  deals: 'Deals',
  leads: 'Leads',
};

interface ListResponse<T> {
  data: T[];
}

async function safeList<T>(fn: () => Promise<ListResponse<T>>): Promise<T[]> {
  try {
    return (await fn()).data;
  } catch {
    // a 403 on one entity must not blank the whole palette
    return [];
  }
}

export function useGlobalSearch(query: string, country = 'KE') {
  const q = query.trim();
  return useQuery({
    queryKey: ['search', q],
    enabled: q.length >= 2,
    staleTime: 20_000,
    queryFn: async (): Promise<SearchResults> => {
      const params = { limit: 5, page: 1, pageSize: 5, q } as never;
      const [contacts, companies, deals, leads] = await Promise.all([
        safeList<{
          id: string;
          displayName: string;
          company: { name: string } | null;
          primaryPhone: string | null;
          avatarUrl: string | null;
        }>(
          async () =>
            unwrap(await api.GET('/api/v1/contacts', { params: { query: params } })) as never,
        ),
        safeList<{ id: string; name: string; industry: string | null; contactCount: number }>(
          async () =>
            unwrap(await api.GET('/api/v1/companies', { params: { query: params } })) as never,
        ),
        safeList<{
          id: string;
          title: string;
          value: string | number | null;
          stage: { name: string } | null;
          contact: { displayName: string } | null;
        }>(
          async () =>
            unwrap(await api.GET('/api/v1/deals', { params: { query: params } })) as never,
        ),
        safeList<{
          id: string;
          firstName: string;
          lastName: string | null;
          companyName: string | null;
          phone: string | null;
          phoneDisplay: string | null;
          status: string;
        }>(
          async () =>
            unwrap(await api.GET('/api/v1/leads', { params: { query: params } })) as never,
        ),
      ]);

      const groups: SearchResults['groups'] = [];
      if (contacts.length > 0) {
        groups.push({
          kind: 'contacts',
          label: LABEL.contacts,
          hits: contacts.map((c) => ({
            id: c.id,
            kind: 'contacts',
            title: c.displayName,
            subtitle: c.company?.name ?? null,
            meta: c.primaryPhone === null ? null : formatPhone(c.primaryPhone),
            e164: c.primaryPhone,
            avatarUrl: c.avatarUrl,
            href: `/contacts/${c.id}`,
          })),
        });
      }
      if (companies.length > 0) {
        groups.push({
          kind: 'companies',
          label: LABEL.companies,
          hits: companies.map((c) => ({
            id: c.id,
            kind: 'companies',
            title: c.name,
            subtitle: c.industry,
            meta: `${String(c.contactCount)} contacts`,
            href: `/companies/${c.id}`,
          })),
        });
      }
      if (deals.length > 0) {
        groups.push({
          kind: 'deals',
          label: LABEL.deals,
          hits: deals.map((d) => ({
            id: d.id,
            kind: 'deals',
            title: d.title,
            subtitle: d.contact?.displayName ?? null,
            meta: d.stage?.name ?? null,
            href: `/deals/${d.id}`,
          })),
        });
      }
      if (leads.length > 0) {
        groups.push({
          kind: 'leads',
          label: LABEL.leads,
          hits: leads.map((l) => ({
            id: l.id,
            kind: 'leads',
            title: [l.firstName, l.lastName].filter(Boolean).join(' '),
            subtitle: l.companyName,
            meta: l.phoneDisplay ?? l.status,
            e164: l.phone,
            href: `/leads/${l.id}`,
          })),
        });
      }

      const digits = q.replace(/[^\d+]/g, '');
      const dialable = digits.length >= 7 ? toE164(q, country as never) : null;
      return { groups, total: groups.reduce((a, g) => a + g.hits.length, 0), dialable };
    },
  });
}
