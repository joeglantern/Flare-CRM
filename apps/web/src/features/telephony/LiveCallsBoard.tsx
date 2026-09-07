/**
 * Live calls (Calls · Live board). What the PBX says is happening right now, for a manager
 * watching the floor.
 *
 * This is the one screen where a stale view is actively misleading, so it says plainly when the
 * PBX is disconnected rather than leaving the last known cards on screen looking current.
 * Cards come from GET /calls/live and are refreshed by the realtime call events; the elapsed timer
 * ticks locally so a card does not appear frozen between events.
 */
import { Link } from '@tanstack/react-router';
import { Activity, PhoneIncoming, PhoneOutgoing, RefreshCw, Unplug, UserRound } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Banner } from '@/components/ui/Banner';
import { Skeleton } from '@/components/ui/Loading';
import { DateTime } from '@/components/data/formatters';
import { EmptyState, ErrorState, ForbiddenState } from '@/components/data/states';
import { StatCard } from '@/components/data/charts';
import { Panel } from '@/components/entity/EntityHeader';
import { PageHeader } from '@/app/shell/TopBar';
import { usePageMeta } from '@/app/shell/page-meta';
import { errorMessage } from '@/lib/api/errors';
import { useNow } from '@/lib/hooks';
import { linkTo } from '@/lib/links';
import { useSocketEvent } from '@/lib/socket/client';
import { cn } from '@/lib/utils';
import { usePermissions } from '@/providers/permissions';
import { useCtiStatus, useLiveCalls, type LiveCallDto } from './api';

/** Ringing is the state a manager reacts to, so it sorts to the top. */
const RANK: Record<string, number> = { ringing: 0, answered: 1, held: 2 };

export function LiveCallsBoard() {
  usePageMeta([{ label: 'Live calls' }]);
  const perms = usePermissions();
  const canView = perms.has('pbx:view_status');
  const status = useCtiStatus(canView);
  const live = useLiveCalls(canView);
  const now = useNow(true, 1000);

  // Any call transition changes what is on this board, so all four events refetch it.
  const refresh = () => {
    void live.refetch();
    void status.refetch();
  };
  useSocketEvent('call:ringing', refresh);
  useSocketEvent('call:answered', refresh);
  useSocketEvent('call:ended', refresh);
  useSocketEvent('call:updated', refresh);

  if (!canView) {
    return (
      <ForbiddenState
        permission="pbx:view_status"
        what="the live board"
        backTo={{ label: 'Calls', href: '/calls' }}
      />
    );
  }

  const calls = [...(live.data ?? [])].sort(
    (a, b) => (RANK[a.status] ?? 9) - (RANK[b.status] ?? 9) || a.since.localeCompare(b.since),
  );
  const pbxEnabled = status.data?.enabled ?? false;
  const connected = status.data?.connected ?? false;
  const ringing = calls.filter((c) => c.status === 'ringing').length;
  const talking = calls.filter((c) => c.status === 'answered').length;

  return (
    <div className="flex flex-col gap-4 p-6">
      <PageHeader
        title="Live calls"
        description="What the PBX is doing right now."
        actions={
          <Button variant="secondary" icon={RefreshCw} loading={live.isFetching} onClick={refresh}>
            Refresh
          </Button>
        }
      />

      {status.data !== undefined && !pbxEnabled && (
        <Banner tone="info" icon={Unplug} className="rounded-md">
          The PBX is not connected yet, so there is nothing for this board to show. An admin turns
          the integration on under Settings, Telephony.
        </Banner>
      )}
      {status.data !== undefined && pbxEnabled && !connected && (
        <Banner tone="danger" icon={Unplug} className="rounded-md">
          The PBX event stream is disconnected, so this board is not live. Calls may be in progress
          that are not shown here.
        </Banner>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="On a call" value={String(talking)} icon={Activity} />
        <StatCard label="Ringing" value={String(ringing)} icon={PhoneIncoming} />
        <StatCard
          label="PBX"
          value={connected ? 'Connected' : pbxEnabled ? 'Disconnected' : 'Not enabled'}
          tone={connected ? 'success' : pbxEnabled ? 'danger' : 'neutral'}
          sub={
            status.data?.since === null ? undefined : (
              <DateTime value={status.data?.since ?? null} mode="relative" />
            )
          }
        />
        <StatCard
          label="Last event"
          value={status.data?.lastEventAt === null ? 'None yet' : 'Live'}
          sub={<span className="mono">{status.data?.eventSource ?? '—'}</span>}
        />
      </div>

      {live.isPending ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} height={120} shape="block" />
          ))}
        </div>
      ) : live.isError ? (
        <ErrorState message={errorMessage(live.error)} onRetry={refresh} />
      ) : calls.length === 0 ? (
        <EmptyState
          object="handset"
          title={connected ? 'Nothing on the line' : 'No live calls to show'}
          description={
            connected
              ? 'Calls appear here the moment the PBX reports them.'
              : pbxEnabled
                ? 'The board is empty because the PBX event stream is down, not necessarily because the lines are quiet.'
                : 'Calls appear here once the PBX integration is connected.'
          }
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {calls.map((c) => (
            <LiveCallCard key={c.pbxCallId} call={c} now={now} />
          ))}
        </div>
      )}

      <Panel title="Stream" note="GET /cti/status · GET /calls/live">
        <dl className="grid grid-cols-[minmax(0,140px)_minmax(0,1fr)] gap-x-3 gap-y-2 text-base">
          <dt className="text-sm text-muted">Leader</dt>
          <dd className="mono">{status.data?.leader ?? '—'}</dd>
          <dt className="text-sm text-muted">Connected since</dt>
          <dd>
            <DateTime value={status.data?.since ?? null} />
          </dd>
          <dt className="text-sm text-muted">Last event</dt>
          <dd>
            <DateTime value={status.data?.lastEventAt ?? null} />
          </dd>
          <dt className="text-sm text-muted">Token expires</dt>
          <dd>
            <DateTime value={status.data?.tokenExpiresAt ?? null} />
          </dd>
          <dt className="text-sm text-muted">Last reconcile</dt>
          <dd>
            <DateTime value={status.data?.lastReconcileAt ?? null} />
          </dd>
        </dl>
      </Panel>
    </div>
  );
}

