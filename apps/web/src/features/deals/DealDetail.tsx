/**
 * Deal detail (Deals · Detail): the stage stepper, the value and forecast panel, related
 * contact and company, timeline, tasks, notes and the stage history.
 *
 * The stepper is optimistic. POST /deals/:id/stage is idempotent and carries expectedUpdatedAt, so
 * a concurrent move comes back 409 and the stepper snaps to the server's stage.
 */
import { Link, useNavigate } from '@tanstack/react-router';
import { Building2, Check, Pencil, Plus, SquareCheck, Trash2, UserRound, X } from 'lucide-react';
import { useState } from 'react';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Skeleton } from '@/components/ui/Loading';
import { Tabs } from '@/components/ui/Menu';
import { toast } from '@/components/ui/toast';
import { DateTime, Money } from '@/components/data/formatters';
import { DealStatusBadge, DueLabel, TaskPriorityFlag } from '@/components/data/status';
import { EmptyState, ErrorState, ForbiddenState, NotFoundState } from '@/components/data/states';
import { ProgressBar } from '@/components/data/charts';
import { CustomFieldsPanel } from '@/components/entity/CustomFields';
import { DetailList, EntityHeader, Panel } from '@/components/entity/EntityHeader';
import { NotesPanel } from '@/components/entity/Notes';
import { Timeline, typesForFilter } from '@/components/entity/Timeline';
import { usePageMeta } from '@/app/shell/page-meta';
import { useTimeline } from '@/features/activity/api';
import { useCustomFields } from '@/features/settings/api';
import { useTasks } from '@/features/tasks/api';
import { TaskFormDialog } from '@/features/tasks/TaskForm';
import { errorMessage, isApiError } from '@/lib/api/errors';
import { useDebounced } from '@/lib/hooks';
import { linkTo } from '@/lib/links';
import { useSearchParam } from '@/lib/list-state';
import { cn } from '@/lib/utils';
import { useWatchEntity } from '@/lib/socket/client';
import { usePermissions } from '@/providers/permissions';
import { useChangeStage, useDeal, useDealHistory, useDealMutations, usePipelines } from './api';
import { DealFormDrawer } from './DealForm';
import { LostReasonDialog } from './LostReasonDialog';

