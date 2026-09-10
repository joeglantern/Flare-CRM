/**
 * The fleet: every customer, what they are on, and whether their stack is talking to us.
 *
 * Rows update from the socket rather than from polling, so a stack that comes back turns green
 * while the screen is open. The event carries the whole row's worth of state, so the cache is
 * patched in place instead of refetching the list on every heartbeat.
 *
 * A stack heartbeats every thirty seconds, which is the wrong cadence for someone standing over a
 * server they have just restarted, so each one can be asked to report in now.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { Plus, RefreshCw, Server, TriangleAlert } from 'lucide-react';
import { useCallback, useState } from 'react';
import { ALERTS, type ConsoleOverviewDto, type ConsoleServerPayload } from '@crm/shared';
import { Badge, Button, IconButton, Input, toast } from '@crm/ui';
import { CopyLine, StatusDot, Table, UsageBar, type Column } from '@/components/Bits';
import { EmptyState, PageHeader, Section, StateSlot } from '@/components/Page';
import { http } from '@/lib/api';
import { ago, bytes, day, daysUntil } from '@/lib/format';
import { qk } from '@/lib/query';
import { useConsoleEvent } from '@/lib/socket';
import type { Customer, FleetRow, NewStackCredentials, Stack } from '@/lib/types';
import { NewCustomerDialog } from '@/features/customers/NewCustomerDialog';

/** The same window the dashboard asks for, so both screens share one cached overview payload. */
const OVERVIEW_DAYS = 30;

