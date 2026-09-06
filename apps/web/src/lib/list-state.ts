/**
 * List state in the query string (Component Inventory · FilterBar): filters, sort, paging and the
 * open record all round-trip through the URL, so a filtered list can be shared and an export can
 * carry the same filters.
 */
import { useNavigate, useRouterState } from '@tanstack/react-router';
import { useCallback, useMemo } from 'react';
import type { SortState } from '@/components/data/DataTable';

export type SearchRecord = Record<string, string | number | boolean | null | undefined>;

export interface ListState<F extends SearchRecord> {
  filters: F;
  page: number;
  pageSize: number;
  sort: SortState;
  /** Merge patch; `undefined` clears a key. Any change resets to page 1 unless page is patched. */
  set: (patch: Partial<F> & { page?: number; pageSize?: number }) => void;
  setSort: (s: SortState) => void;
  setPage: (p: number) => void;
  setPageSize: (n: number) => void;
  reset: () => void;
  /** Filters only, ready to hand to an API call or an export. */
  queryParams: F & { page: number; pageSize: number; sort?: string };
  activeCount: number;
}

/** Drops empty entries without deleting computed keys, so the URL never carries "?owner=". */
function prune(record: SearchRecord): SearchRecord {
  return Object.fromEntries(
    Object.entries(record).filter(([, v]) => v !== undefined && v !== '' && v !== false),
  );
}

const RESERVED = new Set(['page', 'pageSize', 'sort', 'tab', 'create', 'edit', 'view', 'id']);

export function useListState<F extends SearchRecord>(
  defaults: Partial<F> = {},
  defaultPageSize = 25,
): ListState<F> {
  const navigate = useNavigate();
  const search = useRouterState({ select: (s) => s.location.search as SearchRecord });

  const page = Number(search.page ?? 1) || 1;
  const pageSize = Number(search.pageSize ?? defaultPageSize) || defaultPageSize;

  const sort = useMemo<SortState>(() => {
    const raw = search.sort;
    if (typeof raw !== 'string' || raw === '') return null;
    const desc = raw.startsWith('-');
    return { key: desc ? raw.slice(1) : raw, dir: desc ? 'desc' : 'asc' };
  }, [search]);

  const filters = useMemo(() => {
    const out: SearchRecord = { ...defaults };
    for (const [k, v] of Object.entries(search)) {
      if (RESERVED.has(k)) continue;
      out[k] = v === undefined || v === '' ? undefined : v;
    }
    return prune(out) as F;
    // `defaults` is a literal at every call site; the search object is the real dependency
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const patch = useCallback(
    (next: SearchRecord) => {
      void navigate({
        search: ((prev: SearchRecord) => {
          const merged: SearchRecord = { ...prev, ...next };
          if (!('page' in next)) merged.page = undefined;
          return prune(merged);
        }) as never,
        replace: true,
        resetScroll: false,
      });
    },
    [navigate],
  );

  return {
    filters,
    page,
    pageSize,
    sort,
    set: (p) => {
      patch(p);
    },
    setSort: (s) => {
      patch({ sort: s === null ? undefined : `${s.dir === 'desc' ? '-' : ''}${s.key}` });
    },
    setPage: (p) => {
      patch({ page: p > 1 ? p : undefined });
    },
    setPageSize: (n) => {
      patch({ pageSize: n === defaultPageSize ? undefined : n, page: undefined });
    },
    reset: () => {
      const cleared: SearchRecord = {};
      for (const k of Object.keys(search)) if (!RESERVED.has(k)) cleared[k] = undefined;
      patch(cleared);
    },
    queryParams: {
      ...filters,
      page,
      pageSize,
      ...(sort !== null ? { sort: `${sort.dir === 'desc' ? '-' : ''}${sort.key}` } : {}),
    },
    activeCount: Object.keys(filters).filter((k) => filters[k] !== undefined && filters[k] !== '')
      .length,
  };
}

/** Reads and writes a single search key (dialog open state, selected tab). */
export function useSearchParam(key: string): [string | undefined, (v: string | undefined) => void] {
  const navigate = useNavigate();
  const value = useRouterState({ select: (s) => (s.location.search as SearchRecord)[key] });
  const set = useCallback(
    (v: string | undefined) => {
      void navigate({
        search: ((prev: SearchRecord) => {
          return prune({ ...prev, [key]: v });
        }) as never,
        replace: true,
        resetScroll: false,
      });
    },
    [navigate, key],
  );
  return [value === undefined ? undefined : String(value), set];
}
