/**
 * Every customer, what they are on, and whether their system is talking to us.
 *
 * The endpoint and the socket event are still called "fleet", which is the right word for every
 * stack taken together. What an owner opens is a list of customers, so the screen says that.
 *
 * The list is the server's now: filtering, sorting and paging all happen there, so a console with
 * two hundred customers behaves like a console with two. Rows still update from the socket rather
 * than from polling, so a stack that comes back turns green while the screen is open, and the
 * cached page is patched in place instead of refetched on every heartbeat.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { Archive, Plus, RefreshCw, Send, Server, TriangleAlert } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import {
  alertCopy,
  CHURN_REASONS,
  CHURN_REASON_COPY,
  type ChurnReason,
  type ConsoleOverviewDto,
  type ConsoleServerPayload,
} from '@crm/shared';
import {
  Badge,
  Button,
  Checkbox,
  ConfirmDialog,
  IconButton,
  Input,
  Segmented,
  Select,
  toast,
} from '@crm/ui';
import { CopyLine, Pager, StatusDot, Table, UsageBar, type Column } from '@/components/Bits';
import { EmptyState, PageHeader, Section, StateSlot } from '@/components/Page';
import { http, type OffsetList } from '@/lib/api';
import { ago, bytes, day, daysUntil } from '@/lib/format';
import { usePermissions } from '@/lib/permissions';
import { qk } from '@/lib/query';
import { useConsoleEvent } from '@/lib/socket';
import type { Customer, FleetRow, NewStackCredentials, Stack } from '@/lib/types';
import { NewCustomerDialog } from '@/features/customers/NewCustomerDialog';

/** The same window the dashboard asks for, so both screens share one cached overview payload. */
const OVERVIEW_DAYS = 30;
const PAGE_SIZE = 25;

/** What the segmented control offers, and what each choice asks the server for. */
type Shown = 'all' | 'active' | 'suspended' | 'churned' | 'archived';
const SHOWN: { value: Shown; label: string }[] = [
  { value: 'active', label: 'Active' },
  { value: 'suspended', label: 'Suspended' },
  { value: 'churned', label: 'Churned' },
  { value: 'archived', label: 'Archived' },
  { value: 'all', label: 'All' },
];

function paramsFor(shown: Shown, q: string, connected: boolean, page: number) {
  return {
    page,
    pageSize: PAGE_SIZE,
    ...(q === '' ? {} : { q }),
    ...(connected ? { connected: 'true' } : {}),
    ...(shown === 'archived'
      ? { archived: 'only' }
      : shown === 'all'
        ? { archived: 'include' }
        : { status: shown }),
  };
}

