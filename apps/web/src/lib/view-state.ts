/**
 * Maps a query result plus permission and connectivity into the one `ViewState` every list and
 * panel understands, so the five states are decided in a single place rather than per screen.
 */
import type { ViewState } from '@/components/data/states';
import { isApiError } from './api/errors';

export interface ViewStateInput {
  allowed?: boolean;
  online?: boolean;
  isPending: boolean;
  isError: boolean;
  error?: unknown;
  /** Number of rows returned; 0 with no filters means empty, not "no matches". */
  count?: number;
}

export function viewStateOf({
  allowed = true,
  online = true,
  isPending,
  isError,
  error,
  count,
}: ViewStateInput): ViewState {
  if (!allowed) return 'forbidden';
  if (isError) {
    if (isApiError(error)) {
      if (error.isForbidden) return 'forbidden';
      if (error.code === 'NETWORK') return 'offline';
    }
    return 'error';
  }
  if (isPending) return 'loading';
  if (!online) return 'offline';
  if (count === 0) return 'empty';
  return 'ready';
}

export function errorInfo(error: unknown): { message?: string; requestId?: string | null } {
  if (isApiError(error)) return { message: error.message, requestId: error.requestId };
  if (error instanceof Error) return { message: error.message };
  return {};
}
