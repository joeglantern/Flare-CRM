/**
 * TanStack Query defaults, matching the CRM's: client errors are never retried, server and network
 * errors get two quick tries, data is fresh for half a minute and revalidates on focus.
 */
import { QueryClient } from '@tanstack/react-query';
import { isApiError } from './errors';

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: true,
        refetchOnReconnect: true,
        retry: (failureCount, error) => {
          if (isApiError(error) && !error.isRetryable) return false;
          return failureCount < 2;
        },
        retryDelay: (attempt) => Math.min(500 * 2 ** attempt, 4_000),
      },
      mutations: { retry: 0 },
    },
  });
}

/** One place where every key is spelled, so invalidation cannot drift from fetching. */
export const qk = {
  me: () => ['me'] as const,
  /**
   * Keyed by the filter, because the fleet is now a page of a filtered list rather than everything.
   * Invalidating with the bare key still clears every filtered variant of it.
   */
  fleet: (filter: Record<string, unknown> = {}) =>
    Object.keys(filter).length === 0 ? (['fleet'] as const) : (['fleet', filter] as const),
  customers: () => ['customers'] as const,
  customer: (id: string) => ['customer', id] as const,
  entitlements: (id: string) => ['entitlements', id] as const,
  contacts: (id: string) => ['contacts', id] as const,
  stacks: (filter: Record<string, unknown> = {}) =>
    Object.keys(filter).length === 0 ? (['stacks'] as const) : (['stacks', filter] as const),
  stack: (id: string) => ['stack', id] as const,
  stackSamples: (id: string, hours: number) => ['stackSamples', id, hours] as const,
  stackIssues: (id: string, page: number) => ['stackIssues', id, page] as const,
  notes: (id: string, page: number) => ['notes', id, page] as const,
  announcements: (id: string) => ['announcements', id] as const,
  /** Who can sign in to that customer's CRM, fetched only while the support tab is open. */
  supportUsers: (id: string) => ['supportUsers', id] as const,
  overview: (days: number) => ['overview', days] as const,
  customerAnalytics: (id: string, days: number) => ['customerAnalytics', id, days] as const,
  revenue: () => ['revenue'] as const,
  plans: (includeArchived = false) =>
    includeArchived ? (['plans', 'all'] as const) : (['plans'] as const),
  planCustomers: (id: string, page: number) => ['planCustomers', id, page] as const,
  catalogue: () => ['catalogue'] as const,
  owners: () => ['owners'] as const,
  settings: () => ['settings'] as const,
  alerts: (filter: Record<string, unknown> = {}) =>
    Object.keys(filter).length === 0 ? (['alerts'] as const) : (['alerts', filter] as const),
  alertSummary: () => ['alertSummary'] as const,
  alertSettings: () => ['alertSettings'] as const,
  alertMutes: () => ['alertMutes'] as const,
  /** A live probe of /ready, never served from cache for longer than it takes to draw. */
  readiness: () => ['readiness'] as const,
  audit: (filter: Record<string, unknown>) => ['audit', filter] as const,
} as const;
