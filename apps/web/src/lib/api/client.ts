/**
 * Typed API client (docs/17 §3, docs/09). Types come from docs/openapi.json via
 * `pnpm openapi:types`; never hand-write request or response shapes.
 *
 * - same-origin, cookie auth (`credentials: 'include'`), no tokens in storage (docs/17 §5)
 * - every non-2xx response throws ApiError; 401s also notify `onUnauthenticated` listeners so the
 *   shell can redirect to sign-in once instead of every query handling it
 *
 * `api` is the literal-path client used where the generated types help. `http` is the same client
 * with the path as a string, for the many list/detail endpoints whose response DTOs already come
 * from `@crm/shared` — the schemas the server itself validates with, so nothing is hand-written.
 */
import createClient, { type Middleware } from 'openapi-fetch';
import { ApiError, apiErrorFromResponse, networkError } from './errors';
import type { paths } from './schema';

type Listener = (error: ApiError) => void;
const unauthenticatedListeners = new Set<Listener>();

export function onUnauthenticated(listener: Listener): () => void {
  unauthenticatedListeners.add(listener);
  return () => unauthenticatedListeners.delete(listener);
}

const throwOnError: Middleware = {
  async onResponse({ response }) {
    if (response.ok) return response;
    const error = await apiErrorFromResponse(response);
    if (error.isUnauthenticated) for (const l of unauthenticatedListeners) l(error);
    throw error;
  },
  onError({ error }) {
    throw networkError(error);
  },
};

export const api = createClient<paths>({
  baseUrl: '/',
  credentials: 'include',
  headers: { Accept: 'application/json' },
});
api.use(throwOnError);

/**
 * openapi-fetch returns `{ data, error, response }`; with the throwing middleware `data` is always
 * present on success. `unwrap` narrows that for query functions.
 */
export function unwrap<T>(result: { data?: T; error?: unknown; response: Response }): T {
  if (result.data === undefined) {
    throw new ApiError(
      result.response.status,
      'EMPTY_RESPONSE',
      'The server returned an empty response.',
      result.response.headers.get('x-request-id'),
      undefined,
    );
  }
  return result.data;
}

export type Query = Record<string, string | number | boolean | undefined | null>;

/** Drops empty values so a filter that is not set never reaches the query string. */
export function cleanQuery(q: Query | undefined): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(q ?? {})) {
    if (v === undefined || v === null || v === '') continue;
    out[k] = v;
  }
  return out;
}

interface Envelope<T> {
  data: T;
}
export interface OffsetPage {
  page: number;
  pageSize: number;
  total: number;
}
export interface CursorPage {
  cursor: string | null;
  hasMore: boolean;
}
export interface OffsetList<T> {
  data: T[];
  page: OffsetPage;
}
export interface CursorList<T> {
  data: T[];
  page: CursorPage;
}

const call = async <T>(
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  path: string,
  init: { query?: Query; body?: unknown } = {},
): Promise<T> => {
  const fn = api[method] as (p: never, o: never) => Promise<{ data?: T; response: Response }>;
  const options = {
    ...(init.query !== undefined ? { params: { query: cleanQuery(init.query) } } : {}),
    ...(init.body !== undefined ? { body: init.body } : {}),
  };
  return unwrap(await fn(path as never, options as never));
};

export const http = {
  /** `{ data }` envelope endpoints. */
  get: async <T>(path: string, query?: Query): Promise<T> =>
    (await call<Envelope<T>>('GET', path, { query })).data,
  /** Offset list endpoints (`{ data, page: { page, pageSize, total } }`). */
  list: <T>(path: string, query?: Query): Promise<OffsetList<T>> =>
    call<OffsetList<T>>('GET', path, { query }),
  /** Cursor list endpoints (`{ data, page: { cursor, hasMore } }`). */
  cursor: <T>(path: string, query?: Query): Promise<CursorList<T>> =>
    call<CursorList<T>>('GET', path, { query }),
  post: async <T>(path: string, body?: unknown, query?: Query): Promise<T> =>
    (await call<Envelope<T>>('POST', path, { body: body ?? {}, query })).data,
  patch: async <T>(path: string, body: unknown): Promise<T> =>
    (await call<Envelope<T>>('PATCH', path, { body })).data,
  put: async <T>(path: string, body: unknown): Promise<T> =>
    (await call<Envelope<T>>('PUT', path, { body })).data,
  del: async <T>(path: string, body?: unknown): Promise<T> =>
    (await call<Envelope<T>>('DELETE', path, body !== undefined ? { body } : {})).data,
  /** Endpoints that answer with a bare object rather than an envelope. */
  raw: <T>(
    method: 'GET' | 'POST',
    path: string,
    init?: { query?: Query; body?: unknown },
  ): Promise<T> => call<T>(method, path, init ?? {}),
};

/** Same-origin URL for streamed files and recordings. */
export function apiUrl(path: string): string {
  return path.startsWith('/') ? path : `/${path}`;
}

/**
 * Streams a CSV export to the browser. The sandboxed viewer cannot start a download from a data:
 * URL, so this goes through a same-origin request and an object URL.
 */
export async function downloadFile(
  path: string,
  query: Query | undefined,
  filename: string,
): Promise<void> {
  const search = new URLSearchParams(
    Object.entries(cleanQuery(query)).map(([k, v]) => [k, String(v)]),
  ).toString();
  const res = await fetch(`${path}${search === '' ? '' : `?${search}`}`, {
    credentials: 'include',
  });
  if (!res.ok) throw await apiErrorFromResponse(res);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 5_000);
}