function LiveCallCard({ call, now }: { call: LiveCallDto; now: number }) {
  const elapsed = Math.max(0, Math.floor((now - new Date(call.since).getTime()) / 1000));
  const ringing = call.status === 'ringing';
  const inbound = call.direction === 'inbound';

  return (
    <article
      className={cn(
        'flex flex-col gap-2 rounded-md border bg-surface p-3',
        ringing ? 'border-flare ring-pulse' : 'border-border',
      )}
    >
      <div className="flex items-center gap-2">
        {inbound ? (
          <PhoneIncoming size={14} className="shrink-0 text-success" aria-hidden />
        ) : (
          <PhoneOutgoing size={14} className="shrink-0 text-muted" aria-hidden />
        )}
        <span className="min-w-0 flex-1 truncate font-medium">
          {call.contactName ?? call.external ?? 'Unknown number'}
        </span>
        <Badge tone={ringing ? 'warning' : call.status === 'held' ? 'neutral' : 'success'}>
          {ringing ? 'Ringing' : call.status === 'held' ? 'On hold' : 'Talking'}
        </Badge>
      </div>

      <div className="flex items-center gap-2 text-sm text-muted">
        <UserRound size={12} className="shrink-0" aria-hidden />
        <span className="min-w-0 flex-1 truncate">
          {call.userName ?? 'Not answered yet'}
          {call.extension !== null && (
            <span className="mono text-faint"> · ext {call.extension}</span>
          )}
        </span>
        <span className="mono tnum shrink-0">{formatElapsed(elapsed)}</span>
      </div>

      {call.external !== null && call.contactName !== null && (
        <p className="mono truncate text-xs text-faint">{call.external}</p>
      )}

      {call.callId !== null && (
        <Link {...linkTo.call(call.callId)} className="text-sm underline-offset-2 hover:underline">
          Open the call record
        </Link>
      )}
    </article>
  );
}

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
