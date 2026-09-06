/**
 * Timeline / TimelineItem (Component Inventory · Data display): the activity feed with per-type
 * icons, filters, search and cursor pagination. Used on contact, company, deal and lead.
 */
import { ActivityType, valuesOf, type ActivityDto } from '@crm/shared';
import { Link } from '@tanstack/react-router';
import {
  ArrowRightLeft,
  AudioLines,
  CircleCheck,
  Kanban,
  Mail,
  MessageCircle,
  PhoneIncoming,
  PhoneOutgoing,
  Search,
  SquareCheck,
  StickyNote,
  Trophy,
  UserPlus,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useMemo } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Skeleton } from '@/components/ui/Loading';
import { DateTime } from '@/components/data/formatters';
import { EmptyState, ErrorState } from '@/components/data/states';
import { cn } from '@/lib/utils';

const ICON: Record<string, { icon: LucideIcon; tone: string; label: string }> = {
  call: { icon: PhoneIncoming, tone: 'text-muted', label: 'Call' },
  message: { icon: MessageCircle, tone: 'text-success', label: 'Message' },
  note: { icon: StickyNote, tone: 'text-muted', label: 'Note' },
  task_created: { icon: SquareCheck, tone: 'text-muted', label: 'Task' },
  task_completed: { icon: CircleCheck, tone: 'text-success', label: 'Task done' },
  deal_created: { icon: Kanban, tone: 'text-muted', label: 'Deal' },
  deal_stage: { icon: ArrowRightLeft, tone: 'text-muted', label: 'Stage' },
  deal_won: { icon: Trophy, tone: 'text-success', label: 'Won' },
  deal_lost: { icon: X, tone: 'text-danger', label: 'Lost' },
  contact_created: { icon: UserPlus, tone: 'text-muted', label: 'Created' },
  contact_updated: { icon: UserPlus, tone: 'text-muted', label: 'Updated' },
  email: { icon: Mail, tone: 'text-muted', label: 'Email' },
  lead_converted: { icon: ArrowRightLeft, tone: 'text-flare', label: 'Converted' },
};

const FILTERS: { id: string; label: string; types: string[] }[] = [
  { id: 'all', label: 'All', types: [] },
  { id: 'calls', label: 'Calls', types: ['call'] },
  { id: 'messages', label: 'Messages', types: ['message'] },
  { id: 'notes', label: 'Notes', types: ['note'] },
  { id: 'tasks', label: 'Tasks', types: ['task_created', 'task_completed'] },
  { id: 'deals', label: 'Deals', types: ['deal_created', 'deal_stage', 'deal_won', 'deal_lost'] },
];

export interface TimelineProps {
  items: ActivityDto[];
  state: 'loading' | 'ready' | 'empty' | 'error';
  filter: string;
  onFilterChange: (id: string) => void;
  query: string;
  onQueryChange: (q: string) => void;
  hasMore: boolean;
  loadingMore?: boolean;
  onLoadMore: () => void;
  onRetry?: () => void;
  emptyTitle?: string;
  emptyDescription?: string;
  className?: string;
}

export function typesForFilter(id: string): string | undefined {
  const f = FILTERS.find((x) => x.id === id);
  if (f === undefined || f.types.length === 0) return undefined;
  return f.types.join(',');
}

