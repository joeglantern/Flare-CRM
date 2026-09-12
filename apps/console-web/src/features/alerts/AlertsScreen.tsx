/**
 * The alert inbox: everything the console has noticed, and what has been done about it.
 *
 * The overview's Attention strip answers "is anything wrong right now". This answers the harder
 * question, which is what happened to the things that were wrong: who saw it, what they decided, and
 * whether it came back. So the list is not only open alerts. A cleared one and a closed one are both
 * part of the record, and the tabs are how an owner moves between those.
 *
 * Every action here says something about a person rather than about a server. Acknowledging says
 * somebody has seen it, snoozing says not now, closing says it is dealt with, and muting says never
 * for this customer. None of them make the underlying fact untrue, which is why a closed alert whose
 * cause is still there opens again as a new row, and why the mute list is a screen of its own rather
 * than a checkbox nobody can find again.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { BellOff, Check, Clock, X } from 'lucide-react';
import { useCallback, useState } from 'react';
import {
  ALERT_STATE_COPY,
  alertCopy,
  MAX_SNOOZE_DAYS,
  SNOOZE_OPTIONS,
  type AlertState,
  type ConsoleServerPayload,
} from '@crm/shared';
import { Badge, Button, Dialog, Input, Select, Segmented, Textarea, toast } from '@crm/ui';
import { Pager, Table, type Column } from '@/components/Bits';
import { EmptyState, PageHeader, Section, StateSlot } from '@/components/Page';
import { http } from '@/lib/api';
import { ago, count, dateTime } from '@/lib/format';
import { usePermissions } from '@/lib/permissions';
import { qk } from '@/lib/query';
import { useConsoleEvent } from '@/lib/socket';
import type { Alert, AlertMute, AlertSummary } from '@/lib/types';

const PAGE_SIZE = 25;

const LEVEL_TONE = { info: 'info', warning: 'warning', danger: 'danger' } as const;

/**
 * The four worth a tab. Cleared and closed are both endings, so they share one: what an owner wants
 * from this screen is the difference between a thing that stopped and a thing somebody stopped.
 */
type Tab = 'open' | 'acked' | 'snoozed' | 'done';
const TABS: { value: Tab; label: string }[] = [
  { value: 'open', label: 'Open' },
  { value: 'acked', label: 'Acknowledged' },
  { value: 'snoozed', label: 'Snoozed' },
  { value: 'done', label: 'Finished' },
];

/** What the server is asked for. "Finished" is two states, so it asks for the closed ones. */
function stateFor(tab: Tab): AlertState {
  return tab === 'done' ? 'closed' : tab;
}

