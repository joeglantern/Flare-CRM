/**
 * Home (Dashboard). Two boards behind one route, because an agent and a manager open the
 * CRM to answer different questions.
 *
 *  - Agent home: what is overdue, who called and got nothing back, what is unread, my deals.
 *  - Manager home: the team's numbers, what is on the line right now, the pipeline, who is
 *    carrying the load. It needs `report:view_team` and `pbx:view_status`, so an agent who lands
 *    on it sees the forbidden state rather than an empty board.
 *
 * There is no dashboard endpoint. Every card is an existing query with a tight filter, which is
 * why each names the call it makes. Cards the user has no permission for are not rendered.
 *
 * GAP-15: the PBX does not expose extension registration, so "agents on shift" cannot be shown.
 * The team board reports how many users have an extension instead, and says that is what it is.
 */
import { Link, useNavigate } from '@tanstack/react-router';
import {
  ArrowRight,
  AudioLines,
  Clock,
  Kanban,
  Phone,
  PhoneIncoming,
  PhoneMissed,
  PhoneOutgoing,
  SquareCheck,
  Tag,
  Target,
  Unplug,
  UserPlus,
  Users,
} from 'lucide-react';
import { useMemo } from 'react';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Banner } from '@/components/ui/Banner';
import { Kbd } from '@/components/ui/Kbd';
import { Skeleton } from '@/components/ui/Loading';
import { Segmented } from '@/components/ui/Toggle';
import { DateTime, Duration, Money } from '@/components/data/formatters';
import { PhoneNumber } from '@/components/data/PhoneNumber';
import { DueLabel, ReplyWindowChip, TaskPriorityFlag } from '@/components/data/status';
import { BarChart, StatCard } from '@/components/data/charts';
import { EmptyState, ErrorState, ForbiddenState, OfflineState } from '@/components/data/states';
import { Panel } from '@/components/entity/EntityHeader';
import { PageHeader } from '@/app/shell/TopBar';
import { usePageMeta } from '@/app/shell/page-meta';
import { useMissedCalls } from '@/features/calls/api';
import { useDeals } from '@/features/deals/api';
import { useConversations } from '@/features/inbox/api';
import { useCompleteTask, useTasks } from '@/features/tasks/api';
import { useCtiStatus, useLiveCalls } from '@/features/telephony/api';
import { useDialer } from '@/features/telephony/dialer';
import { useAgentPerformance, useCallsSummary, usePipelineSummary } from '@/features/reports/api';
import { useUsers } from '@/features/users/api';
import { useMe } from '@/lib/auth/me';
import { errorMessage } from '@/lib/api/errors';
import { useNow } from '@/lib/hooks';
import { linkTo } from '@/lib/links';
import { useSearchParam } from '@/lib/list-state';
import { useSocketEvent } from '@/lib/socket/client';
import { cn } from '@/lib/utils';
import { usePermissions } from '@/providers/permissions';
import { useSocketState } from '@/providers/socket';
import { MAX_PAGE_SIZE } from '@crm/shared';

/** Midnight to now, which is what "today" means on every card here. */
function today(): { from: string; to: string } {
  const from = new Date();
  from.setHours(0, 0, 0, 0);
  const to = new Date();
  to.setHours(23, 59, 59, 999);
  return { from: from.toISOString(), to: to.toISOString() };
}

export function HomeScreen() {
  usePageMeta([{ label: 'Home' }]);
  const me = useMe();
  const perms = usePermissions();
  const [boardParam, setBoardParam] = useSearchParam('board');

  const canTeam = perms.has('report:view_team') || perms.has('report:view_all');
  const board =
    boardParam === 'team' && canTeam
      ? 'team'
      : boardParam === 'mine'
        ? 'mine'
        : canTeam
          ? 'team'
          : 'mine';

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  return (
    <div className="flex flex-col gap-4 p-6">
      <PageHeader
        title={`${greeting}, ${me.name.split(' ')[0] ?? me.name}`}
        description={
          board === 'team' ? 'How the floor is doing right now.' : 'Everything waiting on you.'
        }
        actions={
          canTeam ? (
            <Segmented
              value={board}
              onChange={(v) => {
                setBoardParam(v === 'team' ? undefined : v);
              }}
              ariaLabel="Which board"
              options={[
                { value: 'team', label: 'Team' },
                { value: 'mine', label: 'Mine' },
              ]}
            />
          ) : undefined
        }
      />

      <PbxBanners />
      <QuickActions />

      {board === 'team' ? <TeamBoard /> : <AgentBoard />}
    </div>
  );
}