export function DealDetailScreen({ dealId }: { dealId: string }) {
  const perms = usePermissions();
  const navigate = useNavigate();
  const query = useDeal(dealId);
  const deal = query.data;
  const pipelines = usePipelines();
  const changeStage = useChangeStage();
  const { remove } = useDealMutations();
  const [tab, setTab] = useSearchParam('tab');
  const [editing, setEditing] = useState(false);
  const [taskOpen, setTaskOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [lostFor, setLostFor] = useState<string | null>(null);

  useWatchEntity('deal', dealId);
  usePageMeta([{ label: 'Deals', href: '/deals' }, { label: deal?.title ?? 'Deal' }]);

  if (query.isError) {
    if (isApiError(query.error) && query.error.status === 404) {
      return <NotFoundState what="deal" backTo={{ label: 'All deals', href: '/deals' }} />;
    }
    if (isApiError(query.error) && query.error.isForbidden) {
      return (
        <ForbiddenState
          permission="deal:read"
          what="this deal"
          backTo={{ label: 'All deals', href: '/deals' }}
        />
      );
    }
    return (
      <div className="p-6">
        <ErrorState
          message={errorMessage(query.error)}
          requestId={isApiError(query.error) ? query.error.requestId : null}
          onRetry={() => {
            void query.refetch();
          }}
        />
      </div>
    );
  }

  if (query.isPending || deal === undefined) {
    return (
      <div className="flex flex-col gap-4 p-6">
        <Skeleton height={56} shape="block" />
        <Skeleton height={44} shape="block" />
        <Skeleton height={220} shape="block" />
      </div>
    );
  }

  const pipeline = (pipelines.data ?? []).find((p) => p.id === deal.pipelineId) ?? null;
  const stages = (pipeline?.stages ?? []).filter((s) => s.isActive || s.id === deal.stageId);
  const canEdit = perms.can('deal:update', { ownerId: deal.ownerId });
  const canMove = perms.can('deal:change_stage', { ownerId: deal.ownerId });
  const canDelete = perms.can('deal:delete', { ownerId: deal.ownerId });
  const active = tab ?? 'timeline';
  const closed = deal.status !== 'open';

  const moveTo = (stageId: string, lostReason?: string) => {
    if (stageId === deal.stageId) return;
    const target = stages.find((s) => s.id === stageId);
    if (target?.type === 'lost' && lostReason === undefined) {
      setLostFor(stageId);
      return;
    }
    changeStage.mutate({
      id: deal.id,
      stageId,
      expectedUpdatedAt: deal.updatedAt,
      ...(lostReason !== undefined && lostReason !== '' ? { lostReason } : {}),
    });
  };

  return (
    <div className="flex flex-col gap-4 p-6">
      <EntityHeader
        title={deal.title}
        avatarSeed={deal.id}
        monogramIcon={<Building2 size={18} aria-hidden />}
        subtitle={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted">
            {deal.company !== null && (
              <Link
                {...linkTo.company(deal.company.id)}
                className="underline-offset-2 hover:text-fg hover:underline"
              >
                {deal.company.name}
              </Link>
            )}
            {deal.contact !== null && (
              <Link
                {...linkTo.contact(deal.contact.id)}
                className="underline-offset-2 hover:text-fg hover:underline"
              >
                {deal.contact.displayName}
              </Link>
            )}
            {pipeline !== null && <span>{pipeline.name}</span>}
          </span>
        }
        badges={
          <>
            <DealStatusBadge status={deal.status} />
            {deal.status === 'lost' && deal.lostReason !== null && (
              <Badge tone="neutral" title={deal.lostReason}>
                {deal.lostReason.length > 40 ? `${deal.lostReason.slice(0, 40)}…` : deal.lostReason}
              </Badge>
            )}
          </>
        }
        actions={[
          ...(perms.has('task:create')
            ? [
                {
                  id: 'task',
                  label: 'New task',
                  icon: SquareCheck,
                  variant: 'secondary' as const,
                  onClick: () => {
                    setTaskOpen(true);
                  },
                },
              ]
            : []),
          ...(canEdit
            ? [
                {
                  id: 'edit',
                  label: 'Edit',
                  icon: Pencil,
                  variant: 'primary' as const,
                  onClick: () => {
                    setEditing(true);
                  },
                },
              ]
            : []),
        ]}
        overflowActions={
          canDelete
            ? [
                {
                  id: 'delete',
                  label: 'Delete deal',
                  icon: Trash2,
                  danger: true,
                  onSelect: () => {
                    setConfirmDelete(true);
                  },
                },
              ]
            : []
        }
      />

      <StageStepper
        stages={stages}
        currentId={deal.stageId}
        disabled={!canMove || changeStage.isPending}
        onSelect={moveTo}
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-3">
          <Tabs
            tabs={[
              { id: 'timeline', label: 'Timeline' },
              { id: 'tasks', label: 'Tasks' },
              { id: 'notes', label: 'Notes' },
              { id: 'history', label: 'Stage history' },
            ]}
            value={active}
            onChange={(id) => {
              setTab(id === 'timeline' ? undefined : id);
            }}
            ariaLabel="Deal sections"
          />

          {active === 'timeline' && <DealTimelineTab dealId={deal.id} />}
          {active === 'tasks' && (
            <DealTasksTab
              dealId={deal.id}
              onNew={() => {
                setTaskOpen(true);
              }}
            />
          )}
          {active === 'notes' && (
            <NotesPanel parent="deal" id={deal.id} canCreate={perms.has('note:create')} />
          )}
          {active === 'history' && <StageHistoryTab dealId={deal.id} />}
        </div>

        <aside className="flex min-w-0 flex-col gap-3">
          <Panel title="Value">
            <div className="flex flex-col gap-3">
              <div className="flex items-baseline gap-2">
                <Money
                  amount={deal.value}
                  currency={deal.currency}
                  emphasis="strong"
                  className="text-xl"
                />
                <span className="text-sm text-muted">{deal.currency}</span>
              </div>
              <ProgressBar
                value={deal.probability}
                max={100}
                label={`${String(deal.probability)}% likely`}
                tone={
                  closed
                    ? deal.status === 'won'
                      ? 'var(--success)'
                      : 'var(--danger)'
                    : 'var(--flare)'
                }
              />
              <DetailList
                items={[
                  {
                    label: 'Weighted',
                    value: <Money amount={deal.weightedValue} currency={deal.currency} />,
                  },
                  {
                    label: 'Expected close',
                    value: <DateTime value={deal.expectedCloseDate} showTime={false} />,
                  },
                  ...(deal.wonAt !== null
                    ? [{ label: 'Won', value: <DateTime value={deal.wonAt} /> }]
                    : []),
                  ...(deal.lostAt !== null
                    ? [{ label: 'Lost', value: <DateTime value={deal.lostAt} /> }]
                    : []),
                  ...(deal.lostReason !== null
                    ? [
                        {
                          label: 'Lost reason',
                          value: <span className="text-muted">{deal.lostReason}</span>,
                        },
                      ]
                    : []),
                ]}
              />
            </div>
          </Panel>

          <Panel title="Related">
            <DetailList
              items={[
                {
                  label: 'Contact',
                  value:
                    deal.contact === null ? (
                      <span className="text-faint">None</span>
                    ) : (
                      <Link
                        {...linkTo.contact(deal.contact.id)}
                        className="flex items-center gap-1.5 underline-offset-2 hover:underline"
                      >
                        <UserRound size={12} aria-hidden />
                        {deal.contact.displayName}
                      </Link>
                    ),
                },
                {
                  label: 'Company',
                  value:
                    deal.company === null ? (
                      <span className="text-faint">None</span>
                    ) : (
                      <Link
                        {...linkTo.company(deal.company.id)}
                        className="flex items-center gap-1.5 underline-offset-2 hover:underline"
                      >
                        <Building2 size={12} aria-hidden />
                        {deal.company.name}
                      </Link>
                    ),
                },
                {
                  label: 'Owner',
                  value:
                    deal.owner === null ? (
                      <span className="text-faint">Unassigned</span>
                    ) : (
                      <span className="flex items-center gap-1.5">
                        <Avatar name={deal.owner.name} seed={deal.owner.id} size={18} />
                        {deal.owner.name}
                      </span>
                    ),
                },
                { label: 'Stage', value: deal.stage.name },
                { label: 'Created', value: <DateTime value={deal.createdAt} /> },
                { label: 'Updated', value: <DateTime value={deal.updatedAt} /> },
              ]}
            />
          </Panel>

          <DealCustomFields values={deal.customFields} />
        </aside>
      </div>

      <DealFormDrawer open={editing} onOpenChange={setEditing} deal={deal} />

      <TaskFormDialog
        open={taskOpen}
        onOpenChange={setTaskOpen}
        defaults={{
          dealId: deal.id,
          ...(deal.contactId !== null ? { contactId: deal.contactId } : {}),
        }}
      />

      <LostReasonDialog
        open={lostFor !== null}
        onOpenChange={(v) => {
          if (!v) setLostFor(null);
        }}
        loading={changeStage.isPending}
        onConfirm={(reason) => {
          if (lostFor !== null) moveTo(lostFor, reason);
          setLostFor(null);
        }}
      />

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete ${deal.title}?`}
        description="The deal is soft deleted and leaves the board and the reports."
        confirmLabel="Delete deal"
        consequences={['Stage history is kept', 'Won and lost totals in reports will change']}
        loading={remove.isPending}
        onConfirm={() => {
          remove.mutate(deal.id, {
            onSuccess: () => {
              toast({ tone: 'success', title: 'Deal deleted', description: deal.title });
              void navigate({ to: '/deals' });
            },
            onError: (e) => {
              toast({ tone: 'danger', title: 'Could not delete', description: errorMessage(e) });
            },
          });
        }}
      />
    </div>
  );
}

function StageStepper({
  stages,
  currentId,
  disabled,
  onSelect,
}: {
  stages: { id: string; name: string; type: string; probability: number }[];
  currentId: string;
  disabled: boolean;
  onSelect: (id: string) => void;
}) {
  const currentIndex = stages.findIndex((s) => s.id === currentId);

  return (
    <nav aria-label="Deal stage" className="scrollbar-none flex gap-1 overflow-x-auto">
      {stages.map((stage, i) => {
        const isCurrent = stage.id === currentId;
        const isPast = i < currentIndex;
        const won = stage.type === 'won';
        const lost = stage.type === 'lost';
        return (
          <button
            key={stage.id}
            type="button"
            disabled={disabled}
            aria-current={isCurrent ? 'step' : undefined}
            onClick={() => {
              onSelect(stage.id);
            }}
            title={`${stage.name} · ${String(stage.probability)}%`}
            className={cn(
              'flex h-9 shrink-0 items-center gap-1.5 border px-3 text-base whitespace-nowrap first:rounded-l-sm last:rounded-r-sm',
              'disabled:cursor-not-allowed disabled:opacity-60',
              isCurrent && won && 'border-success bg-success-subtle font-medium text-success',
              isCurrent && lost && 'border-danger bg-danger-subtle font-medium text-danger',
              isCurrent &&
                !won &&
                !lost &&
                'border-flare bg-flare-subtle font-medium text-flare-on-subtle',
              !isCurrent && isPast && 'border-border bg-surface text-muted',
              !isCurrent &&
                !isPast &&
                'border-border text-faint hover:border-border-strong hover:text-fg',
            )}
          >
            {isPast && <Check size={12} aria-hidden />}
            {isCurrent && lost && <X size={12} aria-hidden />}
            {stage.name}
          </button>
        );
      })}
    </nav>
  );
}

function DealCustomFields({ values }: { values: Record<string, unknown> }) {
  const definitions = useCustomFields('deal');
  if ((definitions.data ?? []).length === 0) return null;
  return <CustomFieldsPanel definitions={definitions.data ?? []} values={values} />;
}

function DealTimelineTab({ dealId }: { dealId: string }) {
  const [filter, setFilter] = useState('all');
  const [q, setQ] = useState('');
  const debounced = useDebounced(q, 250);
  const query = useTimeline('deal', dealId, {
    ...(typesForFilter(filter) !== undefined ? { types: typesForFilter(filter) } : {}),
    ...(debounced.trim() !== '' ? { q: debounced.trim() } : {}),
  });
  const items = query.data?.pages.flatMap((p) => p.data) ?? [];

  return (
    <Timeline
      items={items}
      state={
        query.isPending
          ? 'loading'
          : query.isError
            ? 'error'
            : items.length === 0
              ? 'empty'
              : 'ready'
      }
      filter={filter}
      onFilterChange={setFilter}
      query={q}
      onQueryChange={setQ}
      hasMore={query.hasNextPage}
      loadingMore={query.isFetchingNextPage}
      onLoadMore={() => {
        void query.fetchNextPage();
      }}
      onRetry={() => {
        void query.refetch();
      }}
      emptyTitle="Nothing on this deal yet"
      emptyDescription="Stage moves, calls, tasks and notes all land here."
    />
  );
}

function DealTasksTab({ dealId, onNew }: { dealId: string; onNew: () => void }) {
  const perms = usePermissions();
  const query = useTasks({ dealId, pageSize: 50 }, perms.has('task:read'));
  const rows = query.data?.data ?? [];

  if (!perms.has('task:read'))
    return <ForbiddenState permission="task:read" what="tasks" compact />;
  if (query.isPending) return <Skeleton height={140} shape="block" />;
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
  if (rows.length === 0) {
    return (
      <Panel padded={false}>
        <EmptyState
          compact
          object="checkmark"
          title="No tasks on this deal"
          description="Give yourself the next step so it does not go quiet."
          {...(perms.has('task:create')
            ? { primaryAction: { label: 'New task', onClick: onNew } }
            : {})}
        />
      </Panel>
    );
  }

  return (
    <Panel
      title="Tasks"
      padded={false}
      actions={
        perms.has('task:create') ? (
          <Button variant="ghost" size="sm" icon={Plus} onClick={onNew}>
            New
          </Button>
        ) : undefined
      }
    >
      <ul className="divide-y divide-border">
        {rows.map((t) => (
          <li key={t.id} className="flex items-center gap-3 px-3.5 py-2.5">
            <TaskPriorityFlag priority={t.priority} />
            <span className="min-w-0 flex-1">
              <span
                className={cn('block truncate', t.status === 'done' && 'text-muted line-through')}
              >
                {t.title}
              </span>
              {t.assignee !== null && (
                <span className="block truncate text-sm text-muted">{t.assignee.name}</span>
              )}
            </span>
            <DueLabel dueAt={t.dueAt} status={t.status} />
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function StageHistoryTab({ dealId }: { dealId: string }) {
  const query = useDealHistory(dealId);
  const rows = query.data ?? [];

  if (query.isPending) return <Skeleton height={140} shape="block" />;
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
  if (rows.length === 0) {
    return (
      <Panel padded={false}>
        <EmptyState
          compact
          object="pipeline"
          title="No stage moves yet"
          description="Every move is recorded here with who made it and when."
        />
      </Panel>
    );
  }

  return (
    <Panel title="Stage history" padded={false}>
      <ol className="divide-y divide-border">
        {rows.map((h) => (
          <li key={h.id} className="flex flex-wrap items-center gap-2 px-3.5 py-2.5">
            <span className="min-w-0 flex-1">
              <span className="text-muted">{h.fromStage?.name ?? 'Created'}</span>
              <span className="mx-1.5 text-faint" aria-label="moved to">
                →
              </span>
              <span className="font-medium">{h.toStage.name}</span>
            </span>
            {h.changedBy !== null && (
              <span className="flex items-center gap-1.5 text-sm text-muted">
                <Avatar name={h.changedBy.name} seed={h.changedBy.id} size={18} />
                {h.changedBy.name}
              </span>
            )}
            <span className="text-sm text-faint">
              <DateTime value={h.changedAt} />
            </span>
          </li>
        ))}
      </ol>
    </Panel>
  );
}
