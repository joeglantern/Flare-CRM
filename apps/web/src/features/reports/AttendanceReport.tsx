/**
 * Attendance (per agent, per day) and presence changes (a timeline). Every time is shown in the
 * workspace zone, and a time the server worked out rather than saw says so where it is read: these
 * rows can end up in a conversation about someone's pay.
 */
import type {
  AttendanceDayDto,
  PresenceChangeDto,
  PresenceChannel,
  PresenceState,
} from '@crm/shared';
import { Link } from '@tanstack/react-router';
import { Download } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { DataTable, type Column } from '@/components/data/DataTable';
import { DateTime, Duration } from '@/components/data/formatters';
import { ErrorState } from '@/components/data/states';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Loading';
import { Tabs } from '@/components/ui/Menu';
import { Dialog } from '@/components/ui/Overlay';
import { Select } from '@/components/ui/Select';
import { toast } from '@/components/ui/toast';
import { errorMessage } from '@/lib/api/errors';
import { useEntitlements } from '@/providers/entitlements';
import { usePermissions } from '@/providers/permissions';
import { useSettings } from '@/providers/settings';
import {
  exportAttendance,
  exportPresence,
  useAgentDayCalls,
  useAttendance,
  useAttendanceAgents,
  usePresenceChanges,
} from './attendance-api';

const STATE_LABELS: Record<PresenceState, string> = {
  online: 'Online',
  disconnected: 'Disconnected',
  signed_out: 'Signed out',
  phone_offline: 'Phone offline',
  phone_idle: 'Phone available',
  phone_ringing: 'Phone ringing',
  phone_on_call: 'On a call',
};

const INFERRED_LOGOUT: Record<string, string> = {
  disconnected: 'Last seen, no sign-out',
  no_signal: 'Last seen, connection lost',
};

const EXPLICIT_LOGOUT: Record<string, string> = {
  sign_out: 'Signed out',
  idle: 'Idle timeout',
  session_ended: 'Session ended',
};

const NOT_RECORDED =
  'Sign-ins and presence are recorded from the day this report was switched on. Earlier days cannot be recovered.';