/* ── banners and quick actions ──────────────────────────────────────────────────────────── */

function PbxBanners() {
  const me = useMe();
  const perms = usePermissions();
  const cti = useCtiStatus(perms.has('pbx:view_status'));

  return (
    <>
      {cti.data !== undefined && !cti.data.connected && (
        <Banner tone="danger" icon={Unplug} className="rounded-md">
          The PBX event stream is down. Click to dial and screen pops are unavailable, and the live
          board is stale. Calls still reach the desk phones.
        </Banner>
      )}
      {me.extension === null && perms.has('call:dial') && (
        <Banner tone="warning" icon={Unplug} className="rounded-md">
          You have no PBX extension, so you cannot dial from the CRM. Ask an admin to set one on
          your account.
        </Banner>
      )}
    </>
  );
}

function QuickActions() {
  const perms = usePermissions();
  const navigate = useNavigate();
  const dialer = useDialer();

  const actions: {
    id: string;
    label: string;
    icon: typeof Phone;
    primary?: boolean;
    key?: string;
    disabled?: boolean;
    title?: string;
    go: () => void;
  }[] = [
    ...(perms.has('call:dial')
      ? [
          {
            id: 'dial',
            label: 'Call a number',
            icon: Phone,
            primary: true,
            disabled: !dialer.available,
            title: dialer.reason ?? 'Open the dialpad',
            go: () => {
              void navigate({ to: '/calls/dialpad' });
            },
          },
        ]
      : []),
    ...(perms.has('contact:create')
      ? [
          {
            id: 'contact',
            label: 'New contact',
            icon: UserPlus,
            key: 'C',
            go: () => {
              void navigate({ to: '/contacts', search: { create: 'true' } as never });
            },
          },
        ]
      : []),
    ...(perms.has('task:create')
      ? [
          {
            id: 'task',
            label: 'New task',
            icon: SquareCheck,
            key: 'T',
            go: () => {
              void navigate({ to: '/tasks', search: { create: 'true' } as never });
            },
          },
        ]
      : []),
    ...(perms.has('lead:create')
      ? [
          {
            id: 'lead',
            label: 'New lead',
            icon: Target,
            go: () => {
              void navigate({ to: '/leads', search: { create: 'true' } as never });
            },
          },
        ]
      : []),
  ];

  if (actions.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2">
      {actions.map((a) => (
        <button
          key={a.id}
          type="button"
          disabled={a.disabled === true}
          title={a.title}
          onClick={a.go}
          className={cn(
            'flex h-9 items-center gap-2 rounded-sm border px-3 text-base disabled:cursor-not-allowed disabled:opacity-50',
            a.primary === true
              ? 'border-flare bg-flare text-on-flare hover:bg-flare-hover'
              : 'border-border-strong bg-surface hover:bg-hover',
          )}
        >
          <a.icon size={14} aria-hidden />
          {a.label}
          {a.key !== undefined && <Kbd>{a.key}</Kbd>}
        </button>
      ))}
    </div>
  );
}

/* ── agent board ────────────────────────────────────────────────────────────────────────── */

