/**
 * Every status pill in the product, so two screens can never disagree about what "missed" or
 * "won" looks like (Design System · Badges and status).
 */
import {
  ArrowRightLeft,
  AudioLines,
  Ban,
  Check,
  CheckCheck,
  CircleAlert,
  Clock,
  Flag,
  Lock,
  PhoneIncoming,
  PhoneMissed,
  PhoneOutgoing,
  Voicemail,
  type LucideIcon,
} from 'lucide-react';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { useNow } from '@/lib/hooks';
import { cn } from '@/lib/utils';

export function CallStatusBadge({ status, live = false }: { status: string; live?: boolean }) {
  const map: Record<
    string,
    {
      label: string;
      tone: BadgeTone;
      icon?: LucideIcon;
      dot?: boolean;
      pulse?: boolean;
      live?: boolean;
    }
  > = {
    ringing: { label: 'Ringing', tone: 'flare', dot: true, pulse: true },
    talking: { label: 'Talking', tone: 'success', dot: true, live: true },
    answered: { label: 'Completed', tone: 'outline' },
    completed: { label: 'Completed', tone: 'outline' },
    missed: { label: 'Missed', tone: 'danger', icon: PhoneMissed },
    busy: { label: 'Busy', tone: 'outline' },
    failed: { label: 'Failed', tone: 'danger' },
    no_answer: { label: 'No answer', tone: 'outline' },
    voicemail: { label: 'Voicemail', tone: 'outline', icon: Voicemail },
    abandoned: { label: 'Abandoned', tone: 'outline' },
    cancelled: { label: 'Cancelled', tone: 'outline' },
  };
  const m = map[status] ?? { label: status, tone: 'outline' as BadgeTone };
  return (
    <Badge
      tone={m.tone}
      icon={m.icon}
      dot={m.dot ?? false}
      pulse={m.pulse ?? false}
      live={(m.live ?? false) || live}
    >
      {m.label}
    </Badge>
  );
}

export function CallDirection({ direction, className }: { direction: string; className?: string }) {
  const Icon =
    direction === 'outbound'
      ? PhoneOutgoing
      : direction === 'internal'
        ? ArrowRightLeft
        : PhoneIncoming;
  const label =
    direction === 'outbound' ? 'Outbound' : direction === 'internal' ? 'Internal' : 'Inbound';
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-muted', className)} title={label}>
      <Icon size={14} aria-hidden />
      <span className="truncate">{label}</span>
    </span>
  );
}

export function DealStatusBadge({ status }: { status: string }) {
  if (status === 'won') return <Badge tone="success">Won</Badge>;
  if (status === 'lost') return <Badge tone="danger">Lost</Badge>;
  return <Badge tone="outline">Open</Badge>;
}

export function LeadStatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; tone: BadgeTone }> = {
    new: { label: 'New', tone: 'flare' },
    contacted: { label: 'Contacted', tone: 'outline' },
    qualified: { label: 'Qualified', tone: 'outline' },
    unqualified: { label: 'Unqualified', tone: 'neutral' },
    converted: { label: 'Converted', tone: 'success' },
  };
  const m = map[status] ?? { label: status, tone: 'outline' as BadgeTone };
  return <Badge tone={m.tone}>{m.label}</Badge>;
}

export function TaskPriorityFlag({ priority }: { priority: string }) {
  const tone =
    priority === 'high' ? 'text-danger' : priority === 'low' ? 'text-faint' : 'text-muted';
  return (
    <span className={cn('inline-flex items-center gap-1', tone)} title={`${priority} priority`}>
      <Flag size={12} aria-hidden />
      <span className="capitalize">{priority}</span>
    </span>
  );
}