export function AlertsScreen() {
  const queryClient = useQueryClient();
  const { can } = usePermissions();
  const mayAct = can('alert:ack');
  const mayManage = can('alert:manage');

  const [tab, setTab] = useState<Tab>('open');
  const [page, setPage] = useState(1);
  const [closing, setClosing] = useState<Alert | null>(null);
  const [muting, setMuting] = useState<Alert | null>(null);

  const params = { state: stateFor(tab), page, pageSize: PAGE_SIZE };
  const alerts = useQuery({
    queryKey: qk.alerts(params),
    queryFn: () => http.list<Alert>('/api/v1/alerts', params),
  });
  const summary = useQuery({
    queryKey: qk.alertSummary(),
    queryFn: () => http.get<AlertSummary>('/api/v1/alerts/summary'),
  });

  /**
   * The sweep runs on a timer on the server, so an alert can open while this screen is sitting
   * there. Refetching the page rather than patching a row: an alert opening changes which page
   * things are on and every count in the header, and none of that can be worked out from one event.
   */
  const onAlert = useCallback(
    (_event: ConsoleServerPayload<'alert:changed'>) => {
      void queryClient.invalidateQueries({ queryKey: qk.alerts() });
      void queryClient.invalidateQueries({ queryKey: qk.alertSummary() });
    },
    [queryClient],
  );
  useConsoleEvent('alert:changed', onAlert);

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: qk.alerts() }),
      queryClient.invalidateQueries({ queryKey: qk.alertSummary() }),
    ]);
  };

  const acknowledge = useMutation({
    mutationFn: (alert: Alert) => http.post(`/api/v1/alerts/${alert.id}/ack`, {}),
    onSuccess: async () => {
      await refresh();
      toast({
        tone: 'success',
        title: 'Acknowledged',
        description: 'It stays on the list and stops asking for attention.',
      });
    },
    onError: (error: Error) => {
      toast({ tone: 'danger', title: 'Could not acknowledge that', description: error.message });
    },
  });

  const snooze = useMutation({
    mutationFn: ({ alert, hours }: { alert: Alert; hours: number }) =>
      http.post(`/api/v1/alerts/${alert.id}/snooze`, { hours }),
    onSuccess: async () => {
      await refresh();
      toast({ tone: 'success', title: 'Set aside', description: 'It comes back by itself.' });
    },
    onError: (error: Error) => {
      toast({ tone: 'danger', title: 'Could not snooze that', description: error.message });
    },
  });

  const rows = alerts.data?.data ?? [];
  const counts = summary.data;

  const columns: Column<Alert>[] = [
    {
      key: 'what',
      header: 'What',
      cell: (alert) => (
        <span className="flex min-w-0 flex-col items-start gap-0.5">
          <Badge tone={LEVEL_TONE[alert.level]} dot>
            {alertCopy(alert.kind).label}
          </Badge>
          <span className="text-sm text-muted">{alert.summary}</span>
        </span>
      ),
    },
    {
      key: 'customer',
      header: 'Customer',
      cell: (alert) => (
        <span className="flex flex-col">
          <Link to="/customers/$customerId" params={{ customerId: alert.customerId }}>
            {alert.customerName}
          </Link>
          {alert.stackId !== null && (
            <Link
              to="/stacks/$stackId"
              params={{ stackId: alert.stackId }}
              className="mono text-xs text-muted no-underline hover:underline"
            >
              {alert.stackId}
            </Link>
          )}
        </span>
      ),
    },
    {
      key: 'since',
      header: 'Since',
      cell: (alert) => (
        <span className="text-sm text-muted" title={dateTime(alert.openedAt)}>
          {ago(alert.openedAt)}
        </span>
      ),
    },
    {
      key: 'state',
      header: 'State',
      cell: (alert) => <StateCell alert={alert} />,
    },
    {
      key: 'actions',
      header: '',
      align: 'end',
      cell: (alert) => {
        // Nothing to do to an alert that is already finished with, whatever this account may do.
        const live = alert.state === 'open' || alert.state === 'acked' || alert.state === 'snoozed';
        if (!live || !mayAct) return null;
        return (
          <span className="flex items-center justify-end gap-1.5">
            {alert.acknowledgedAt === null && (
              <Button
                size="sm"
                icon={Check}
                loading={acknowledge.isPending && acknowledge.variables.id === alert.id}
                onClick={() => {
                  acknowledge.mutate(alert);
                }}
              >
                Acknowledge
              </Button>
            )}
            <SnoozeButton
              busy={snooze.isPending && snooze.variables.alert.id === alert.id}
              onPick={(hours) => {
                snooze.mutate({ alert, hours });
              }}
            />
            <Button
              size="sm"
              variant="ghost"
              icon={X}
              onClick={() => {
                setClosing(alert);
              }}
            >
              Close
            </Button>
            {mayManage && (
              <Button
                size="sm"
                variant="ghost"
                icon={BellOff}
                onClick={() => {
                  setMuting(alert);
                }}
              >
                Mute
              </Button>
            )}
          </span>
        );
      },
    },
  ];

  return (
    <>
      <PageHeader
        title="Alerts"
        description="Everything the console has noticed, and what was done about it."
      />

      <div className="flex flex-wrap items-center gap-3">
        <Segmented<Tab>
          ariaLabel="Which alerts"
          value={tab}
          onChange={(next) => {
            setTab(next);
            setPage(1);
          }}
          options={TABS.map((t) =>
            t.value === 'open' && counts !== undefined && counts.open > 0
              ? { ...t, count: counts.open }
              : t,
          )}
        />
        {counts !== undefined && counts.byLevel.danger > 0 && (
          <span className="text-sm text-muted">
            {count(counts.byLevel.danger, 'is serious', 'are serious')}.
          </span>
        )}
      </div>

      <StateSlot
        isPending={alerts.isPending}
        error={alerts.error}
        isEmpty={rows.length === 0}
        empty={
          <EmptyState
            title={tab === 'open' ? 'Nothing needs attention' : 'Nothing here'}
            description={
              tab === 'open'
                ? 'Every stack is reporting in, inside its limits, backed up and on a plan that has not run out.'
                : 'No alert is in this state.'
            }
          />
        }
        onRetry={() => {
          void alerts.refetch();
        }}
      >
        <div className="rounded-md border border-border bg-surface">
          <Table caption="Alerts" columns={columns} rows={rows} rowKey={(alert) => alert.id} />
        </div>
        <Pager
          page={page}
          pageSize={PAGE_SIZE}
          total={alerts.data?.page.total ?? 0}
          onChange={setPage}
          noun="alerts"
        />
      </StateSlot>

      {mayManage && <MutesSection />}

      <CloseDialog
        alert={closing}
        onDone={() => {
          setClosing(null);
        }}
        onClosed={refresh}
      />
      <MuteDialog
        alert={muting}
        onDone={() => {
          setMuting(null);
        }}
      />
    </>
  );
}