function AgentBoard() {
  const me = useMe();
  const perms = usePermissions();
  const { online } = useSocketState();
  const range = useMemo(() => today(), []);

  const canCalls = perms.has('call:read');
  const canTasks = perms.has('task:read');
  const canChat = perms.has('chat:read');
  const canDeals = perms.has('deal:read');

  const summary = useCallsSummary(range, perms.has('report:view_own'));
  const tasks = useTasks({ mine: 'true', status: 'open', sort: 'dueAt', pageSize: 6 }, canTasks);
  const missed = useMissedCalls({ pageSize: 5 }, canCalls);
  const missedRows = missed.rows;
  const conversations = useConversations({ mine: 'true', status: 'open' }, canChat);
  const deals = useDeals({ ownerId: me.id, status: 'open', sort: '-value', pageSize: 5 }, canDeals);
  const complete = useCompleteTask();

  useSocketEvent('call:ended', () => {
    void summary.refetch();
    void missed.refetch();
  });
  useSocketEvent('message:new', () => {
    void conversations.refetch();
  });

  const totals = summary.data?.totals;
  const convs = conversations.data?.pages.flatMap((p) => p.data) ?? [];

  if (!online && summary.data === undefined && tasks.data === undefined) {
    return (
      <OfflineState
        onRetry={() => {
          void summary.refetch();
          void tasks.refetch();
        }}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {perms.has('report:view_own') && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <StatCard
            label="Calls today"
            value={totals?.calls ?? null}
            sub={
              totals === undefined
                ? undefined
                : `${String(totals.inbound)} in · ${String(totals.outbound)} out`
            }
            icon={Phone}
            loading={summary.isPending}
          />
          <StatCard
            label="Answered"
            value={totals?.answered ?? null}
            unit={
              summary.data === undefined
                ? undefined
                : `${String(Math.round(summary.data.answerRate * 100))}%`
            }
            sub="of inbound"
            icon={PhoneIncoming}
            loading={summary.isPending}
          />
          <StatCard
            label="Missed"
            value={totals?.missed ?? null}
            tone={(totals?.missed ?? 0) > 0 ? 'danger' : 'neutral'}
            sub={`${String(missedRows.filter((m) => !m.returned).length)} not called back`}
            icon={PhoneMissed}
            loading={summary.isPending}
          />
          <StatCard
            label="Talk time"
            value={
              summary.data === undefined ? null : (
                <Duration seconds={summary.data.totalTalkSec} format="long" />
              )
            }
            sub={
              summary.data === undefined ? undefined : (
                <>
                  avg <Duration seconds={summary.data.avgTalkSec} /> per call
                </>
              )
            }
            icon={Clock}
            loading={summary.isPending}
          />
          <StatCard
            label="Average ring"
            value={
              summary.data === undefined ? null : <Duration seconds={summary.data.avgRingSec} />
            }
            sub="before answer"
            icon={Tag}
            loading={summary.isPending}
          />
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        {canTasks && (
          <Panel
            title="Your tasks"
            note="GET /tasks?mine=true&status=open"
            padded={false}
            actions={
              <Link to="/tasks">
                <Button variant="ghost" size="sm" icon={ArrowRight}>
                  All
                </Button>
              </Link>
            }
          >
            {tasks.isPending ? (
              <ListSkeleton />
            ) : tasks.isError ? (
              <div className="p-3">
                <ErrorState
                  message={errorMessage(tasks.error)}
                  onRetry={() => {
                    void tasks.refetch();
                  }}
                />
              </div>
            ) : tasks.data.data.length === 0 ? (
              <EmptyState
                compact
                object="checkmark"
                title="Nothing open"
                description="Add the next step after your next call so it does not go quiet."
              />
            ) : (
              <ul className="divide-y divide-border">
                {tasks.data.data.map((t) => (
                  <li key={t.id} className="flex items-center gap-3 px-3.5 py-2.5">
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={t.status === 'done'}
                      aria-label={`Mark ${t.title} done`}
                      disabled={t.status === 'done'}
                      onClick={() => {
                        complete.mutate({ id: t.id });
                      }}
                      className={cn(
                        'h-4 w-4 shrink-0 rounded-xs border',
                        t.status === 'done'
                          ? 'border-flare bg-flare'
                          : 'border-border-strong hover:border-flare',
                      )}
                    />
                    <TaskPriorityFlag priority={t.priority} />
                    <span className="min-w-0 flex-1">
                      <span
                        className={cn(
                          'block truncate',
                          t.status === 'done' && 'text-faint line-through',
                        )}
                      >
                        {t.title}
                      </span>
                      <span className="block truncate text-sm text-muted">
                        {t.contact?.displayName ??
                          t.deal?.title ??
                          t.company?.name ??
                          'No linked record'}
                      </span>
                    </span>
                    <DueLabel dueAt={t.dueAt} status={t.status} />
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        )}

        {canCalls && (
          <Panel
            title="Missed calls"
            note="GET /reports/calls/missed"
            padded={false}
            actions={
              <Link to="/calls/missed">
                <Button variant="ghost" size="sm" icon={ArrowRight}>
                  Queue
                </Button>
              </Link>
            }
          >
            {missed.isPending ? (
              <ListSkeleton />
            ) : missedRows.length === 0 ? (
              <EmptyState
                compact
                object="checkmark"
                title="Nothing missed"
                description="Every call has been answered or returned."
              />
            ) : (
              <ul className="divide-y divide-border">
                {missedRows.map((m) => (
                  <li key={m.id} className="flex items-center gap-3 px-3.5 py-2.5">
                    <Avatar
                      name={m.contact?.displayName ?? 'Unknown'}
                      seed={m.contact?.id ?? m.id}
                      size={24}
                    />
                    <span className="min-w-0 flex-1">
                      <span
                        className={cn(
                          'block truncate',
                          m.contact === null ? 'text-muted' : 'font-medium',
                        )}
                      >
                        {m.contact?.displayName ?? m.externalDisplay ?? 'Unknown number'}
                      </span>
                      <span className="block truncate text-sm text-muted">
                        <DateTime value={m.startedAt} mode="relative" /> · rang{' '}
                        <Duration seconds={m.ringDurationSec} />
                        {m.attempts > 1 && ` · ${String(m.attempts)} attempts`}
                      </span>
                    </span>
                    {m.returned ? (
                      <Badge tone="neutral">Called back</Badge>
                    ) : (
                      <PhoneNumber
                        e164={m.externalNumber}
                        contactId={m.contact?.id ?? null}
                        {...(m.contact !== null ? { contactName: m.contact.displayName } : {})}
                        actions
                      />
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        )}

        {canChat && (
          <Panel
            title="Your conversations"
            note="GET /conversations?mine=true"
            padded={false}
            actions={
              <Link to="/inbox">
                <Button variant="ghost" size="sm" icon={ArrowRight}>
                  Inbox
                </Button>
              </Link>
            }
          >
            {conversations.isPending ? (
              <ListSkeleton />
            ) : convs.length === 0 ? (
              <EmptyState
                compact
                object="inbox-tray"
                title="Inbox clear"
                description="No conversation assigned to you is waiting."
              />
            ) : (
              <ul className="divide-y divide-border">
                {convs.slice(0, 5).map((c) => (
                  <li key={c.id}>
                    <Link
                      {...linkTo.conversation(c.id)}
                      className="flex items-center gap-3 px-3.5 py-2.5 hover:bg-hover"
                    >
                      <Avatar
                        name={c.contact?.displayName ?? c.externalDisplay}
                        seed={c.contactId ?? c.id}
                        size={24}
                      />
                      <span className="min-w-0 flex-1">
                        <span className={cn('block truncate', c.unreadCount > 0 && 'font-medium')}>
                          {c.contact?.displayName ?? c.externalDisplay}
                        </span>
                        <span className="block truncate text-sm text-muted">
                          {c.lastMessagePreview ?? 'No messages yet'}
                        </span>
                      </span>
                      <ReplyWindowChip lastInboundAt={c.lastInboundAt} size="sm" />
                      {c.unreadCount > 0 && (
                        <span className="mono shrink-0 rounded-full bg-flare px-1.5 text-xs text-on-flare">
                          {c.unreadCount}
                        </span>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        )}

        {canDeals && (
          <Panel
            title="Your open deals"
            note="GET /deals?ownerId=me&status=open"
            padded={false}
            actions={
              <Link to="/deals">
                <Button variant="ghost" size="sm" icon={ArrowRight}>
                  Board
                </Button>
              </Link>
            }
          >
            {deals.isPending ? (
              <ListSkeleton />
            ) : (deals.data?.data ?? []).length === 0 ? (
              <EmptyState
                compact
                object="kanban"
                title="No open deals"
                description="Open one from a contact, a company or a converted lead."
              />
            ) : (
              <ul className="divide-y divide-border">
                {(deals.data?.data ?? []).map((d) => (
                  <li key={d.id}>
                    <Link
                      {...linkTo.deal(d.id)}
                      className="flex items-center gap-3 px-3.5 py-2.5 hover:bg-hover"
                    >
                      <Kanban size={14} className="shrink-0 text-muted" aria-hidden />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{d.title}</span>
                        <span className="block truncate text-sm text-muted">
                          {d.company?.name ?? d.contact?.displayName ?? 'No company'} ·{' '}
                          {d.stage.name}
                        </span>
                      </span>
                      <span className="shrink-0 text-right">
                        <Money amount={d.value} currency={d.currency} emphasis="strong" />
                        <span className="block text-sm text-faint">
                          <DateTime value={d.expectedCloseDate} showTime={false} bare />
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        )}
      </div>
    </div>
  );
}

/* ── team board ─────────────────────────────────────────────────────────────────────────── */

function TeamBoard() {
  const perms = usePermissions();
  const range = useMemo(() => today(), []);
  const now = useNow(true, 1000);

  const canTeam = perms.has('report:view_team') || perms.has('report:view_all');
  const canPbx = perms.has('pbx:view_status');

  const summary = useCallsSummary(range, canTeam);
  const agents = useAgentPerformance(range, canTeam);
  const missed = useMissedCalls({ pageSize: 6 }, perms.has('call:read'));
  const missedRows = missed.rows;
  const pipeline = usePipelineSummary({}, perms.has('deal:read'));
  const unassigned = useConversations(
    { unassigned: 'true', status: 'open' },
    perms.has('chat:read'),
  );
  const live = useLiveCalls(canPbx);
  const cti = useCtiStatus(canPbx);
  const users = useUsers({ isActive: 'true', pageSize: MAX_PAGE_SIZE });

  const refreshLive = () => {
    void live.refetch();
    void cti.refetch();
  };
  useSocketEvent('call:ringing', refreshLive);
  useSocketEvent('call:answered', refreshLive);
  useSocketEvent('call:ended', () => {
    refreshLive();
    void summary.refetch();
  });

  if (!canTeam) {
    return (
      <ForbiddenState
        permission="report:view_team"
        what="the team board"
        backTo={{ label: 'Your own home', href: '/home?board=mine' }}
      />
    );
  }

  const totals = summary.data?.totals;
  const rows = [...(agents.data ?? [])].sort((a, b) => b.total - a.total).slice(0, 5);
  const withExtension = (users.data?.data ?? []).filter((u) => u.extension !== null).length;
  const totalUsers = users.data?.page.total ?? 0;
  const calls = [...(live.data ?? [])].sort((a, b) => a.since.localeCompare(b.since));
  const connected = cti.data?.connected ?? false;
  const unassignedConvs = unassigned.data?.pages.flatMap((p) => p.data) ?? [];
  const stages = pipeline.data?.stages ?? [];
  const peakStageValue = Math.max(1, ...stages.map((s) => s.openValue));

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <StatCard
          label="Calls today"
          value={totals?.calls ?? null}
          sub={
            totals === undefined
              ? undefined
              : `${String(totals.inbound)} in · ${String(totals.outbound)} out`
          }
          icon={Phone}
          loading={summary.isPending}
        />
        <StatCard
          label="Answered"
          value={totals?.answered ?? null}
          unit={
            summary.data === undefined
              ? undefined
              : `${String(Math.round(summary.data.answerRate * 100))}%`
          }
          sub="of inbound"
          icon={PhoneIncoming}
          loading={summary.isPending}
        />
        <StatCard
          label="Missed"
          value={totals?.missed ?? null}
          tone={(totals?.missed ?? 0) > 0 ? 'danger' : 'neutral'}
          sub={`${String(missedRows.filter((m) => !m.returned).length)} not called back`}
          icon={PhoneMissed}
          loading={summary.isPending}
        />
        <StatCard
          label="Average ring"
          value={summary.data === undefined ? null : <Duration seconds={summary.data.avgRingSec} />}
          sub="before answer"
          icon={Clock}
          loading={summary.isPending}
        />
        <StatCard
          label="Talk time"
          value={
            summary.data === undefined ? null : (
              <Duration seconds={summary.data.totalTalkSec} format="long" />
            )
          }
          sub={`across ${String(rows.length)} agents`}
          icon={AudioLines}
          loading={summary.isPending}
        />
        <StatCard
          label="Users with an extension"
          value={users.isPending ? null : withExtension}
          unit={`/ ${String(totalUsers)}`}
          sub="GAP-15: PBX registration is not exposed"
          icon={Users}
          loading={users.isPending}
        />
      </div>

      {canPbx && (
        <Panel
          title={
            <span className="flex items-center gap-2">
              Live calls
              <span
                className={cn(
                  'h-2 w-2 rounded-full',
                  connected ? 'live-pulse bg-success' : 'bg-danger',
                )}
                aria-hidden
              />
              <span className={cn('text-sm font-normal', connected ? 'text-muted' : 'text-danger')}>
                {connected
                  ? `${String(calls.length)} in progress`
                  : 'stale, the PBX event stream is down'}
              </span>
            </span>
          }
          note="GET /calls/live · GET /cti/status"
          actions={
            <Link to="/live-calls">
              <Button variant="ghost" size="sm" icon={ArrowRight}>
                Board
              </Button>
            </Link>
          }
        >
          {live.isPending ? (
            <Skeleton height={80} shape="block" />
          ) : calls.length === 0 ? (
            <p className="text-base text-muted">
              {connected
                ? 'Nothing on the line right now.'
                : 'Nothing to show while the event stream is down.'}
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {calls.map((c) => {
                const ringing = c.status === 'ringing';
                const elapsed = Math.max(0, Math.floor((now - new Date(c.since).getTime()) / 1000));
                return (
                  <li
                    key={c.pbxCallId}
                    className={cn(
                      'flex items-center gap-3 rounded-sm border px-3 py-2',
                      ringing ? 'border-flare ring-pulse' : 'border-border',
                    )}
                  >
                    {c.direction === 'inbound' ? (
                      <PhoneIncoming size={14} className="shrink-0 text-success" aria-hidden />
                    ) : (
                      <PhoneOutgoing size={14} className="shrink-0 text-muted" aria-hidden />
                    )}
                    <Badge tone={ringing ? 'warning' : c.status === 'held' ? 'neutral' : 'success'}>
                      {ringing ? 'Ringing' : c.status === 'held' ? 'On hold' : 'Talking'}
                    </Badge>
                    <span className="min-w-0 flex-1 truncate">
                      {c.contactName ?? c.external ?? 'Unknown number'}
                    </span>
                    <span className="hidden min-w-0 truncate text-sm text-muted sm:block">
                      {c.userName ?? 'Not answered'}
                      {c.extension !== null && ` · ext ${c.extension}`}
                    </span>
                    <span className="mono tnum shrink-0">{formatElapsed(elapsed)}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        {perms.has('deal:read') && (
          <Panel title="Pipeline" note="GET /reports/pipeline/summary">
            {pipeline.isPending ? (
              <Skeleton height={140} shape="block" />
            ) : stages.length === 0 ? (
              <EmptyState
                compact
                object="pipeline"
                title="Nothing in the pipeline"
                description="Open a deal and it appears here by stage."
              />
            ) : (
              <BarChart
                max={peakStageValue}
                series={stages.map((st) => ({
                  label: `${st.name} · ${String(st.openCount)}`,
                  segments: [
                    {
                      value: st.openValue,
                      tone:
                        st.openValue === peakStageValue ? 'var(--flare)' : 'var(--border-strong)',
                    },
                  ],
                  meta: <Money amount={st.openValue} currency={pipeline.data?.currency} compact />,
                }))}
              />
            )}
          </Panel>
        )}

        <Panel title="Busiest agents" note="GET /reports/calls/agents" padded={false}>
          {agents.isPending ? (
            <ListSkeleton />
          ) : rows.length === 0 ? (
            <EmptyState
              compact
              object="headset"
              title="No activity today"
              description="Nobody has handled a call yet."
            />
          ) : (
            <ul className="divide-y divide-border">
              {rows.map((a) => (
                <li key={a.userId} className="flex items-center gap-3 px-3.5 py-2.5">
                  <Avatar name={a.name} seed={a.userId} size={24} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{a.name}</span>
                    <span className="mono block truncate text-sm text-faint">
                      {a.extension === null ? 'no extension' : `ext ${a.extension}`}
                    </span>
                  </span>
                  <span className="tnum w-10 text-right text-sm">{a.total}</span>
                  <span
                    className={cn(
                      'tnum w-10 text-right text-sm',
                      a.missed > 3 ? 'text-danger' : 'text-muted',
                    )}
                  >
                    {a.missed}
                  </span>
                  <span className="w-14 text-right text-sm text-muted">
                    <Duration seconds={a.totalTalkSec} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        {perms.has('call:read') && (
          <Panel
            title="Missed across the team"
            note="GET /reports/calls/missed"
            padded={false}
            actions={
              <Link to="/calls/missed">
                <Button variant="ghost" size="sm" icon={ArrowRight}>
                  Queue
                </Button>
              </Link>
            }
          >
            {missed.isPending ? (
              <ListSkeleton />
            ) : missedRows.length === 0 ? (
              <EmptyState
                compact
                object="checkmark"
                title="Nothing missed"
                description="Every call was answered."
              />
            ) : (
              <ul className="divide-y divide-border">
                {missedRows.map((m) => (
                  <li key={m.id} className="flex items-center gap-3 px-3.5 py-2.5">
                    <Avatar
                      name={m.contact?.displayName ?? 'Unknown'}
                      seed={m.contact?.id ?? m.id}
                      size={24}
                    />
                    <span className="min-w-0 flex-1">
                      <span
                        className={cn(
                          'block truncate',
                          m.contact === null ? 'text-muted' : 'font-medium',
                        )}
                      >
                        {m.contact?.displayName ?? m.externalDisplay ?? 'Unknown number'}
                      </span>
                      <span className="block truncate text-sm text-muted">
                        <DateTime value={m.startedAt} mode="relative" />
                        {m.didNumber !== null && ` · to ${m.didNumber}`}
                      </span>
                    </span>
                    {m.returned ? (
                      <Badge tone="neutral">Called back</Badge>
                    ) : (
                      <Badge tone="warning">Waiting</Badge>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        )}

        {perms.has('chat:read') && (
          <Panel
            title="Unassigned conversations"
            note="GET /conversations?unassigned=true"
            padded={false}
            actions={
              <Link to="/inbox" search={{ scope: 'unassigned' } as never}>
                <Button variant="ghost" size="sm" icon={ArrowRight}>
                  Inbox
                </Button>
              </Link>
            }
          >
            {unassigned.isPending ? (
              <ListSkeleton />
            ) : unassignedConvs.length === 0 ? (
              <EmptyState
                compact
                object="inbox-tray"
                title="Everything is assigned"
                description="No conversation is waiting for an owner."
              />
            ) : (
              <ul className="divide-y divide-border">
                {unassignedConvs.slice(0, 5).map((c) => (
                  <li key={c.id}>
                    <Link
                      {...linkTo.conversation(c.id)}
                      className="flex items-center gap-3 px-3.5 py-2.5 hover:bg-hover"
                    >
                      <Avatar
                        name={c.contact?.displayName ?? c.externalDisplay}
                        seed={c.contactId ?? c.id}
                        size={24}
                      />
                      <span className="min-w-0 flex-1">
                        <span className={cn('block truncate', c.contact === null && 'text-muted')}>
                          {c.contact?.displayName ?? c.externalDisplay}
                        </span>
                        <span className="block truncate text-sm text-muted">
                          {c.lastMessagePreview ?? 'No messages yet'}
                        </span>
                      </span>
                      <span className="shrink-0 text-sm text-warning">
                        waiting <DateTime value={c.lastInboundAt} mode="relative" bare />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        )}
      </div>

      {canPbx && cti.data !== undefined && (
        <Panel title="PBX" note="GET /cti/status">
          <dl className="grid grid-cols-[minmax(0,150px)_minmax(0,1fr)] gap-x-3 gap-y-2 text-base">
            <dt className="text-sm text-muted">Status</dt>
            <dd>
              <Badge tone={connected ? 'success' : 'danger'}>
                {connected ? 'Connected' : 'Disconnected'}
              </Badge>
            </dd>
            <dt className="text-sm text-muted">
              {connected ? 'Connected since' : 'Disconnected since'}
            </dt>
            <dd>
              <DateTime value={cti.data.since} />
            </dd>
            <dt className="text-sm text-muted">Last event</dt>
            <dd>
              <DateTime value={cti.data.lastEventAt} />
              <span className="mono ml-2 text-sm text-faint">{cti.data.eventSource}</span>
            </dd>
            <dt className="text-sm text-muted">Live calls</dt>
            <dd className="mono">{cti.data.liveCalls}</dd>
          </dl>
        </Panel>
      )}
    </div>
  );
}

/* ── bits ───────────────────────────────────────────────────────────────────────────────── */

function ListSkeleton() {
  return (
    <div className="flex flex-col gap-2 p-3">
      {[0, 1, 2, 3].map((i) => (
        <Skeleton key={i} height={36} shape="block" />
      ))}
    </div>
  );
}

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