/** Due dates carry their own urgency colour (Design System · Task priority / Due). */
export function DueLabel({ dueAt, status }: { dueAt: string | null; status: string }) {
  // Ticks once a minute so "in 2h" does not go stale on a screen left open.
  const now = useNow(dueAt !== null && status !== 'done', 60_000);
  if (dueAt === null) return <span className="text-faint">—</span>;
  if (status === 'done') return <span className="text-muted">Done</span>;
  const due = new Date(dueAt).getTime();
  const diff = due - now;
  const hours = Math.round(Math.abs(diff) / 3_600_000);
  if (diff < 0) {
    return (
      <span className="text-danger">
        Overdue {hours < 24 ? `${String(hours)} h` : `${String(Math.round(hours / 24))} d`}
      </span>
    );
  }
  const sameDay = new Date(dueAt).toDateString() === new Date().toDateString();
  if (sameDay) {
    return <span className="text-warning">Today {new Date(dueAt).toTimeString().slice(0, 5)}</span>;
  }
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (new Date(dueAt).toDateString() === tomorrow.toDateString()) {
    return <span className="text-muted">Tomorrow</span>;
  }
  return (
    <span className="text-muted">
      {new Date(dueAt).toLocaleDateString('en-KE', { day: 'numeric', month: 'short' })}
    </span>
  );
}

export function MessageTicks({
  status,
  errorMessage,
}: {
  status: string;
  errorMessage?: string | null;
}) {
  if (status === 'failed') {
    return (
      <span className="inline-flex items-center gap-1 text-danger" title={errorMessage ?? 'Failed'}>
        <CircleAlert size={12} aria-hidden />
        <span className="truncate">Failed{errorMessage != null && ` · ${errorMessage}`}</span>
      </span>
    );
  }
  if (status === 'queued') {
    return (
      <span className="inline-flex items-center gap-1 text-faint" title="Queued">
        <Clock size={12} aria-hidden />
      </span>
    );
  }
  if (status === 'sent') {
    return (
      <span className="inline-flex items-center gap-1 text-muted" title="Sent">
        <Check size={12} aria-hidden />
      </span>
    );
  }
  if (status === 'delivered') {
    return (
      <span className="inline-flex items-center gap-1 text-muted" title="Delivered">
        <CheckCheck size={12} aria-hidden />
      </span>
    );
  }
  if (status === 'read') {
    return (
      <span className="inline-flex items-center gap-1 text-info" title="Read">
        <CheckCheck size={12} aria-hidden />
      </span>
    );
  }
  return null;
}

export function DoNotCallBadge({ compact = false }: { compact?: boolean }) {
  return (
    <Badge tone="danger" icon={Ban} title="Do not call">
      {compact ? 'DNC' : 'Do not call'}
    </Badge>
  );
}

export function RecordingBadge() {
  return (
    <Badge tone="outline" icon={AudioLines}>
      Recording
    </Badge>
  );
}

/** The 24 h WhatsApp window in three sizes (Component Inventory · ReplyWindowChip). */
export function ReplyWindowChip({
  lastInboundAt,
  size = 'md',
}: {
  lastInboundAt: string | null;
  size?: 'sm' | 'md';
}) {
  // Ticks once a minute so the countdown to the window closing stays truthful.
  const now = useNow(lastInboundAt !== null, 60_000);
  if (lastInboundAt === null) {
    return (
      <Badge tone="neutral" icon={Lock}>
        {size === 'sm' ? 'Closed' : 'Window closed'}
      </Badge>
    );
  }
  const msLeft = new Date(lastInboundAt).getTime() + 24 * 3_600_000 - now;
  if (msLeft <= 0) {
    return (
      <Badge tone="neutral" icon={Lock}>
        {size === 'sm' ? 'Closed' : 'Window closed'}
      </Badge>
    );
  }
  const hours = Math.floor(msLeft / 3_600_000);
  const mins = Math.floor((msLeft % 3_600_000) / 60_000);
  const closing = hours < 3;
  return (
    <Badge tone={closing ? 'warning' : 'outline'} icon={Clock}>
      {size === 'sm'
        ? hours > 0
          ? `${String(hours)} h`
          : `${String(mins)} m`
        : `Window closes in ${hours > 0 ? `${String(hours)} h` : `${String(mins)} min`}`}
    </Badge>
  );
}

export function ImportStatusBadge({ status }: { status: string }) {
  const map: Record<string, BadgeTone> = {
    queued: 'outline',
    running: 'flare',
    done: 'success',
    failed: 'danger',
    cancelled: 'neutral',
  };
  return (
    <Badge tone={map[status] ?? 'outline'} dot={status === 'running'} pulse={status === 'running'}>
      <span className="capitalize">{status}</span>
    </Badge>
  );
}
