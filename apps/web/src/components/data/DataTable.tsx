/**
 * DataTable (Component Inventory · Data display) — the table behind every list screen:
 * sorting, column visibility, bulk selection, pagination and all five states.
 *
 * Pagination is a union because the backend is (GAP-01): most lists are offset (page, pageSize,
 * total); activity, notes, notifications, conversations and messages are cursor based. Offset
 * lists get numbered Previous/Next with "Showing 1–25 of 412"; cursor lists get "Load older".
 * `bulkActions` is simply absent where no bulk endpoint exists (tasks, conversations).
 */
import {
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  Columns3,
  MoreHorizontal,
  X,
} from 'lucide-react';
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { Button, IconButton } from '@/components/ui/Button';
import { Checkbox } from '@/components/ui/Toggle';
import { DropdownMenu, Popover, type MenuItemDef } from '@/components/ui/Menu';
import { Skeleton } from '@/components/ui/Loading';
import { cn } from '@/lib/utils';
import {
  EmptyState,
  ErrorState,
  ForbiddenState,
  OfflineState,
  type EmptyStateProps,
  type ForbiddenStateProps,
  type ViewState,
} from './states';

export interface Column<T> {
  key: string;
  header: ReactNode;
  /** CSS grid track, e.g. "1.4fr" or "120px". */
  width?: string;
  align?: 'start' | 'end';
  sortable?: boolean;
  hideable?: boolean;
  /** Hidden by default until the user turns it on in the column chooser. */
  optional?: boolean;
  render: (row: T) => ReactNode;
  /** Label for the column chooser when the header is not a plain string. */
  label?: string;
}

export interface BulkAction {
  id: string;
  label: string;
  icon?: React.ComponentType<{ size?: number }>;
  danger?: boolean;
  onRun: (ids: string[]) => void;
}

export type SortState = { key: string; dir: 'asc' | 'desc' } | null;

export type PaginationState =
  | { kind: 'offset'; page: number; pageSize: number; total: number }
  | { kind: 'cursor'; hasMore: boolean; loadingMore?: boolean };

export interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  state: ViewState;
  sort?: SortState;
  onSortChange?: (s: SortState) => void;
  selection?: string[];
  onSelectionChange?: (ids: string[]) => void;
  bulkActions?: BulkAction[];
  pagination?: PaginationState;
  onPageChange?: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
  onLoadMore?: () => void;
  onRowClick?: (row: T) => void;
  emptyState?: EmptyStateProps;
  forbidden?: ForbiddenStateProps;
  error?: { message?: string; requestId?: string | null };
  onRetry?: () => void;
  /** Horizontal scroll below this width. */
  minWidth?: number;
  /** The real endpoint this view calls, shown under the table (design convention). */
  endpoint?: string;
  /** Extra note under the table, e.g. why a column is not sortable. */
  note?: ReactNode;
  rowHref?: (row: T) => string;
  /** Per-row overflow menu, rendered in a trailing column that never scrolls out of reach. */
  rowActions?: (row: T) => (MenuItemDef | 'separator')[];
  className?: string;
  tableId?: string;
  skeletonRows?: number;
  ariaLabel?: string;
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  state,
  sort,
  onSortChange,
  selection,
  onSelectionChange,
  bulkActions,
  pagination,
  onPageChange,
  onPageSizeChange,
  onLoadMore,
  onRowClick,
  rowActions,
  emptyState,
  forbidden,
  error,
  onRetry,
  minWidth = 720,
  endpoint,
  note,
  className,
  tableId,
  skeletonRows = 8,
  ariaLabel,
}: DataTableProps<T>) {
  const chooserRef = useRef<HTMLButtonElement | null>(null);
  const [chooserOpen, setChooserOpen] = useState(false);
  const [hidden, setHidden] = useState<string[]>(() => readHidden(tableId, columns));

  const visible = useMemo(() => columns.filter((c) => !hidden.includes(c.key)), [columns, hidden]);
  const selectable = selection !== undefined && onSelectionChange !== undefined;
  const template = `${selectable ? '36px ' : ''}${visible.map((c) => c.width ?? '1fr').join(' ')}${
    rowActions !== undefined ? ' 36px' : ''
  }`;

  const allSelected =
    selectable && rows.length > 0 && rows.every((r) => selection.includes(rowKey(r)));
  const someSelected = selectable && rows.some((r) => selection.includes(rowKey(r)));

  const setHiddenPersisted = (next: string[]) => {
    setHidden(next);
    if (tableId !== undefined) {
      try {
        localStorage.setItem(`flare.cols.${tableId}`, JSON.stringify(next));
      } catch {
        /* private mode: the choice lasts for this session only */
      }
    }
  };

  const failure =
    state === 'error' || state === 'forbidden' || state === 'offline' || state === 'empty';

  return (
    <div className={cn('flex min-w-0 flex-col', className)}>
      {selectable &&
        selection.length > 0 &&
        bulkActions !== undefined &&
        bulkActions.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-t-md border border-b-0 border-border bg-[var(--flare-subtle)] px-3 py-2 text-sm">
            <span className="font-medium text-flare-on">{selection.length} selected</span>
            {bulkActions.map((a) => (
              <Button
                key={a.id}
                size="sm"
                variant={a.danger === true ? 'danger' : 'secondary'}
                icon={a.icon as never}
                onClick={() => {
                  a.onRun(selection);
                }}
              >
                {a.label}
              </Button>
            ))}
            <button
              type="button"
              onClick={() => {
                onSelectionChange([]);
              }}
              className="ml-auto text-sm text-muted hover:text-text"
            >
              Clear
            </button>
          </div>
        )}

      <div
        className={cn(
          'min-w-0 overflow-x-auto rounded-md border border-border bg-surface',
          selectable &&
            selection.length > 0 &&
            bulkActions !== undefined &&
            bulkActions.length > 0 &&
            'rounded-t-none',
        )}
      >
        <div style={{ minWidth }} role="table" aria-label={ariaLabel} aria-rowcount={rows.length}>
          <div
            role="row"
            style={{ gridTemplateColumns: template }}
            className="grid h-[34px] items-center gap-3 border-b border-border px-3 text-sm font-medium text-muted"
          >
            {selectable && (
              <Checkbox
                ariaLabel={allSelected ? 'Clear selection' : 'Select all on this page'}
                checked={allSelected}
                indeterminate={!allSelected && someSelected}
                onChange={(v) => {
                  onSelectionChange(v ? rows.map(rowKey) : []);
                }}
              />
            )}
            {visible.map((c) => {
              const active = sort?.key === c.key;
              const inner = (
                <span
                  className={cn('inline-flex items-center gap-1 truncate', active && 'text-text')}
                >
                  {c.header}
                  {active &&
                    (sort.dir === 'asc' ? (
                      <ArrowUp size={12} aria-hidden />
                    ) : (
                      <ArrowDown size={12} aria-hidden />
                    ))}
                </span>
              );
              return (
                <div
                  key={c.key}
                  role="columnheader"
                  aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                  className={cn('min-w-0 truncate', c.align === 'end' && 'text-right')}
                >
                  {c.sortable === true && onSortChange !== undefined ? (
                    <button
                      type="button"
                      className="max-w-full truncate hover:text-text"
                      onClick={() => {
                        onSortChange(
                          active && sort.dir === 'asc'
                            ? { key: c.key, dir: 'desc' }
                            : active && sort.dir === 'desc'
                              ? null
                              : { key: c.key, dir: 'asc' },
                        );
                      }}
                    >
                      {inner}
                    </button>
                  ) : (
                    inner
                  )}
                </div>
              );
            })}
          </div>

          {state === 'loading' &&
            Array.from({ length: skeletonRows }, (_, i) => (
              <div
                key={i}
                role="row"
                style={{ gridTemplateColumns: template }}
                className="grid h-9 items-center gap-3 border-b border-border px-3"
              >
                {selectable && <Skeleton width={16} height={16} />}
                {visible.map((c, j) => (
                  <Skeleton key={c.key} height={12} width={`${String(70 - ((i + j) % 4) * 12)}%`} />
                ))}
              </div>
            ))}

          {state === 'ready' &&
            rows.map((row) => {
              const id = rowKey(row);
              const isSelected = selectable && selection.includes(id);
              return (
                <div
                  key={id}
                  role="row"
                  tabIndex={onRowClick !== undefined ? 0 : undefined}
                  onClick={
                    onRowClick !== undefined
                      ? () => {
                          onRowClick(row);
                        }
                      : undefined
                  }
                  onKeyDown={
                    onRowClick !== undefined
                      ? (e) => {
                          if (e.key === 'Enter') onRowClick(row);
                        }
                      : undefined
                  }
                  style={{ gridTemplateColumns: template }}
                  className={cn(
                    'grid h-9 items-center gap-3 border-b border-border px-3 text-base',
                    isSelected ? 'bg-[var(--flare-subtle)]' : 'hover:bg-hover',
                    onRowClick !== undefined && 'cursor-pointer',
                  )}
                >
                  {selectable && (
                    <span
                      onClick={(e) => {
                        e.stopPropagation();
                      }}
                      onKeyDown={(e) => {
                        e.stopPropagation();
                      }}
                      role="presentation"
                    >
                      <Checkbox
                        ariaLabel="Select row"
                        checked={isSelected}
                        onChange={(v) => {
                          onSelectionChange(
                            v ? [...selection, id] : selection.filter((s) => s !== id),
                          );
                        }}
                      />
                    </span>
                  )}
                  {visible.map((c) => (
                    <div
                      key={c.key}
                      className={cn('min-w-0 truncate', c.align === 'end' && 'text-right')}
                    >
                      {c.render(row)}
                    </div>
                  ))}
                  {rowActions !== undefined && <RowMenu items={rowActions(row)} />}
                </div>
              );
            })}

          {failure && (
            <div className="px-3">
              {state === 'empty' && emptyState !== undefined && <EmptyState {...emptyState} />}
              {state === 'forbidden' && <ForbiddenState {...forbidden} />}
              {state === 'offline' && (
                <OfflineState {...(onRetry !== undefined ? { onRetry } : {})} />
              )}
              {state === 'error' && (
                <ErrorState
                  {...(error?.message !== undefined ? { message: error.message } : {})}
                  {...(error?.requestId !== undefined ? { requestId: error.requestId } : {})}
                  {...(onRetry !== undefined ? { onRetry } : {})}
                />
              )}
            </div>
          )}
        </div>
      </div>

      {(pagination !== undefined ||
        endpoint !== undefined ||
        columns.some((c) => c.hideable === true)) && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-1 py-2 text-sm text-muted">
          {pagination?.kind === 'offset' && state === 'ready' && (
            <span className="tnum">
              {pagination.total === 0
                ? 'No rows'
                : `Showing ${String((pagination.page - 1) * pagination.pageSize + 1)}–${String(
                    Math.min(pagination.page * pagination.pageSize, pagination.total),
                  )} of ${pagination.total.toLocaleString('en-KE')}`}
            </span>
          )}
          {pagination?.kind === 'cursor' && pagination.hasMore && onLoadMore !== undefined && (
            <Button
              size="sm"
              variant="secondary"
              loading={pagination.loadingMore === true}
              onClick={onLoadMore}
            >
              Load older
            </Button>
          )}

          <div className="ml-auto flex items-center gap-2">
            {columns.some((c) => c.hideable === true) && (
              <>
                <Button
                  ref={chooserRef}
                  size="sm"
                  variant="ghost"
                  icon={Columns3}
                  onClick={() => {
                    setChooserOpen((o) => !o);
                  }}
                >
                  Columns
                </Button>
                <Popover
                  open={chooserOpen}
                  onOpenChange={setChooserOpen}
                  anchor={chooserRef}
                  align="end"
                  width={220}
                >
                  <div className="flex flex-col gap-1.5 p-2">
                    {columns.map((c) => (
                      <Checkbox
                        key={c.key}
                        checked={!hidden.includes(c.key)}
                        disabled={c.hideable !== true}
                        title={c.hideable !== true ? 'This column is always shown' : undefined}
                        label={c.label ?? (typeof c.header === 'string' ? c.header : c.key)}
                        onChange={(v) => {
                          setHiddenPersisted(
                            v ? hidden.filter((k) => k !== c.key) : [...hidden, c.key],
                          );
                        }}
                      />
                    ))}
                  </div>
                </Popover>
              </>
            )}

            {pagination?.kind === 'offset' && onPageSizeChange !== undefined && (
              <label className="flex items-center gap-1.5">
                Rows
                <select
                  value={pagination.pageSize}
                  onChange={(e) => {
                    onPageSizeChange(Number(e.target.value));
                  }}
                  className="h-6 rounded-sm border border-border bg-transparent px-1 text-sm text-text"
                >
                  {[25, 50, 100].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {pagination?.kind === 'offset' && onPageChange !== undefined && (
              <span className="flex items-center gap-1">
                <IconButton
                  icon={ChevronLeft}
                  label="Previous page"
                  size={26}
                  variant="ghost"
                  disabled={pagination.page <= 1}
                  onClick={() => {
                    onPageChange(pagination.page - 1);
                  }}
                />
                <IconButton
                  icon={ChevronRight}
                  label="Next page"
                  size={26}
                  variant="ghost"
                  disabled={pagination.page * pagination.pageSize >= pagination.total}
                  onClick={() => {
                    onPageChange(pagination.page + 1);
                  }}
                />
              </span>
            )}
          </div>

          {(endpoint !== undefined || note !== undefined) && (
            <div className="mono w-full text-xs text-faint">
              {endpoint}
              {note !== undefined && <span className="ml-2 font-sans not-italic">{note}</span>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function readHidden<T>(tableId: string | undefined, columns: Column<T>[]): string[] {
  const defaults = columns.filter((c) => c.optional === true).map((c) => c.key);
  if (tableId === undefined) return defaults;
  try {
    const raw = localStorage.getItem(`flare.cols.${tableId}`);
    if (raw === null) return defaults;
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((k): k is string => typeof k === 'string')
      : defaults;
  } catch {
    return defaults;
  }
}

/** Standalone bulk bar for screens that manage their own layout. */
export function BulkActionBar({
  count,
  actions,
  onClear,
  note,
}: {
  count: number;
  actions: BulkAction[];
  onClear: () => void;
  note?: ReactNode;
}) {
  if (count === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md bg-[var(--flare-subtle)] px-3 py-2 text-sm">
      <span className="font-medium text-flare-on">{count} selected</span>
      {actions.map((a) => (
        <Button
          key={a.id}
          size="sm"
          variant={a.danger === true ? 'danger' : 'secondary'}
          icon={a.icon as never}
          onClick={() => {
            a.onRun([]);
          }}
        >
          {a.label}
        </Button>
      ))}
      {note !== undefined && <span className="text-xs text-muted">{note}</span>}
      <IconButton
        icon={X}
        label="Clear selection"
        size={26}
        variant="ghost"
        className="ml-auto"
        onClick={onClear}
      />
    </div>
  );
}

/** Trailing overflow menu on a row. Its own component so each row owns its open state. */
function RowMenu({ items }: { items: (MenuItemDef | 'separator')[] }) {
  const ref = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  if (items.length === 0) return <span />;
  return (
    <span
      role="presentation"
      onClick={(e) => {
        e.stopPropagation();
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
      }}
    >
      <IconButton
        ref={ref}
        icon={MoreHorizontal}
        label="Row actions"
        size={26}
        variant="ghost"
        onClick={() => {
          setOpen(true);
        }}
      />
      <DropdownMenu open={open} onOpenChange={setOpen} anchor={ref} items={items} />
    </span>
  );
}