/** How one alert stands, in the words the shared copy uses so nothing drifts. */
function StateCell({ alert }: { alert: Alert }) {
  if (alert.state === 'closed') {
    return (
      <span className="flex flex-col">
        <Badge tone="neutral">{ALERT_STATE_COPY.closed.label}</Badge>
        {alert.closeReason !== null && (
          <span className="text-xs text-muted">{alert.closeReason}</span>
        )}
      </span>
    );
  }
  if (alert.state === 'resolved') {
    return (
      <span className="flex flex-col">
        <Badge tone="success">{ALERT_STATE_COPY.resolved.label}</Badge>
        <span className="text-xs text-muted">{ago(alert.resolvedAt)}</span>
      </span>
    );
  }
  if (alert.state === 'snoozed') {
    return (
      <span className="flex flex-col">
        <Badge tone="info">{ALERT_STATE_COPY.snoozed.label}</Badge>
        <span className="text-xs text-muted">Back {dateTime(alert.snoozedUntil)}</span>
      </span>
    );
  }
  if (alert.state === 'acked') {
    return (
      <span className="flex flex-col">
        <Badge tone="info">{ALERT_STATE_COPY.acked.label}</Badge>
        <span className="text-xs text-muted">
          {alert.acknowledgedByName ?? 'Somebody'}, {ago(alert.acknowledgedAt)}
        </span>
      </span>
    );
  }
  return <Badge tone="warning">{ALERT_STATE_COPY.open.label}</Badge>;
}

/** The snooze picker. A fixed set of lengths, because "until when" is not a question worth typing. */
function SnoozeButton({ busy, onPick }: { busy: boolean; onPick: (hours: number) => void }) {
  const [open, setOpen] = useState(false);
  const [hours, setHours] = useState(String(SNOOZE_OPTIONS[2].hours));
  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        icon={Clock}
        loading={busy}
        onClick={() => {
          setOpen(true);
        }}
      >
        Snooze
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="Set this aside"
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setOpen(false);
              }}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                onPick(Number(hours));
                setOpen(false);
              }}
            >
              Snooze
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3 text-base">
          <p className="text-muted">
            It disappears from Open and comes back by itself when the time is up. Nothing about the
            stack changes, and no second email is sent.
          </p>
          <Select
            label="For how long"
            value={hours}
            onChange={setHours}
            options={SNOOZE_OPTIONS.map((o) => ({ value: String(o.hours), label: o.label }))}
          />
        </div>
      </Dialog>
    </>
  );
}

/**
 * Closing one by hand, with a reason.
 *
 * The reason is required because this is the one action that contradicts the console: the check still
 * says something is wrong and a person is saying it is handled. Six months later that sentence is the
 * only thing that explains the row.
 */
