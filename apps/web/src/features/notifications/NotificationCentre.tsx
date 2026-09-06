/**
 * Notification centre (App Shell · Notifications). The full list behind the bell, plus the
 * per-type preferences.
 *
 * Marking read is optimistic: POST /notifications/:id/read is idempotent, so a click that fails
 * simply rolls back rather than leaving the bell wrong.
 * A notification with no destination is still shown; it just does not link anywhere, which is
 * better than hiding something the user was told about.
 */
import type { NotificationDto } from '@crm/shared';
import { useNavigate } from '@tanstack/react-router';
import {
  AtSign,
  Bell,
  CheckCheck,
  Info,
  Kanban,
  MessageCircle,
  PhoneIncoming,
  PhoneMissed,
  SquareCheck,
  UserPlus,
  type LucideIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Loading';
import { Switch } from '@/components/ui/Toggle';
import { Tabs } from '@/components/ui/Menu';
import { toast } from '@/components/ui/toast';
import { DateTime } from '@/components/data/formatters';
import { EmptyState, ErrorState } from '@/components/data/states';
import { Panel } from '@/components/entity/EntityHeader';
import { PageHeader } from '@/app/shell/TopBar';
import { usePageMeta } from '@/app/shell/page-meta';
import { errorMessage } from '@/lib/api/errors';
import { useSearchParam } from '@/lib/list-state';
import { cn } from '@/lib/utils';
import {
  notificationHref,
  useMarkAllRead,
  useMarkNotificationRead,
  useNotificationPreferences,
  useNotifications,
  useUnreadCount,
  useUpdateNotificationPreferences,
} from './api';

const ICONS: Record<string, LucideIcon> = {
  call_incoming: PhoneIncoming,
  call_missed: PhoneMissed,
  message_new: MessageCircle,
  task_due: SquareCheck,
  task_assigned: UserPlus,
  deal_stage: Kanban,
  mention: AtSign,
  system: Info,
};

const TYPE_LABELS: Record<string, string> = {
  call_incoming: 'Incoming call',
  call_missed: 'Missed call',
  message_new: 'New message',
  task_due: 'Task due',
  task_assigned: 'Task assigned to me',
  deal_stage: 'Deal stage changed',
  mention: 'Someone mentioned me',
  system: 'System notices',
};

export function NotificationCentre() {
  usePageMeta([{ label: 'Notifications' }]);
  const [tab, setTab] = useSearchParam('tab');
  const active = tab ?? 'all';
  const unreadCount = useUnreadCount();
  const markAll = useMarkAllRead();

  return (
    <div className="flex flex-col gap-4 p-6">
      <PageHeader
        title="Notifications"
        description="Everything the CRM has told you, and what it is allowed to tell you."
        actions={
          (unreadCount.data ?? 0) > 0 ? (
            <Button
              variant="secondary"
              icon={CheckCheck}
              loading={markAll.isPending}
              onClick={() => {
                markAll.mutate(undefined, {
                  onError: (e) => {
                    toast({
                      tone: 'danger',
                      title: 'Could not mark all read',
                      description: errorMessage(e),
                    });
                  },
                });
              }}
            >
              Mark all read
            </Button>
          ) : undefined
        }
      />

      <Tabs
        tabs={[
          { id: 'all', label: 'All' },
          {
            id: 'unread',
            label: 'Unread',
            ...(unreadCount.data !== undefined ? { count: unreadCount.data } : {}),
          },
          { id: 'preferences', label: 'Preferences' },
        ]}
        value={active}
        onChange={(id) => {
          setTab(id === 'all' ? undefined : id);
        }}
        ariaLabel="Notification views"
      />

      {active === 'preferences' ? (
        <PreferencesPanel />
      ) : (
        <NotificationList unread={active === 'unread'} />
      )}
    </div>
  );
}

function NotificationList({ unread }: { unread: boolean }) {
  const navigate = useNavigate();
  const query = useNotifications(unread ? { unread: true } : {});
  const markRead = useMarkNotificationRead();
  const items = query.data?.pages.flatMap((p) => p.data) ?? [];

  const open = (n: NotificationDto) => {
    if (n.readAt === null) markRead.mutate(n.id);
    const href = notificationHref(n);
    if (href !== null) void navigate({ to: href });
  };

  if (query.isPending) {
    return (
      <div className="flex flex-col gap-2">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} height={56} shape="block" />
        ))}
      </div>
    );
  }

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

  if (items.length === 0) {
    return (
      <EmptyState
        object="bell"
        title={unread ? 'Nothing unread' : 'No notifications yet'}
        description={
          unread
            ? 'You are caught up.'
            : 'Missed calls, new messages and tasks assigned to you land here as they happen.'
        }
      />
    );
  }

  return (
    <>
      <Panel padded={false}>
        <ul className="divide-y divide-border">
          {items.map((n) => {
            const Icon = ICONS[n.type] ?? Bell;
            const href = notificationHref(n);
            return (
              <li key={n.id}>
                <button
                  type="button"
                  onClick={() => {
                    open(n);
                  }}
                  className={cn(
                    'flex w-full items-start gap-3 px-3.5 py-2.5 text-left hover:bg-hover',
                    n.readAt === null && 'bg-[var(--flare-subtle)]',
                  )}
                >
                  <Icon size={15} className="mt-0.5 shrink-0 text-muted" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className={cn('block truncate', n.readAt === null && 'font-medium')}>
                      {n.title}
                    </span>
                    {n.body !== null && (
                      <span className="block truncate text-sm text-muted">{n.body}</span>
                    )}
                    {href === null && (
                      <span className="block text-xs text-faint">No linked record</span>
                    )}
                  </span>
                  {n.readAt === null && (
                    <span
                      className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-flare"
                      aria-label="Unread"
                    />
                  )}
                  <span className="shrink-0 text-sm text-faint">
                    <DateTime value={n.createdAt} mode="relative" bare />
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </Panel>

      {query.hasNextPage && (
        <Button
          variant="secondary"
          className="self-center"
          loading={query.isFetchingNextPage}
          onClick={() => {
            void query.fetchNextPage();
          }}
        >
          Load older
        </Button>
      )}
    </>
  );
}

function PreferencesPanel() {
  const query = useNotificationPreferences();
  const update = useUpdateNotificationPreferences();
  const prefs = query.data ?? [];

  const set = (type: string, patch: { inApp?: boolean; email?: boolean }) => {
    const next = prefs.map((p) => (p.type === type ? { ...p, ...patch } : p));
    update.mutate(next, {
      onError: (e) => {
        toast({
          tone: 'danger',
          title: 'Could not save the preference',
          description: errorMessage(e),
        });
      },
    });
  };

  if (query.isPending) return <Skeleton height={220} shape="block" />;
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

  return (
    <Panel
      title="What you are told about"
      note="PUT /notifications/preferences · turning something off here does not stop it happening, only the notice"
      padded={false}
    >
      <div className="grid grid-cols-[minmax(0,1fr)_80px_80px] items-center gap-3 border-b border-border px-3.5 py-2 text-sm text-muted">
        <span>Notification</span>
        <span className="text-center">In app</span>
        <span className="text-center">Email</span>
      </div>
      <ul className="divide-y divide-border">
        {prefs.map((p) => (
          <li
            key={p.type}
            className="grid grid-cols-[minmax(0,1fr)_80px_80px] items-center gap-3 px-3.5 py-2.5"
          >
            <span className="min-w-0 truncate">{TYPE_LABELS[p.type] ?? p.type}</span>
            <span className="flex justify-center">
              <Switch
                checked={p.inApp}
                ariaLabel={`${TYPE_LABELS[p.type] ?? p.type} in app`}
                onChange={(v) => {
                  set(p.type, { inApp: v });
                }}
              />
            </span>
            <span className="flex justify-center">
              <Switch
                checked={p.email}
                ariaLabel={`${TYPE_LABELS[p.type] ?? p.type} by email`}
                onChange={(v) => {
                  set(p.type, { email: v });
                }}
              />
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
