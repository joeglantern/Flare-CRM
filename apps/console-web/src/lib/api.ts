/**
 * The console's HTTP client. Same origin, cookie session, no tokens in storage.
 *
 * The CRM generates its client from an OpenAPI document because it has a hundred endpoints and
 * external consumers. The console has a couple of dozen and one consumer, so the response shapes
 * live in `types.ts` next to the screens that read them, and this is a thin wrapper that throws
 * ApiError on every non-2xx answer.
 */
import { ApiError, apiErrorFromResponse, networkError } from './errors';

type Listener = (error: ApiError) => void;
const unauthenticatedListeners = new Set<Listener>();

/** The shell subscribes once so a 401 redirects to sign-in in one place, not in every query. */
export function onUnauthenticated(listener: Listener): () => void {
  unauthenticatedListeners.add(listener);
  return () => unauthenticatedListeners.delete(listener);
}

export type Query = Record<string, string | number | boolean | undefined | null>;

function search(query: Query | undefined): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null || value === '') continue;
    params.set(key, String(value));
  }
  const qs = params.toString();
  return qs === '' ? '' : `?${qs}`;
}

export interface OffsetPage {
  page: number;
  pageSize: number;
  total: number;
}
export interface OffsetList<T> {
  data: T[];
  page: OffsetPage;
}

async function request<T>(
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  path: string,
  init: { query?: Query; body?: unknown } = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${path}${search(init.query)}`, {
      method,
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    });
  } catch (cause) {
    throw networkError(cause);
  }
  if (!response.ok) {
    const error = await apiErrorFromResponse(response);
    if (error.isUnauthenticated) for (const listener of unauthenticatedListeners) listener(error);
    throw error;
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

interface Envelope<T> {
  data: T;
}

/**
 * A URL for the browser to fetch itself, for a download.
 *
 * An export is the one thing this client does not fetch: a CSV of fifty thousand rows has no
 * business passing through JavaScript on its way to a file, so the screen uses a plain anchor and
 * the browser streams it straight to disk with the session cookie it already has.
 */
export function downloadUrl(path: string, query?: Query): string {
  return `${path}${search(query)}`;
}

export const http = {
  /** `{ data }` endpoints. */
  get: async <T>(path: string, query?: Query): Promise<T> =>
    (await request<Envelope<T>>('GET', path, { query })).data,
  /** `{ data, page }` endpoints. */
  list: <T>(path: string, query?: Query): Promise<OffsetList<T>> =>
    request<OffsetList<T>>('GET', path, { query }),
  post: async <T>(path: string, body?: unknown): Promise<T> =>
    (await request<Envelope<T>>('POST', path, { body: body ?? {} })).data,
  patch: async <T>(path: string, body: unknown): Promise<T> =>
    (await request<Envelope<T>>('PATCH', path, { body })).data,
  put: async <T>(path: string, body: unknown): Promise<T> =>
    (await request<Envelope<T>>('PUT', path, { body })).data,
  /** Deletes answer 204 with no body. */
  del: async (path: string): Promise<void> => {
    await request<unknown>('DELETE', path);
  },
};

export { ApiError };
