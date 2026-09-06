/**
 * TanStack Query defaults (docs/17 section 3). Client errors are never retried; server and
 * network errors get two quick retries. Data is fresh for 30 s, then revalidates on focus.
 */
import { QueryClient } from '@tanstack/react-query';
import { isApiError } from './api/errors';

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

/** Stable key builders so invalidation is spelled the same way everywhere. */
export const qk = {
  me: () => ['me'] as const,
  settingsPublic: () => ['settings', 'public'] as const,
  settings: () => ['settings'] as const,
  notifications: (filter?: Record<string, unknown>) => ['notifications', filter ?? {}] as const,
  entity: (type: string, id: string) => ['entity', type, id] as const,
  list: (type: string, params?: Record<string, unknown>) => ['list', type, params ?? {}] as const,
  timeline: (type: string, id: string) => ['timeline', type, id] as const,
  cti: () => ['cti'] as const,
} as const;
