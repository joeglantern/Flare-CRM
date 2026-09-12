/**
 * Every server running a customer's CRM, in one list.
 *
 * The customers screen answers "how is this business doing". This one answers "which machine is
 * unhappy", which is a different question and the one asked at three in the morning. Quiet is the
 * filter that matters most, and a stack that has never reported in counts as quiet: a credential
 * pasted onto a server that was never started is exactly what nobody notices.
 *
 * Rows update from the same socket event the customers screen uses, so a stack coming back turns
 * green here too without anybody refetching.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useCallback, useEffect, useState } from 'react';
import type { ConsoleServerPayload, StackUsage } from '@crm/shared';
import { Badge, Input, Segmented } from '@crm/ui';
import { Pager, StatusDot, Table, type Column } from '@/components/Bits';
import { EmptyState, PageHeader, StateSlot } from '@/components/Page';
import { http, type OffsetList } from '@/lib/api';
import { ago, bytes } from '@/lib/format';
import { qk } from '@/lib/query';
import { useConsoleEvent } from '@/lib/socket';
import type { StackRow } from '@/lib/types';

const PAGE_SIZE = 50;

/** The three questions worth a button, and what each one asks the server. */
type Shown = 'live' | 'quiet' | 'revoked' | 'all';
const SHOWN: { value: Shown; label: string }[] = [
  { value: 'live', label: 'Connected' },
  { value: 'quiet', label: 'Quiet' },
  { value: 'revoked', label: 'Revoked' },
  { value: 'all', label: 'All' },
];

/** How long a stack has to be silent before this screen calls it quiet. */
const QUIET_MINUTES = 10;

function paramsFor(shown: Shown, q: string, page: number) {
  return {
    page,
    pageSize: PAGE_SIZE,
    ...(q === '' ? {} : { q }),
    ...(shown === 'live' ? { connected: 'true' } : {}),
    ...(shown === 'quiet' ? { staleMinutes: QUIET_MINUTES } : {}),
    ...(shown === 'revoked' ? { revoked: 'only' } : {}),
    ...(shown === 'all' ? { revoked: 'include' } : {}),
  };
}

export function StacksScreen() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [typed, setTyped] = useState('');
  const [q, setQ] = useState('');
  const [shown, setShown] = useState<Shown>('all');
  const [page, setPage] = useState(1);

  useEffect(() => {
    const timer = setTimeout(() => {
      setQ(typed.trim());
      setPage(1);
    }, 300);
    return () => {
      clearTimeout(timer);
    };
  }, [typed]);

  const params = paramsFor(shown, q, page);
  const stacks = useQuery({
    queryKey: qk.stacks(params),
    queryFn: () => http.list<StackRow>('/api/v1/stacks', params),
  });

  const onStack = useCallback(
    (event: ConsoleServerPayload<'fleet:stack'>) => {
      queryClient.setQueryData<OffsetList<StackRow>>(qk.stacks(params), (previous) =>
        previous === undefined
          ? previous
          : {
              ...previous,
              data: previous.data.map((row) =>
                row.id === event.stackId
                  ? {
                      ...row,
                      connected: event.connected,
                      lastSeenAt: event.lastSeenAt,
                      version: event.version,
                      usage: event.usage,
                      lastBackupAt: event.lastBackupAt,
                    }
                  : row,
              ),
            },
      );
    },
    [queryClient, params],
  );
  useConsoleEvent('fleet:stack', onStack);

  const rows = stacks.data?.data ?? [];

  const columns: Column<StackRow>[] = [
    {
      key: 'stack',
      header: 'Stack',
      cell: (row) => (
        <span className="flex flex-col">
          <span className="flex items-center gap-2 font-medium">
            {row.label}
            {row.revokedAt !== null && <Badge tone="neutral">Revoked</Badge>}
          </span>
          <code className="mono text-xs text-muted">{row.id}</code>
        </span>
      ),
    },
    {
      key: 'customer',
      header: 'Customer',
      cell: (row) => (
        <Link
          to="/customers/$customerId"
          params={{ customerId: row.customer.id }}
          className="no-underline hover:underline"
          onClick={(e) => {
            e.stopPropagation();
          }}
        >
          {row.customer.name}
        </Link>
      ),
    },
    {
      key: 'state',
      header: 'State',
      cell: (row) =>
        row.revokedAt === null ? (
          <StatusDot connected={row.connected} />
        ) : (
          <span className="text-sm text-muted">Refused</span>
        ),
    },
    {
      key: 'seats',
      header: 'Seats',
      cell: (row) => <span className="tnum">{usageOf(row)?.seatsActive ?? '—'}</span>,
    },
    {
      key: 'storage',
      header: 'Storage',
      cell: (row) => <span className="tnum">{bytes(usageOf(row)?.storageBytes ?? null)}</span>,
    },
    {
      key: 'version',
      header: 'Version',
      cell: (row) => <span className="mono text-xs">{row.version ?? '—'}</span>,
    },
    {
      key: 'seen',
      header: 'Last seen',
      cell: (row) => <span className="text-sm text-muted">{ago(row.lastSeenAt)}</span>,
    },
    {
      key: 'up',
      header: 'Up since',
      cell: (row) => <span className="text-sm text-muted">{ago(row.startedAt)}</span>,
    },
    {
      key: 'backup',
      header: 'Last backup',
      cell: (row) => <span className="text-sm text-muted">{ago(row.lastBackupAt)}</span>,
    },
  ];

  return (
    <>
      <PageHeader
        title="Stacks"
        description="Every server running a customer's CRM, and how each one is behaving."
        actions={
          <Input
            placeholder="Search by label, id or customer"
            value={typed}
            containerClassName="w-64"
            onChange={(e) => {
              setTyped(e.target.value);
            }}
          />
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <Segmented<Shown>
          ariaLabel="Which stacks"
          value={shown}
          onChange={(next) => {
            setShown(next);
            setPage(1);
          }}
          options={SHOWN}
        />
        {shown === 'quiet' && (
          <span className="text-sm text-muted">
            Nothing heard for {QUIET_MINUTES} minutes, including stacks that have never reported in.
          </span>
        )}
      </div>

      <StateSlot
        isPending={stacks.isPending}
        error={stacks.error}
        isEmpty={rows.length === 0}
        empty={
          <EmptyState
            title={shown === 'quiet' ? 'Every stack is reporting in' : 'No stacks match that'}
            description={
              shown === 'quiet'
                ? 'Nothing has gone quiet, which is the answer you want from this screen.'
                : 'Try a different search, or widen what is shown.'
            }
          />
        }
        onRetry={() => {
          void stacks.refetch();
        }}
      >
        <div className="rounded-md border border-border bg-surface">
          <Table
            caption="Every stack"
            columns={columns}
            rows={rows}
            rowKey={(row) => row.id}
            onRowClick={(row) => {
              void navigate({ to: '/stacks/$stackId', params: { stackId: row.id } });
            }}
          />
        </div>
        <Pager
          page={page}
          pageSize={PAGE_SIZE}
          total={stacks.data?.page.total ?? 0}
          onChange={setPage}
          noun="stacks"
        />
      </StateSlot>
    </>
  );
}

function usageOf(row: StackRow): StackUsage | null {
  return row.usage ?? null;
}
