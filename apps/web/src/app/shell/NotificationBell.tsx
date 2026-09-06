/**
 * NotificationBell and NotificationList (Component Inventory · App shell). The same list renders
 * the dropdown and the notification centre page. `notification:new` prepends and increments.
 */
import type { NotificationDto } from '@crm/shared';
import { Link, useNavigate } from '@tanstack/react-router';
import {
  AtSign,
  Bell,
  Clock,
  Info,
  Kanban,
  MessageCircle,
  PhoneMissed,
  SquareCheck,
  type LucideIcon,
} from 'lucide-react';
import { useRef, useState } from 'react';
import { Button, IconButton } from '@/components/ui/Button';
import { Popover } from '@/components/ui/Menu';
import { Skeleton } from '@/components/ui/Loading';
import { DateTime } from '@/components/data/formatters';
import { EmptyState } from '@/components/data/states';
import { cn } from '@/lib/utils';
import {
  notificationHref,
  useMarkAllRead,
  useMarkNotificationRead,
  useNotifications,
  useUnreadCount,
} from '@/features/notifications/api';

const TYPE_META: Record<string, { icon: LucideIcon; color: string; label: string }> = {
  call_missed: { icon: PhoneMissed, color: 'text-danger', label: 'Missed call' },
  call_incoming: { icon: PhoneMissed, color: 'text-flare', label: 'Call' },
  message_new: { icon: MessageCircle, color: 'text-success', label: 'Message' },
  task_due: { icon: Clock, color: 'text-warning', label: 'Task due' },
  task_assigned: { icon: SquareCheck, color: 'text-muted', label: 'Task' },
  deal_stage: { icon: Kanban, color: 'text-muted', label: 'Deal' },
  mention: { icon: AtSign, color: 'text-muted', label: 'Mention' },
  system: { icon: Info, color: 'text-muted', label: 'System' },
};

export function metaFor(type: string) {
  return TYPE_META[type] ?? { icon: Info, color: 'text-muted', label: 'Notification' };
}

export function NotificationBell() {
  const anchor = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const unread = useUnreadCount();
  const count = unread.data ?? 0;

  return (
    <>
      <span className="relative">
        <IconButton
          ref={anchor}
          icon={Bell}
          label={count > 0 ? `Notifications, ${String(count)} unread` : 'Notifications'}
          variant="ghost"
          size={32}
          onClick={() => {
            setOpen((o) => !o);
          }}
        />
        {count > 0 && (
          <span
            aria-hidden
            className="tnum pointer-events-none absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-flare px-1 text-2xs font-medium text-[var(--on-flare)]"
          >
            {count > 99 ? '99+' : count}
          </span>
        )}
      </span>
      <Popover
        open={open}
        onOpenChange={setOpen}
        anchor={anchor}
        align="end"
        width={380}
        ariaLabel="Notifications"
      >
        <NotificationDropdown
          onClose={() => {
            setOpen(false);
          }}
        />
      </Popover>
    </>
  );
}

function NotificationDropdown({ onClose }: { onClose: () => void }) {
  const list = useNotifications();
  const markAll = useMarkAllRead();
  const items = list.data?.pages.flatMap((p) => p.data) ?? [];
  return (
    <div className="flex max-h-[70vh] flex-col">
      <div className="flex items-center gap-2 border-b border-border px-2.5 py-2">
        <span className="text-base font-medium">Notifications</span>
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto"
          loading={markAll.isPending}
          onClick={() => {
            markAll.mutate();
          }}
        >
          Mark all read
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {list.isPending && (
          <div className="flex flex-col gap-2 p-3">
            <Skeleton count={4} height={36} shape="block" />
          </div>
        )}
        {!list.isPending && items.length === 0 && (
          <EmptyState
            compact
            object="bell"
            title="Nothing new"
            description="Missed calls, messages and task reminders land here."
          />
        )}
        {items.slice(0, 6).map((n) => (
          <NotificationRow key={n.id} notification={n} onNavigate={onClose} compact />
        ))}
      </div>
      <div className="border-t border-border p-1.5">
        <Link
          to="/notifications"
          onClick={onClose}
          className="block no-underline hover:no-underline"
        >
          <Button variant="ghost" full>
            See all notifications
          </Button>
        </Link>
      </div>
    </div>
  );
}

export function NotificationRow({
  notification,
  onNavigate,
  compact = false,
}: {
  notification: NotificationDto;
  onNavigate?: () => void;
  compact?: boolean;
}) {
  const meta = metaFor(notification.type);
  const markRead = useMarkNotificationRead();
  const navigate = useNavigate();
  const href = notificationHref(notification);
  const unread = notification.readAt === null;

  return (
    <div
      className={cn(
        'flex w-full items-start gap-2.5 border-b border-border px-2.5 py-2.5 text-left last:border-b-0',
        unread ? 'bg-surface' : 'bg-transparent',
        href !== null && 'cursor-pointer hover:bg-hover',
      )}
      role={href !== null ? 'button' : undefined}
      tabIndex={href !== null ? 0 : undefined}
      onClick={() => {
        if (unread) markRead.mutate(notification.id);
        if (href !== null) {
          onNavigate?.();
          void navigate({ to: href });
        }
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && href !== null) {
          if (unread) markRead.mutate(notification.id);
          onNavigate?.();
          void navigate({ to: href });
        }
      }}
    >
      <span className={cn('mt-0.5 shrink-0', meta.color)}>
        <meta.icon size={15} aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <div className={cn('truncate text-base', unread && 'font-medium')}>
          {notification.title}
        </div>
        {notification.body !== null && (
          <div className={cn('text-sm text-muted', compact ? 'truncate' : 'line-clamp-2')}>
            {notification.body}
          </div>
        )}
        <div className="mt-0.5 flex items-center gap-2 text-xs text-faint">
          <span>{meta.label}</span>
          <DateTime value={notification.createdAt} bare />
        </div>
      </div>
      {unread && <i className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-flare" aria-hidden />}
    </div>
  );
}