export function FleetScreen() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { can } = usePermissions();
  const [typed, setTyped] = useState('');
  const [q, setQ] = useState('');
  const [shown, setShown] = useState<Shown>('active');
  const [connectedOnly, setConnectedOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [credentials, setCredentials] = useState<
    (NewStackCredentials & { customerName: string }) | null
  >(null);

  // Typing is not a request. The list follows a third of a second after somebody stops.
  useEffect(() => {
    const timer = setTimeout(() => {
      setQ(typed.trim());
      setPage(1);
    }, 300);
    return () => {
      clearTimeout(timer);
    };
  }, [typed]);

  const params = paramsFor(shown, q, connectedOnly, page);
  const fleet = useQuery({
    queryKey: qk.fleet(params),
    queryFn: () => http.list<FleetRow>('/api/v1/fleet', params),
  });

  /** A stack came, went, or reported in: patch the row rather than refetch the page. */
  const onStack = useCallback(
    (event: ConsoleServerPayload<'fleet:stack'>) => {
      queryClient.setQueryData<OffsetList<FleetRow>>(qk.fleet(params), (previous) =>
        previous === undefined
          ? previous
          : {
              ...previous,
              data: previous.data.map((row) => {
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
            },
      );
    },
    [queryClient, params],
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

  const rows = fleet.data?.data ?? [];
  const total = fleet.data?.page.total ?? 0;
  const chosen = rows.filter((row) => selected.includes(row.customer.id));

  const toggle = (id: string) => {
    setSelected((current) =>
      current.includes(id) ? current.filter((x) => x !== id) : [...current, id],
    );
  };

  const columns: Column<FleetRow>[] = [
    {
      key: 'pick',
      header: '',
      cell: (row) => (
        // The row navigates, so the checkbox swallows its own click rather than opening a customer
        // every time somebody tries to select one.
        <span
          role="presentation"
          onClick={(e) => {
            e.stopPropagation();
          }}
          onKeyDown={(e) => {
            e.stopPropagation();
          }}
        >
          <Checkbox
            checked={selected.includes(row.customer.id)}
            ariaLabel={`Select ${row.customer.name}`}
            onChange={() => {
              toggle(row.customer.id);
            }}
          />
        </span>
      ),
    },
    {
      key: 'customer',
      header: 'Customer',
      cell: (row) => (
        <span className="flex flex-col">
          <span className="flex items-center gap-2 font-medium">
            {row.customer.name}
            {row.customer.archivedAt !== null && <Badge tone="neutral">Archived</Badge>}
          </span>
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
          can('stack:manage') ? (
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
            <span className="text-sm text-muted">No stack</span>
          )
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
          {can('stack:operate') &&
            row.stacks
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
        title="Customers"
        description="Every customer, their plan, and whether their stack is reporting in."
        actions={
          <>
            <Input
              placeholder="Search customers"
              value={typed}
              containerClassName="w-48"
              onChange={(e) => {
                setTyped(e.target.value);
              }}
            />
            {can('customer:write') && (
              <Button
                variant="primary"
                icon={Plus}
                onClick={() => {
                  setCreating(true);
                }}
              >
                New customer
              </Button>
            )}
          </>
        }
      />

      <AttentionStrip />

      <div className="flex flex-wrap items-center gap-3">
        <Segmented<Shown>
          ariaLabel="Which customers"
          value={shown}
          onChange={(next) => {
            setShown(next);
            setPage(1);
            setSelected([]);
          }}
          options={SHOWN}
        />
        <Checkbox
          checked={connectedOnly}
          label="Connected only"
          onChange={(next) => {
            setConnectedOnly(next);
            setPage(1);
          }}
        />
      </div>

      {chosen.length > 0 && (
        <BulkBar
          chosen={chosen}
          onDone={() => {
            setSelected([]);
            void queryClient.invalidateQueries({ queryKey: qk.fleet() });
          }}
        />
      )}

      <StateSlot
        isPending={fleet.isPending}
        error={fleet.error}
        isEmpty={rows.length === 0}
        empty={
          q === '' && shown === 'active' ? (
            <EmptyState
              title="No customers yet"
              description="Add the first one, create its stack, and paste the four environment lines onto that customer's server."
              action={
                can('customer:write') ? (
                  <Button
                    variant="primary"
                    icon={Plus}
                    onClick={() => {
                      setCreating(true);
                    }}
                  >
                    New customer
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <EmptyState
              title="Nothing matches that"
              description="Try a different name, or widen what is shown."
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
        <Pager page={page} pageSize={PAGE_SIZE} total={total} onChange={setPage} noun="customers" />
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

/**
 * What can be done to a selection, and only what this account may actually do.
 *
 * Each of these signs a document per customer and pushes it, so every one says how many it is about
 * to touch before it touches them, and reports back per customer rather than as one verdict.
 */
function BulkBar({ chosen, onDone }: { chosen: FleetRow[]; onDone: () => void }) {
  const { can } = usePermissions();
  const [confirming, setConfirming] = useState<'archive' | 'suspend' | 'activate' | 'issue' | null>(
    null,
  );
  const [reason, setReason] = useState<ChurnReason>('went_quiet');
  const ids = chosen.map((row) => row.customer.id);

  const run = useMutation({
    mutationFn: (what: 'archive' | 'suspend' | 'activate' | 'issue') => {
      if (what === 'archive') {
        return http.post<BulkAnswer>('/api/v1/customers/bulk/archive', { ids, reason });
      }
      if (what === 'issue') return http.post<BulkAnswer>('/api/v1/customers/bulk/issue', { ids });
      return http.post<BulkAnswer>('/api/v1/customers/bulk/status', {
        ids,
        status: what === 'suspend' ? 'suspended' : 'active',
      });
    },
    onSuccess: (answer) => {
      toast({
        tone: answer.failed === 0 ? 'success' : 'warning',
        title:
          answer.failed === 0
            ? `Done for ${String(answer.ok)} of them`
            : `${String(answer.ok)} done, ${String(answer.failed)} refused`,
        description:
          answer.failed === 0
            ? undefined
            : answer.results
                .filter((r) => !r.ok)
                .map((r) => r.error ?? 'refused')
                .join('; '),
        duration: answer.failed === 0 ? undefined : 0,
      });
      onDone();
    },
    onError: (error: Error) => {
      toast({ tone: 'danger', title: 'That did not run', description: error.message });
    },
  });

  const names = chosen
    .slice(0, 3)
    .map((row) => row.customer.name)
    .join(', ');
  const rest = chosen.length > 3 ? ` and ${String(chosen.length - 3)} more` : '';

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-surface px-4 py-2.5">
        <span className="text-base">
          <span className="font-medium">{chosen.length} selected</span>
          <span className="ml-2 text-muted">
            {names}
            {rest}
          </span>
        </span>
        <span className="flex flex-wrap items-center gap-2">
          {can('customer:write') && (
            <>
              <Button
                size="sm"
                onClick={() => {
                  setConfirming('activate');
                }}
              >
                Mark active
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  setConfirming('suspend');
                }}
              >
                Suspend
              </Button>
            </>
          )}
          {can('entitlement:issue') && (
            <Button
              size="sm"
              icon={Send}
              onClick={() => {
                setConfirming('issue');
              }}
            >
              Issue documents
            </Button>
          )}
          {can('customer:archive') && (
            <>
              {/* The reason is chosen before the question is asked, so the dialog can say it back. */}
              <Select
                ariaLabel="Why they left"
                value={reason}
                onChange={(v) => {
                  setReason(v as ChurnReason);
                }}
                options={CHURN_REASONS.map((value) => ({ value, label: CHURN_REASON_COPY[value] }))}
                className="w-52"
              />
              <Button
                size="sm"
                variant="danger"
                icon={Archive}
                onClick={() => {
                  setConfirming('archive');
                }}
              >
                Archive
              </Button>
            </>
          )}
        </span>
      </div>

      <ConfirmDialog
        open={confirming !== null}
        onOpenChange={(v) => {
          if (!v) setConfirming(null);
        }}
        title={
          confirming === null
            ? ''
            : `${TITLES[confirming]} ${String(chosen.length)} customer${chosen.length === 1 ? '' : 's'}?`
        }
        description={
          confirming === null
            ? ''
            : confirming === 'archive'
              ? `${DESCRIPTIONS.archive} Recorded as: ${CHURN_REASON_COPY[reason].toLowerCase()}.`
              : DESCRIPTIONS[confirming]
        }
        consequences={
          confirming === null
            ? []
            : [
                ...CONSEQUENCES[confirming],
                'Each one is done in turn, and one failing does not stop the rest',
              ]
        }
        confirmLabel={confirming === null ? 'Confirm' : TITLES[confirming]}
        tone={confirming === 'activate' ? 'primary' : 'danger'}
        loading={run.isPending}
        onConfirm={() => {
          if (confirming !== null) run.mutate(confirming);
          setConfirming(null);
        }}
      />
    </>
  );
}

interface BulkAnswer {
  ok: number;
  failed: number;
  results: { customerId: string; ok: boolean; error?: string }[];
}

const TITLES = {
  archive: 'Archive',
  suspend: 'Suspend',
  activate: 'Mark active',
  issue: 'Issue to',
} as const;

const DESCRIPTIONS = {
  archive:
    'They leave the fleet and their CRM goes read only. Nothing of theirs is deleted, here or on their own server.',
  suspend:
    'Their people can still sign in and read everything. Every attempt to change anything is refused until this is lifted.',
  activate: 'They get back the expiry they had before they were held, and can write again.',
  issue: 'Signs what each of them is entitled to now and sends it to their stack.',
} as const;

const CONSEQUENCES = {
  archive: [
    'Their status becomes churned and their document expires now',
    'They disappear from this list unless you ask for archived ones',
    'Nothing is deleted, and they can be brought back',
  ],
  suspend: [
    'Reads keep working; every write is refused',
    'A connected stack applies it at once, and an offline one when it reconnects',
  ],
  activate: [
    'The expiry they had before is restored',
    'Their stack applies it as soon as it hears',
  ],
  issue: ['A freshly signed document goes to every stack they have registered'],
} as const;

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
              {alertCopy(alert.kind).label}
            </Badge>
            <Link
              to="/customers/$customerId"
              params={{ customerId: alert.customerId }}
              className="font-medium no-underline hover:underline"
            >
              {alert.customerName}
            </Link>
            <span className="min-w-0 flex-1 text-base text-muted">
              {alertCopy(alert.kind).description}
            </span>
            <span className="shrink-0 text-sm text-muted">{ago(alert.openedAt)}</span>
          </li>
        ))}
      </ul>
    </Section>
  );
}