function CloseDialog({
  alert,
  onDone,
  onClosed,
}: {
  alert: Alert | null;
  onDone: () => void;
  onClosed: () => Promise<void>;
}) {
  const [reason, setReason] = useState('');
  const close = useMutation({
    mutationFn: (id: string) => http.post(`/api/v1/alerts/${id}/close`, { reason: reason.trim() }),
    onSuccess: async () => {
      setReason('');
      onDone();
      await onClosed();
      toast({
        tone: 'success',
        title: 'Closed',
        description: 'If the sweep still finds it, it opens a new one rather than reviving this.',
      });
    },
    onError: (error: Error) => {
      toast({ tone: 'danger', title: 'Could not close that', description: error.message });
    },
  });

  return (
    <Dialog
      open={alert !== null}
      onOpenChange={(v) => {
        if (!v) {
          setReason('');
          onDone();
        }
      }}
      title="Close this alert?"
      footer={
        <>
          <Button
            variant="ghost"
            onClick={() => {
              setReason('');
              onDone();
            }}
          >
            Cancel
          </Button>
          <Button
            variant="danger"
            loading={close.isPending}
            disabled={reason.trim() === ''}
            onClick={() => {
              if (alert !== null) close.mutate(alert.id);
            }}
          >
            Close alert
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 text-base">
        <p className="text-muted">
          {alert === null ? '' : `${alertCopy(alert.kind).label} at ${alert.customerName}.`} Closing
          does not fix anything on that server. If the next sweep still finds this, it opens a fresh
          alert, and this one keeps your reason against it.
        </p>
        <Textarea
          label="Why"
          rows={3}
          value={reason}
          placeholder="Spoke to them, the server is being rebuilt."
          onChange={(e) => {
            setReason(e.target.value);
          }}
        />
      </div>
    </Dialog>
  );
}

/** Muting a kind for one customer, which is the only shape of mute worth offering from a row. */
function MuteDialog({ alert, onDone }: { alert: Alert | null; onDone: () => void }) {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState('');
  const [days, setDays] = useState('');

  const create = useMutation({
    mutationFn: (a: Alert) =>
      http.post('/api/v1/alerts/mutes', {
        kind: a.kind,
        customerId: a.customerId,
        reason: reason.trim(),
        expiresAt:
          days.trim() === ''
            ? null
            : new Date(Date.now() + Number(days) * 86_400_000).toISOString(),
      }),
    onSuccess: async () => {
      setReason('');
      setDays('');
      onDone();
      await queryClient.invalidateQueries({ queryKey: qk.alertMutes() });
      toast({
        tone: 'success',
        title: 'Muted',
        description: 'The check still runs. It simply stops opening alerts for this customer.',
      });
    },
    onError: (error: Error) => {
      toast({ tone: 'danger', title: 'Could not mute that', description: error.message });
    },
  });

  const forever = days.trim() === '';
  const tooLong = !forever && (Number(days) < 1 || Number(days) > MAX_SNOOZE_DAYS * 12);

  return (
    <Dialog
      open={alert !== null}
      onOpenChange={(v) => {
        if (!v) onDone();
      }}
      title="Stop alerting about this?"
      footer={
        <>
          <Button variant="ghost" onClick={onDone}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={create.isPending}
            disabled={reason.trim() === '' || tooLong}
            onClick={() => {
              if (alert !== null) create.mutate(alert);
            }}
          >
            Mute
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 text-base">
        <p className="text-muted">
          {alert === null
            ? ''
            : `No more ${alertCopy(alert.kind).label.toLowerCase()} alerts for ${alert.customerName}.`}{' '}
          The check keeps running and the fact stays visible on their own screen; this only stops it
          opening alerts and sending email.
        </p>
        <Textarea
          label="Why"
          rows={2}
          value={reason}
          placeholder="They are not going live until November."
          onChange={(e) => {
            setReason(e.target.value);
          }}
        />
        <Input
          label="For how many days"
          description="Leave it empty to mute until somebody lifts it."
          value={days}
          inputMode="numeric"
          onChange={(e) => {
            setDays(e.target.value);
          }}
        />
      </div>
    </Dialog>
  );
}

/**
 * Every mute in force, which is the part of muting that makes it safe.
 *
 * A mute nobody can find is how a console starts lying: the check runs, the fact is true, and the
 * screen is quiet because of a decision somebody made months ago. So they are listed with who and
 * why, and lifting one is a single button.
 */
function MutesSection() {
  const queryClient = useQueryClient();
  const mutes = useQuery({
    queryKey: qk.alertMutes(),
    queryFn: () => http.get<AlertMute[]>('/api/v1/alerts/mutes'),
  });

  const lift = useMutation({
    mutationFn: (id: string) => http.del(`/api/v1/alerts/mutes/${id}`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: qk.alertMutes() });
      toast({ tone: 'success', title: 'Lifted', description: 'The next sweep can open it again.' });
    },
    onError: (error: Error) => {
      toast({ tone: 'danger', title: 'Could not lift that', description: error.message });
    },
  });

  const rows = mutes.data ?? [];

  return (
    <Section
      title="Muted"
      description="Checks that still run but stay quiet. Worth reading before trusting an empty inbox."
    >
      <StateSlot
        isPending={mutes.isPending}
        error={mutes.error}
        isEmpty={rows.length === 0}
        empty={<p className="text-base text-muted">Nothing is muted.</p>}
      >
        <ul className="flex flex-col divide-y divide-border">
          {rows.map((mute) => (
            <li key={mute.id} className="flex flex-wrap items-start gap-x-3 gap-y-1 py-2.5">
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-base">
                  {mute.kind === null ? 'Every check' : alertCopy(mute.kind).label}
                  {' at '}
                  {mute.customerName ?? 'every customer'}
                </span>
                <span className="text-sm text-muted">{mute.reason}</span>
                <span className="text-xs text-faint">
                  Set {ago(mute.createdAt)}
                  {mute.expiresAt === null
                    ? ', until lifted'
                    : `, until ${dateTime(mute.expiresAt)}`}
                </span>
              </span>
              <Button
                size="sm"
                variant="ghost"
                loading={lift.isPending && lift.variables === mute.id}
                onClick={() => {
                  lift.mutate(mute.id);
                }}
              >
                Lift
              </Button>
            </li>
          ))}
        </ul>
      </StateSlot>
    </Section>
  );
}