export function FleetScreen() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const [credentials, setCredentials] = useState<
    (NewStackCredentials & { customerName: string }) | null
  >(null);

  const fleet = useQuery({
    queryKey: qk.fleet(),
    queryFn: () => http.get<FleetRow[]>('/api/v1/fleet'),
  });

  /** A stack came, went, or reported in: patch the row rather than refetch the fleet. */
  const onStack = useCallback(
    (event: ConsoleServerPayload<'fleet:stack'>) => {
      queryClient.setQueryData<FleetRow[]>(qk.fleet(), (rows) =>
        rows?.map((row) => {
          if (row.customer.id !== event.customerId) return row;
          const stacks = row.stacks.map((s) =>
            s.id === event.stackId
              ? {
                  ...s,
                  connected: event.connected,
                  lastSeenAt: event.lastSeenAt,
                  version: event.version,
                  usage: event.usage,
                  lastBackupAt: event.lastBackupAt,
                }
              : s,
          );
          return {
            ...row,
            stacks,
            connected: stacks.some((s) => s.connected),
            seats: { used: event.usage?.seatsActive ?? row.seats.used, max: row.seats.max },
            storageBytes: event.usage?.storageBytes ?? row.storageBytes,
            lastSeenAt: event.lastSeenAt ?? row.lastSeenAt,
            lastBackupAt: event.lastBackupAt ?? row.lastBackupAt,
            version: event.version ?? row.version,
          };
        }),
      );
    },
    [queryClient],
  );
  useConsoleEvent('fleet:stack', onStack);

  const createStack = useMutation({
    mutationFn: (customer: Customer) =>
      http.post<NewStackCredentials>(`/api/v1/customers/${customer.id}/stacks`, {}),
    onSuccess: (data, customer) => {
      setCredentials({ ...data, customerName: customer.name });
      void queryClient.invalidateQueries({ queryKey: qk.fleet() });
    },
    onError: (error: Error) => {
      toast({ tone: 'danger', title: 'Could not create a stack', description: error.message });
    },
  });

  /**
   * Asks one stack to heartbeat now. Nothing is refetched here on purpose: the answer arrives as a
   * `fleet:stack` event and patches the row through the handler above, which is the same path a
   * spontaneous heartbeat takes.
   */
  const ping = useMutation({
    mutationFn: (stack: Stack) => http.post(`/api/v1/stacks/${stack.id}/ping`),
    onSuccess: () => {
      toast({
        tone: 'success',
        title: 'Asked it to report in',
        description: 'The row updates itself when it answers.',
        key: 'ping',
      });
    },
    onError: (error: Error) => {
      toast({ tone: 'danger', title: 'Could not reach that stack', description: error.message });
    },
  });

  const term = search.trim().toLowerCase();
  const rows = (fleet.data ?? []).filter(
    (row) =>
      term === '' ||
      row.customer.name.toLowerCase().includes(term) ||
      row.customer.slug.includes(term) ||
      row.customer.primaryDomain.includes(term),
  );

  const columns: Column<FleetRow>[] = [
    {
      key: 'customer',
      header: 'Customer',
      cell: (row) => (
        <span className="flex flex-col">
          <span className="font-medium">{row.customer.name}</span>
          <span className="text-sm text-muted">
            {row.customer.customDomain ?? row.customer.primaryDomain}
          </span>
        </span>
      ),
    },
    {
      key: 'plan',
      header: 'Plan',
      cell: (row) =>
        row.plan === null ? (
          <Badge tone="warning">No plan</Badge>
        ) : (
          <span className="text-base">{row.plan.name}</span>
        ),
    },
    {
      key: 'status',
      header: 'Stack',
      cell: (row) =>
        row.stacks.length === 0 ? (
          <Button
            size="sm"
            icon={Server}
            loading={createStack.isPending && createStack.variables.id === row.customer.id}
            onClick={(e) => {
              e.stopPropagation();
              createStack.mutate(row.customer);
            }}
          >
            Create stack
          </Button>
        ) : (
          <StatusDot connected={row.connected} />
        ),
    },
    {
      key: 'seats',
      header: 'Seats',
      cell: (row) => <UsageBar used={row.seats.used} max={row.seats.max} label="Seats in use" />,
    },
    {
      key: 'storage',
      header: 'Storage',
      cell: (row) => <span className="tnum">{bytes(row.storageBytes)}</span>,
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
      key: 'backup',
      header: 'Last backup',
      cell: (row) => <span className="text-sm text-muted">{ago(row.lastBackupAt)}</span>,
    },
    { key: 'expiry', header: 'Expires', cell: (row) => <Expiry expiresAt={row.expiresAt} /> },
    {
      key: 'refresh',
      header: '',
      align: 'end',
      cell: (row) => (
        <span className="flex justify-end gap-1">
          {row.stacks
            .filter((stack) => stack.revokedAt === null)
            .map((stack) => (
              <IconButton
                key={stack.id}
                icon={RefreshCw}
                variant="ghost"
                label={
                  stack.connected
                    ? `Ask ${stack.id} to report in now`
                    : `${stack.id} is offline, so there is nothing to ask`
                }
                disabled={!stack.connected || (ping.isPending && ping.variables.id === stack.id)}
                onClick={(e) => {
                  e.stopPropagation();
                  ping.mutate(stack);
                }}
              />
            ))}
        </span>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Fleet"
        description="Every customer, their plan, and whether their stack is reporting in."
        actions={
          <>
            <Input
              placeholder="Search customers"
              value={search}
              containerClassName="w-48"
              onChange={(e) => {
                setSearch(e.target.value);
              }}
            />
            <Button
              variant="primary"
              icon={Plus}
              onClick={() => {
                setCreating(true);
              }}
            >
              New customer
            </Button>
          </>
        }
      />

      <AttentionStrip />

      <StateSlot
        isPending={fleet.isPending}
        error={fleet.error}
        isEmpty={rows.length === 0}
        empty={
          fleet.data?.length === 0 ? (
            <EmptyState
              title="No customers yet"
              description="Add the first one, create its stack, and paste the four environment lines onto that customer's server."
              action={
                <Button
                  variant="primary"
                  icon={Plus}
                  onClick={() => {
                    setCreating(true);
                  }}
                >
                  New customer
                </Button>
              }
            />
          ) : (
            <EmptyState
              title="Nothing matches that"
              description="Try a different name or domain."
            />
          )
        }
        onRetry={() => {
          void fleet.refetch();
        }}
      >
        <div className="rounded-md border border-border bg-surface">
          <Table
            caption="Customers and the state of their stacks"
            columns={columns}
            rows={rows}
            rowKey={(row) => row.customer.id}
            onRowClick={(row) => {
              void navigate({
                to: '/customers/$customerId',
                params: { customerId: row.customer.id },
              });
            }}
          />
        </div>
      </StateSlot>

      <NewCustomerDialog
        open={creating}
        onOpenChange={setCreating}
        onCreated={(customer) => {
          void navigate({ to: '/customers/$customerId', params: { customerId: customer.id } });
        }}
      />

      <StackCredentialsDialog
        credentials={credentials}
        onClose={() => {
          setCredentials(null);
        }}
      />
    </>
  );
}

function Expiry({ expiresAt }: { expiresAt: string | null }) {
  if (expiresAt === null) return <span className="text-sm text-muted">No expiry</span>;
  const days = daysUntil(expiresAt);
  if (days === null) return <span className="text-sm text-muted">—</span>;
  if (days < 0) return <Badge tone="danger">Expired</Badge>;
  if (days <= 14) return <Badge tone="warning">{days} days</Badge>;
  return <span className="text-sm text-muted">{day(expiresAt)}</span>;
}

/**
 * The secret exists in this dialog and nowhere else. It is never stored in plain text and cannot be
 * shown again, so the dialog says so and offers the exact lines to paste.
 */
function StackCredentialsDialog({
  credentials,
  onClose,
}: {
  credentials: (NewStackCredentials & { customerName: string }) | null;
  onClose: () => void;
}) {
  if (credentials === null) return null;
  return (
    <div
      role="dialog"
      aria-label="Stack credentials"
      aria-modal="true"
      className="fixed inset-0 z-[80] flex items-start justify-center overflow-y-auto bg-black/60 p-4 pt-[8vh]"
    >
      <div className="w-full max-w-lg rounded-md border border-border bg-raised p-4 shadow-float">
        <h2 className="text-lg font-semibold">Stack credentials for {credentials.customerName}</h2>
        <p className="mt-1 text-base text-muted">
          Paste these four lines into that customer&rsquo;s environment file and restart their
          worker. The secret is shown once: it is stored only as a hash, so if it is lost the stack
          needs a new one.
        </p>
        <div className="mt-4 flex flex-col gap-2">
          {credentials.envLines.map((line) => (
            <CopyLine key={line} value={line} what="line" />
          ))}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button
            onClick={() => {
              void navigator.clipboard.writeText(credentials.envLines.join('\n')).catch(() => {
                toast({ tone: 'danger', title: 'The browser would not let us copy that' });
              });
            }}
          >
            Copy all four
          </Button>
          <Button variant="primary" onClick={onClose}>
            I have saved them
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * Open alerts, above the table, so the reason to be on this screen is the first thing on it.
 *
 * The wording comes from ALERTS in the shared contract rather than from here, so the strip, the
 * dashboard and the emails describe the same alert the same way.
 *
 * It shares the dashboard's overview query. If that request fails, the strip renders nothing at all
 * rather than an error: the fleet table underneath is the point of this screen, and a broken
 * dashboard should not be allowed to look like a broken fleet.
 */
function AttentionStrip() {
  const queryClient = useQueryClient();

  const overview = useQuery({
    queryKey: qk.overview(OVERVIEW_DAYS),
    queryFn: () =>
      http.get<ConsoleOverviewDto>('/api/v1/analytics/overview', { days: OVERVIEW_DAYS }),
  });

  /** An alert opened or closed while the screen is open: ask for the payload again. */
  const onAlert = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: qk.overview(OVERVIEW_DAYS) });
  }, [queryClient]);
  useConsoleEvent('alert:changed', onAlert);

  const open = (overview.data?.alerts ?? []).filter((alert) => alert.resolvedAt === null);
  if (open.length === 0) return null;

  const worst = open.some((a) => a.level === 'danger') ? 'danger' : 'warning';

  return (
    <Section
      title={
        <span className="flex items-center gap-2">
          <TriangleAlert
            size={15}
            className={worst === 'danger' ? 'text-danger' : 'text-warning'}
            aria-hidden
          />
          Needs attention
        </span>
      }
      description="Open alerts across every customer. Each one closes itself when whatever it is about stops being true."
    >
      <ul className="flex flex-col divide-y divide-border">
        {open.map((alert) => (
          <li key={alert.id} className="flex flex-wrap items-start gap-x-3 gap-y-1 py-2.5">
            <Badge tone={alert.level === 'danger' ? 'danger' : 'warning'}>
              {ALERTS[alert.kind].label}
            </Badge>
            <Link
              to="/customers/$customerId"
              params={{ customerId: alert.customerId }}
              className="font-medium no-underline hover:underline"
            >
              {alert.customerName}
            </Link>
            <span className="min-w-0 flex-1 text-base text-muted">
              {ALERTS[alert.kind].description}
            </span>
            <span className="shrink-0 text-sm text-muted">{ago(alert.openedAt)}</span>
          </li>
        ))}
      </ul>
    </Section>
  );
}