function useTimeOfDay(): (iso: string) => string {
  const { timezone } = useSettings();
  const format = new Intl.DateTimeFormat('en-KE', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  return (iso) => format.format(new Date(iso));
}

/** The date is already the workspace's calendar day, so it must not be shifted again. */
const dayLabel = (date: string): string =>
  new Intl.DateTimeFormat('en-KE', {
    timeZone: 'UTC',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(new Date(`${date}T12:00:00Z`));

function TimeCell({ time, note, faint }: { time: ReactNode; note?: string; faint?: boolean }) {
  return (
    <span className="flex flex-col">
      <span className={faint === true ? 'text-faint' : 'tnum'}>{time}</span>
      {note !== undefined && <span className="text-sm text-muted">{note}</span>}
    </span>
  );
}

export function AttendanceReport({ filters }: { filters: { from: string; to: string } }) {
  const [view, setView] = useState<'days' | 'presence'>('days');
  const [userId, setUserId] = useState('');
  const agents = useAttendanceAgents();
  const scoped = userId === '' ? filters : { ...filters, userId };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Tabs
          tabs={[
            { id: 'days', label: 'By day' },
            { id: 'presence', label: 'Presence changes' },
          ]}
          value={view}
          onChange={(id) => {
            setView(id === 'presence' ? 'presence' : 'days');
          }}
          ariaLabel="Attendance view"
        />
        {(agents.data?.length ?? 0) > 1 && (
          <Select
            value={userId}
            onChange={setUserId}
            size="sm"
            ariaLabel="Agent"
            options={[
              { value: '', label: 'All agents' },
              ...(agents.data ?? []).map((a) => ({ value: a.id, label: a.name })),
            ]}
            className="max-w-56"
          />
        )}
      </div>
      {view === 'days' ? <DaysView filters={scoped} /> : <PresenceView filters={scoped} />}
    </div>
  );
}

function ExportButton({ run }: { run: () => Promise<void> }) {
  const perms = usePermissions();
  const { features } = useEntitlements();
  const [busy, setBusy] = useState(false);
  if (!perms.has('report:export') || !features.exports) return null;
  return (
    <Button
      variant="secondary"
      size="sm"
      icon={Download}
      loading={busy}
      onClick={() => {
        setBusy(true);
        run()
          .catch((e: unknown) => {
            toast({ tone: 'danger', title: 'Export failed', description: errorMessage(e) });
          })
          .finally(() => {
            setBusy(false);
          });
      }}
    >
      Export CSV
    </Button>
  );
}

function DaysView({ filters }: { filters: { from: string; to: string; userId?: string } }) {
  const query = useAttendance(filters);
  const timeOf = useTimeOfDay();
  const [drill, setDrill] = useState<AttendanceDayDto | null>(null);

  if (query.isPending) return <Skeleton height={280} shape="block" />;
  if (query.isError) {
    return (
      <ErrorState
        message={errorMessage(query.error)}
        onRetry={() => {
          void query.refetch();
        }}
      />
    );
  }

  const { days, timeZone } = query.data;
  const columns: Column<AttendanceDayDto>[] = [
    {
      key: 'date',
      header: 'Day',
      width: '0.9fr',
      render: (r) => <span className="whitespace-nowrap">{dayLabel(r.date)}</span>,
    },
    {
      key: 'name',
      header: 'Agent',
      width: '1.3fr',
      render: (r) => <span className="truncate font-medium">{r.name}</span>,
    },
    {
      key: 'firstLogin',
      header: 'First login',
      width: '1.1fr',
      render: (r) => {
        if (r.firstLoginAt !== null) {
          return (
            <TimeCell
              time={timeOf(r.firstLoginAt)}
              {...(r.firstLoginInferred ? { note: 'First seen, already signed in' } : {})}
            />
          );
        }
        return r.signedInBeforeDay ? (
          <TimeCell time="Before this day" faint />
        ) : (
          <TimeCell time="None" faint />
        );
      },
    },
    {
      key: 'lastLogout',
      header: 'Last logout',
      width: '1.3fr',
      render: (r) => {
        if (r.stillSignedIn) return <TimeCell time="Still signed in" faint />;
        if (r.continuedNextDay) return <TimeCell time="After this day" faint />;
        if (r.lastLogoutAt === null) return <TimeCell time="None" faint />;
        const reason = r.lastLogoutReason ?? '';
        return (
          <TimeCell
            time={timeOf(r.lastLogoutAt)}
            note={r.lastLogoutInferred ? INFERRED_LOGOUT[reason] : EXPLICIT_LOGOUT[reason]}
          />
        );
      },
    },
    {
      key: 'firstCall',
      header: 'First call handled',
      width: '0.9fr',
      render: (r) =>
        r.firstCallAt === null ? (
          <TimeCell time="None" faint />
        ) : (
          <TimeCell time={timeOf(r.firstCallAt)} />
        ),
    },
    {
      key: 'calls',
      header: 'Calls',
      width: '0.5fr',
      align: 'end',
      render: (r) => <span className="tnum">{r.calls.total}</span>,
    },
    {
      key: 'answered',
      header: 'Answered',
      width: '0.7fr',
      align: 'end',
      hideable: true,
      render: (r) => <span className="tnum text-muted">{r.calls.answered}</span>,
    },
    {
      key: 'missed',
      header: 'Missed',
      width: '0.6fr',
      align: 'end',
      hideable: true,
      render: (r) => <span className="tnum text-muted">{r.calls.missed}</span>,
    },
    {
      key: 'talk',
      header: 'Talk time',
      width: '0.8fr',
      align: 'end',
      render: (r) => <Duration seconds={r.calls.talkSec} format="long" className="tnum" />,
    },
  ];

  return (
    <div className="flex flex-col gap-2">
      <div className="flex justify-end">
        <ExportButton run={() => exportAttendance(filters)} />
      </div>
      <DataTable
        tableId="report-attendance"
        ariaLabel="Attendance by day"
        columns={columns}
        rows={days}
        rowKey={(r) => `${r.userId}:${r.date}`}
        state={days.length === 0 ? 'empty' : 'ready'}
        minWidth={920}
        onRowClick={(r) => {
          if (r.calls.total > 0) setDrill(r);
        }}
        emptyState={{
          object: 'headset',
          title: 'No attendance recorded in this range',
          description: NOT_RECORDED,
        }}
        note={`Times are in ${timeZone}. "Last seen" means nobody signed out, so the time is when the connection closed. Choose a row with calls to see them.`}
      />
      <DayCallsDialog
        day={drill}
        onClose={() => {
          setDrill(null);
        }}
      />
    </div>
  );
}

function DayCallsDialog({ day, onClose }: { day: AttendanceDayDto | null; onClose: () => void }) {
  const calls = useAgentDayCalls(day);
  const timeOf = useTimeOfDay();
  return (
    <Dialog
      open={day !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={day === null ? 'Calls' : `${day.name}, ${dayLabel(day.date)}`}
      width={560}
    >
      {calls.isPending ? (
        <Skeleton height={160} shape="block" />
      ) : calls.isError ? (
        <ErrorState message={errorMessage(calls.error)} />
      ) : calls.data.data.length === 0 ? (
        <p className="text-base text-muted">You cannot see these calls with your current access.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-[var(--border)]">
          {calls.data.data.map((c) => (
            <li key={c.id} className="flex items-center gap-3 py-2 text-base">
              <span className="tnum w-12 shrink-0">{timeOf(c.startedAt)}</span>
              <Link
                to="/calls/$callId"
                params={{ callId: c.id }}
                className="min-w-0 flex-1 truncate font-medium hover:underline"
              >
                {c.contact?.displayName ?? c.externalNumber ?? c.direction}
              </Link>
              <span className="shrink-0 text-muted">
                {c.direction}, {c.status}
              </span>
              <Duration seconds={c.talkDurationSec} className="tnum shrink-0" />
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}

function PresenceView({ filters }: { filters: { from: string; to: string; userId?: string } }) {
  const [channel, setChannel] = useState<PresenceChannel | ''>('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const scoped = channel === '' ? filters : { ...filters, channel };
  const query = usePresenceChanges({ ...scoped, page, pageSize });
  const { timezoneLabel } = useSettings();

  const columns: Column<PresenceChangeDto>[] = [
    {
      key: 'at',
      header: 'When',
      width: '1.2fr',
      render: (r) => <DateTime value={r.at} mode="absolute" />,
    },
    {
      key: 'name',
      header: 'Agent',
      width: '1.2fr',
      render: (r) => <span className="truncate font-medium">{r.name}</span>,
    },
    {
      key: 'channel',
      header: 'Source',
      width: '0.5fr',
      render: (r) => <span className="text-muted">{r.channel === 'crm' ? 'CRM' : 'Phone'}</span>,
    },
    {
      key: 'from',
      header: 'From',
      width: '0.9fr',
      render: (r) => (
        <span className="text-muted">
          {r.from === null ? 'Not recorded' : STATE_LABELS[r.from]}
        </span>
      ),
    },
    {
      key: 'to',
      header: 'To',
      width: '1.1fr',
      render: (r) => (
        <TimeCell
          time={STATE_LABELS[r.to]}
          {...(r.inferred ? { note: 'Worked out, not seen' } : {})}
        />
      ),
    },
    {
      key: 'lasted',
      header: 'Lasted',
      width: '0.7fr',
      align: 'end',
      render: (r) =>
        r.durationSec === null ? (
          <span className="text-faint">Current</span>
        ) : (
          <Duration seconds={r.durationSec} format="long" className="tnum" />
        ),
    },
  ];

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <Select
          value={channel}
          onChange={(v) => {
            setChannel(v === 'crm' || v === 'phone' ? v : '');
            setPage(1);
          }}
          size="sm"
          ariaLabel="Source"
          options={[
            { value: '', label: 'CRM and phone' },
            { value: 'crm', label: 'CRM only' },
            { value: 'phone', label: 'Phone only' },
          ]}
          className="max-w-44"
        />
        <ExportButton run={() => exportPresence(scoped)} />
      </div>
      <DataTable
        tableId="report-presence"
        ariaLabel="Presence changes"
        columns={columns}
        rows={query.data?.data ?? []}
        rowKey={(r) => r.id}
        state={
          query.isPending
            ? 'loading'
            : query.isError
              ? 'error'
              : query.data.data.length === 0
                ? 'empty'
                : 'ready'
        }
        minWidth={760}
        pagination={{
          kind: 'offset',
          page,
          pageSize,
          total: query.data?.page.total ?? 0,
        }}
        onPageChange={setPage}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPage(1);
        }}
        {...(query.isError ? { error: { message: errorMessage(query.error) } } : {})}
        onRetry={() => {
          void query.refetch();
        }}
        emptyState={{
          object: 'headset',
          title: 'No presence changes recorded in this range',
          description: NOT_RECORDED,
        }}
        note={`Times are in ${timezoneLabel}. "Worked out, not seen" means the connection stopped without saying so.`}
      />
    </div>
  );
}
