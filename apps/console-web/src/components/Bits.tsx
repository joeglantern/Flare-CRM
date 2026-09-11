/**
 * The small pieces every console screen reuses: a live dot, a usage bar, a copyable line, a
 * table, and a labelled value list.
 */
import { Check, Copy } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Badge, Button, cn, IconButton, toast } from '@crm/ui';

export function StatusDot({ connected, label }: { connected: boolean; label?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5" title={label}>
      <span
        aria-hidden
        className={cn(
          'inline-block size-2 rounded-full',
          connected ? 'live-pulse bg-success' : 'bg-faint',
        )}
      />
      <span className="text-base">{label ?? (connected ? 'Live' : 'Offline')}</span>
    </span>
  );
}

/** Usage against a ceiling. With no ceiling there is nothing to draw, so it says so instead. */
export function UsageBar({
  used,
  max,
  label,
}: {
  used: number | null;
  max: number | null;
  label: string;
}) {
  if (used === null) return <span className="text-base text-muted">Not reported</span>;
  if (max === null) {
    return (
      <span className="text-base">
        {used} <span className="text-muted">of no limit</span>
      </span>
    );
  }
  const ratio = max === 0 ? 1 : Math.min(1, used / max);
  const tone = ratio >= 1 ? 'bg-danger' : ratio >= 0.8 ? 'bg-warning' : 'bg-flare';
  return (
    <span className="flex items-center gap-2">
      <span
        role="meter"
        aria-label={label}
        aria-valuenow={used}
        aria-valuemin={0}
        aria-valuemax={max}
        className="h-1.5 w-24 overflow-hidden rounded-full bg-hover"
      >
        <span
          aria-hidden
          className={cn('block h-full rounded-full', tone)}
          style={{ width: `${String(Math.round(ratio * 100))}%` }}
        />
      </span>
      <span className="tnum text-base">
        {used} / {max}
      </span>
    </span>
  );
}

export function CopyButton({ value, what }: { value: string; what: string }) {
  const [done, setDone] = useState(false);
  return (
    <IconButton
      icon={done ? Check : Copy}
      label={`Copy ${what}`}
      onClick={() => {
        void navigator.clipboard
          .writeText(value)
          .then(() => {
            setDone(true);
            setTimeout(() => {
              setDone(false);
            }, 1500);
          })
          .catch(() => {
            toast({ tone: 'danger', title: 'The browser would not let us copy that' });
          });
      }}
    />
  );
}

/** A value meant to be copied rather than read: a stack id, an env line, a public key. */
export function CopyLine({ value, what }: { value: string; what: string }) {
  return (
    <div className="flex items-center gap-2 rounded-sm border border-border bg-bg px-2 py-1.5">
      <code className="mono min-w-0 flex-1 truncate text-xs" title={value}>
        {value}
      </code>
      <CopyButton value={value} what={what} />
    </div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="mt-0.5 text-base break-words">{children}</dd>
    </div>
  );
}

export function Fields({ children, columns = 2 }: { children: ReactNode; columns?: 2 | 3 }) {
  return (
    <dl className={cn('grid gap-x-6 gap-y-4', columns === 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-2')}>
      {children}
    </dl>
  );
}

export interface Column<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  align?: 'start' | 'end';
  className?: string;
}

/**
 * A plain table. The CRM has a virtualised one because it shows ten thousand contacts; the console
 * shows the customers of one business, so this stays a table element and keeps its semantics.
 */
export function Table<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  caption,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  caption?: string;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-base">
        {caption !== undefined && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr className="border-b border-border text-left text-sm text-muted">
            {columns.map((c) => (
              <th
                key={c.key}
                scope="col"
                className={cn(
                  'px-3 py-2 font-medium',
                  c.align === 'end' && 'text-right',
                  c.className,
                )}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              className={cn(
                'border-b border-border last:border-0',
                onRowClick !== undefined && 'cursor-pointer hover:bg-hover',
              )}
              {...(onRowClick !== undefined
                ? {
                    onClick: () => {
                      onRowClick(row);
                    },
                  }
                : {})}
            >
              {columns.map((c) => (
                <td
                  key={c.key}
                  className={cn('px-3 py-2 align-middle', c.align === 'end' && 'text-right')}
                >
                  {c.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * One page of something, and the way to the next.
 *
 * It draws nothing when everything fits on one page: a pager under a list of four rows is furniture
 * that tells nobody anything. The labels are given by the caller because "older" is right for a log
 * and wrong for a list of customers.
 */
export function Pager({
  page,
  pageSize,
  total,
  onChange,
  labels = { previous: 'Previous', next: 'Next' },
  noun = 'rows',
}: {
  page: number;
  pageSize: number;
  total: number;
  onChange: (page: number) => void;
  labels?: { previous: string; next: string };
  noun?: string;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return null;
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm text-muted">
        Page {page} of {pages}, {total} {noun}
      </span>
      <span className="flex gap-2">
        <Button
          size="sm"
          disabled={page <= 1}
          onClick={() => {
            onChange(page - 1);
          }}
        >
          {labels.previous}
        </Button>
        <Button
          size="sm"
          disabled={page >= pages}
          onClick={() => {
            onChange(page + 1);
          }}
        >
          {labels.next}
        </Button>
      </span>
    </div>
  );
}

export function IssueStatusBadge({ status }: { status: string }) {
  const tone =
    status === 'acked'
      ? 'success'
      : status === 'rejected'
        ? 'danger'
        : status === 'delivered'
          ? 'info'
          : status === 'superseded'
            ? 'neutral'
            : 'warning';
  return <Badge tone={tone}>{status}</Badge>;
}