export function Timeline({
  items,
  state,
  filter,
  onFilterChange,
  query,
  onQueryChange,
  hasMore,
  loadingMore = false,
  onLoadMore,
  onRetry,
  emptyTitle = 'Nothing here yet',
  emptyDescription = 'Calls, messages, notes, tasks and deal changes all land on this timeline.',
  className,
}: TimelineProps) {
  const groups = useMemo(() => groupByDay(items), [items]);

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <div className="flex flex-wrap items-center gap-2">
        <div className="scrollbar-none flex gap-1.5 overflow-x-auto">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              aria-pressed={filter === f.id}
              onClick={() => {
                onFilterChange(f.id);
              }}
              className={cn(
                'h-7 shrink-0 rounded-full border px-2.5 text-sm whitespace-nowrap',
                filter === f.id
                  ? 'border-flare bg-[var(--flare-subtle)] font-medium text-flare-on'
                  : 'border-border text-muted hover:text-text',
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
        <Input
          value={query}
          onChange={(e) => {
            onQueryChange(e.target.value);
          }}
          placeholder="Search this timeline"
          aria-label="Search timeline"
          prefix={<Search size={14} aria-hidden />}
          containerClassName="ml-auto w-full max-w-[240px]"
        />
      </div>

      {state === 'loading' && (
        <div className="flex flex-col gap-3 py-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="grid grid-cols-[24px_1fr] gap-3">
              <Skeleton shape="circle" height={24} />
              <div className="flex flex-col gap-1.5">
                <Skeleton height={12} width="45%" />
                <Skeleton height={12} width="70%" />
              </div>
            </div>
          ))}
        </div>
      )}

      {state === 'error' && (
        <ErrorState compact message="The timeline could not be loaded." onRetry={onRetry} />
      )}

      {state === 'empty' && (
        <EmptyState object="clock" title={emptyTitle} description={emptyDescription} />
      )}

      {state === 'ready' &&
        groups.map((g) => (
          <section key={g.day} className="flex flex-col">
            <h4 className="sticky top-0 z-[1] bg-bg py-1.5 text-sm font-medium text-muted">
              {g.day}
            </h4>
            <ol className="flex flex-col">
              {g.items.map((a, i) => (
                <TimelineItem key={a.id} activity={a} last={i === g.items.length - 1} />
              ))}
            </ol>
          </section>
        ))}

      {state === 'ready' && hasMore && (
        <Button
          variant="secondary"
          loading={loadingMore}
          onClick={onLoadMore}
          className="self-center"
        >
          Load older
        </Button>
      )}
    </div>
  );
}

export function TimelineItem({
  activity,
  last = false,
}: {
  activity: ActivityDto;
  last?: boolean;
}) {
  const meta = ICON[activity.type] ?? {
    icon: StickyNote,
    tone: 'text-muted',
    label: activity.type,
  };
  const direction = activity.meta.direction;
  const Icon = activity.type === 'call' && direction === 'outbound' ? PhoneOutgoing : meta.icon;
  const detail = detailLine(activity);
  const href = linkFor(activity);

  const body = (
    <>
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-medium">{activity.summary}</span>
        <span className="text-sm text-muted">
          <DateTime value={activity.occurredAt} bare />
          {activity.actor !== null && ` · ${activity.actor.name}`}
        </span>
      </div>
      {detail !== null && <div className="text-sm text-muted">{detail}</div>}
    </>
  );

  return (
    <li className="grid grid-cols-[24px_minmax(0,1fr)] gap-3">
      <div className="flex flex-col items-center gap-1">
        <span
          className={cn(
            'flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border bg-surface',
            meta.tone,
          )}
        >
          <Icon size={12} aria-hidden />
        </span>
        {!last && <i className="w-px flex-1 bg-[var(--border)]" aria-hidden />}
      </div>
      <div className="min-w-0 pb-4 text-base">
        {href !== null ? (
          <Link to={href} className="block text-text no-underline hover:no-underline">
            {body}
          </Link>
        ) : (
          body
        )}
      </div>
    </li>
  );
}

function detailLine(a: ActivityDto): React.ReactNode {
  const meta = a.meta;
  if (a.type === 'call') {
    const bits: string[] = [];
    const disposition = meta.disposition;
    if (typeof disposition === 'string') bits.push(`Disposition: ${disposition}`);
    const recording = meta.recordingStatus;
    if (recording === 'stored') {
      return (
        <span className="flex items-center gap-1.5">
          {bits.join(' · ')}
          <span className="inline-flex items-center gap-1">
            <AudioLines size={11} aria-hidden />
            Recording
          </span>
        </span>
      );
    }
    return bits.length > 0 ? bits.join(' · ') : null;
  }
  const text = meta.text;
  if (typeof text === 'string' && text !== '') return text;
  return null;
}

function linkFor(a: ActivityDto): string | null {
  if (a.ref.table === 'calls') return `/calls/${a.ref.id}`;
  if (a.ref.table === 'deals') return `/deals/${a.ref.id}`;
  if (a.ref.table === 'messages' && a.contactId !== null) return null;
  return null;
}

function groupByDay(items: ActivityDto[]): { day: string; items: ActivityDto[] }[] {
  const out: { day: string; items: ActivityDto[] }[] = [];
  for (const item of items) {
    const day = new Date(item.occurredAt).toDateString();
    const last = out[out.length - 1];
    if (last?.day === day) last.items.push(item);
    else out.push({ day: labelFor(item.occurredAt), items: [item] });
  }
  return out;
}

function labelFor(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (same(d, now)) return 'Today';
  const y = new Date(now);
  y.setDate(y.getDate() - 1);
  if (same(d, y)) return 'Yesterday';
  return d.toLocaleDateString('en-KE', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric',
  });
}

export const ACTIVITY_TYPES = valuesOf(ActivityType);
