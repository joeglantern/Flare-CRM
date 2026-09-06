/**
 * Tasks (Tasks · List and Calendar). One screen, two views, the choice in the query string.
 *
 * Completion is optimistic because POST /tasks/:id/complete is idempotent.
 * GAP-03: there is no POST /tasks/bulk, so bulk complete and bulk reassign loop one PATCH per row
 * through useBulkTaskAction, which reports how many failed instead of pretending they all worked.
 * There is no `due=today` shorthand on the server either, so the quick filters compute an ISO range.
 */
import type { TaskDto } from '@crm/shared';
import { useNavigate } from '@tanstack/react-router';
import { CalendarDays, Check, LayoutList, Plus, UserPlus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Avatar } from '@/components/ui/Avatar';
import { Button, IconButton } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Skeleton } from '@/components/ui/Loading';
import { Dialog } from '@/components/ui/Overlay';
import { Segmented } from '@/components/ui/Toggle';
import { toast } from '@/components/ui/toast';
import { DataTable, type BulkAction, type Column } from '@/components/data/DataTable';
import { DateTime } from '@/components/data/formatters';
import { DueLabel, TaskPriorityFlag } from '@/components/data/status';
import { EmptyState, ErrorState, ForbiddenState } from '@/components/data/states';
import { OwnerPicker } from '@/components/entity/pickers';
import { FilterBar, FilterChip } from '@/components/filters/FilterBar';
import { PageHeader } from '@/app/shell/TopBar';
import { usePageMeta } from '@/app/shell/page-meta';
import { errorMessage } from '@/lib/api/errors';
import { useSettings } from '@/providers/settings';
import { linkTo } from '@/lib/links';
import { useListState, useSearchParam } from '@/lib/list-state';
import { cn } from '@/lib/utils';
import { errorInfo, viewStateOf } from '@/lib/view-state';
import { useAssignableUsers } from '@/features/users/api';
import { usePermissions } from '@/providers/permissions';
import { useSocketState } from '@/providers/socket';
import {
  useBulkTaskAction,
  useCompleteTask,
  useDeleteTask,
  useTaskCalendar,
  useTasks,
  useUpdateTask,
  type TaskFilters,
} from './api';
import { TaskFormDialog } from './TaskForm';

const TYPE_LABEL: Record<string, string> = {
  call: 'Call',
  meeting: 'Meeting',
  follow_up: 'Follow up',
  email: 'Email',
  other: 'Other',
};

export function TasksScreen() {
  usePageMeta([{ label: 'Tasks' }]);
  const [view, setView] = useSearchParam('view');
  const calendar = view === 'calendar';
  const perms = usePermissions();
  const [createParam, setCreateParam] = useSearchParam('create');

  return (
    <div className="flex flex-col gap-4 p-6">
      <PageHeader
        title="Tasks"
        description="What you promised to do next."
        actions={
          <>
            <Segmented
              value={calendar ? 'calendar' : 'list'}
              onChange={(v) => {
                setView(v === 'list' ? undefined : v);
              }}
              ariaLabel="Task view"
              options={[
                {
                  value: 'list',
                  label: (
                    <span className="flex items-center gap-1.5">
                      <LayoutList size={13} aria-hidden />
                      List
                    </span>
                  ),
                },
                {
                  value: 'calendar',
                  label: (
                    <span className="flex items-center gap-1.5">
                      <CalendarDays size={13} aria-hidden />
                      Calendar
                    </span>
                  ),
                },
              ]}
            />
            {perms.has('task:create') && (
              <Button
                variant="primary"
                icon={Plus}
                onClick={() => {
                  setCreateParam('true');
                }}
              >
                New task
              </Button>
            )}
          </>
        }
      />

      {calendar ? <TaskCalendar /> : <TaskList />}

      <TaskFormDialog
        open={createParam !== undefined}
        onOpenChange={(v) => {
          setCreateParam(v ? 'true' : undefined);
        }}
      />
    </div>
  );
}

/* ── list ───────────────────────────────────────────────────────────────────────────────── */

/** Start and end of the local day, as ISO, because the server only takes an explicit range. */
function dayRange(offsetDays: number, spanDays: number): { from: string; to: string } {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() + offsetDays);
  const end = new Date(start);
  end.setDate(end.getDate() + spanDays);
  return { from: start.toISOString(), to: end.toISOString() };
}

function TaskList() {
  const perms = usePermissions();
  const navigate = useNavigate();
  const { online } = useSocketState();
  const list = useListState<TaskFilters>();
  const users = useAssignableUsers();
  const complete = useCompleteTask();
  const update = useUpdateTask();
  const remove = useDeleteTask();
  const bulk = useBulkTaskAction();
  const [selection, setSelection] = useState<string[]>([]);
  const [editing, setEditing] = useState<TaskDto | null>(null);
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignTo, setAssignTo] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<TaskDto | null>(null);
  const [quick, setQuick] = useSearchParam('quick');

  const quickFilters = useMemo<TaskFilters>(() => {
    if (quick === 'overdue') return { overdue: 'true', status: 'open' };
    if (quick === 'today') return { ...dayRange(0, 1), status: 'open' };
    if (quick === 'week') return { ...dayRange(0, 7), status: 'open' };
    if (quick === 'mine') return { mine: 'true', status: 'open' };
    return {};
  }, [quick]);

  const canRead = perms.has('task:read');
  const query = useTasks({ ...list.queryParams, ...quickFilters }, canRead);
  const rows = query.data?.data ?? [];

  const state = viewStateOf({
    allowed: canRead,
    online,
    isPending: query.isPending,
    isError: query.isError,
    error: query.error,
    count: rows.length,
  });

  const columns: Column<TaskDto>[] = [
    {
      key: 'done',
      header: '',
      width: '32px',
      label: 'Complete',
      render: (t) => (
        <IconButton
          icon={Check}
          size={26}
          variant={t.status === 'done' ? 'secondary' : 'ghost'}
          label={t.status === 'done' ? `${t.title} is done` : `Mark ${t.title} done`}
          disabled={t.status === 'done' || !perms.can('task:update', { ownerId: t.assigneeId })}
          onClick={(e) => {
            e.stopPropagation();
            complete.mutate({ id: t.id });
          }}
        />
      ),
    },
    {
      key: 'title',
      header: 'Task',
      width: '2fr',
      sortable: true,
      render: (t) => (
        <span className="flex min-w-0 items-center gap-2">
          <TaskPriorityFlag priority={t.priority} />
          <span
            className={cn('truncate font-medium', t.status === 'done' && 'text-muted line-through')}
          >
            {t.title}
          </span>
        </span>
      ),
    },
    {
      key: 'type',
      header: 'Type',
      width: '0.8fr',
      hideable: true,
      render: (t) => <span className="text-muted">{TYPE_LABEL[t.type] ?? t.type}</span>,
    },
    {
      key: 'related',
      header: 'Related to',
      width: '1.3fr',
      hideable: true,
      render: (t) => {
        if (t.contact !== null)
          return <span className="truncate text-muted">{t.contact.displayName}</span>;
        if (t.deal !== null) return <span className="truncate text-muted">{t.deal.title}</span>;
        if (t.company !== null)
          return <span className="truncate text-muted">{t.company.name}</span>;
        return <span className="text-faint">—</span>;
      },
    },
    {
      key: 'dueAt',
      header: 'Due',
      width: '1.1fr',
      sortable: true,
      render: (t) => <DueLabel dueAt={t.dueAt} status={t.status} />,
    },
    {
      key: 'assignee',
      header: 'Assignee',
      width: '1fr',
      hideable: true,
      render: (t) =>
        t.assignee === null ? (
          <span className="text-faint">Unassigned</span>
        ) : (
          <span className="flex min-w-0 items-center gap-1.5 text-muted">
            <Avatar name={t.assignee.name} seed={t.assignee.id} size={18} />
            <span className="truncate">{t.assignee.name}</span>
          </span>
        ),
    },
    {
      key: 'status',
      header: 'Status',
      width: '0.8fr',
      hideable: true,
      optional: true,
      render: (t) => <span className="text-muted capitalize">{t.status.replace('_', ' ')}</span>,
    },
    {
      key: 'createdAt',
      header: 'Created',
      width: '0.9fr',
      align: 'end',
      sortable: true,
      hideable: true,
      optional: true,
      render: (t) => (
        <span className="text-muted">
          <DateTime value={t.createdAt} />
        </span>
      ),
    },
  ];

  const bulkActions: BulkAction[] = perms.has('task:update')
    ? [
        {
          id: 'complete',
          label: 'Mark done',
          icon: Check,
          onRun: (ids) => {
            bulk.mutate(
              {
                ids,
                label: 'Marking done',
                apply: (id) => complete.mutateAsync({ id }),
              },
              {
                onSuccess: () => {
                  setSelection([]);
                },
              },
            );
          },
        },
        ...(perms.has('task:assign')
          ? [
              {
                id: 'assign',
                label: 'Reassign',
                icon: UserPlus,
                onRun: () => {
                  setAssignOpen(true);
                },
              },
            ]
          : []),
      ]
    : [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Segmented
          value={quick ?? 'all'}
          onChange={(v) => {
            setQuick(v === 'all' ? undefined : v);
          }}
          ariaLabel="Quick filters"
          options={[
            { value: 'all', label: 'All' },
            { value: 'mine', label: 'Mine' },
            { value: 'today', label: 'Today' },
            { value: 'week', label: 'This week' },
            { value: 'overdue', label: 'Overdue' },
          ]}
        />
      </div>

      <FilterBar
        search={list.filters.q ?? ''}
        onSearchChange={(v) => {
          list.set({ q: v === '' ? undefined : v });
        }}
        searchPlaceholder="Task title"
        activeCount={list.activeCount}
        onClear={list.reset}
        savedViewsKey="tasks"
      >
        <FilterChip
          label="Status"
          value={list.filters.status}
          onChange={(v) => {
            list.set({ status: v });
          }}
          options={[
            { value: 'open', label: 'Open' },
            { value: 'in_progress', label: 'In progress' },
            { value: 'done', label: 'Done' },
            { value: 'cancelled', label: 'Cancelled' },
          ]}
        />
        <FilterChip
          label="Type"
          value={list.filters.type}
          onChange={(v) => {
            list.set({ type: v });
          }}
          options={Object.entries(TYPE_LABEL).map(([value, label]) => ({ value, label }))}
        />
        <FilterChip
          label="Priority"
          value={list.filters.priority}
          onChange={(v) => {
            list.set({ priority: v });
          }}
          options={[
            { value: 'high', label: 'High' },
            { value: 'normal', label: 'Normal' },
            { value: 'low', label: 'Low' },
          ]}
        />
        <FilterChip
          label="Assignee"
          value={list.filters.assigneeId}
          onChange={(v) => {
            list.set({ assigneeId: v });
          }}
          options={[
            { value: perms.userId, label: 'Me' },
            ...(users.data ?? [])
              .filter((u) => u.id !== perms.userId)
              .map((u) => ({ value: u.id, label: u.name })),
          ]}
        />
      </FilterBar>

      <DataTable
        tableId="tasks"
        ariaLabel="Tasks"
        columns={columns}
        rows={rows}
        rowKey={(t) => t.id}
        state={state}
        sort={list.sort}
        onSortChange={list.setSort}
        selection={bulkActions.length > 0 ? selection : undefined}
        onSelectionChange={bulkActions.length > 0 ? setSelection : undefined}
        bulkActions={bulkActions}
        pagination={{
          kind: 'offset',
          page: list.page,
          pageSize: list.pageSize,
          total: query.data?.page.total ?? 0,
        }}
        onPageChange={list.setPage}
        onPageSizeChange={list.setPageSize}
        onRowClick={(t) => {
          setEditing(t);
        }}
        rowActions={(t) => [
          {
            id: 'open',
            label: 'Open the related record',
            disabled: t.contactId === null && t.dealId === null && t.companyId === null,
            onSelect: () => {
              if (t.contactId !== null) void navigate(linkTo.contact(t.contactId));
              else if (t.dealId !== null) void navigate(linkTo.deal(t.dealId));
              else if (t.companyId !== null) void navigate(linkTo.company(t.companyId));
            },
          },
          ...(perms.can('task:delete', { ownerId: t.assigneeId })
            ? [
                {
                  id: 'delete',
                  label: 'Delete task',
                  danger: true,
                  onSelect: () => {
                    setDeleting(t);
                  },
                },
              ]
            : []),
        ]}
        onRetry={() => {
          void query.refetch();
        }}
        error={errorInfo(query.error)}
        forbidden={{ permission: 'task:read', what: 'Tasks' }}
        emptyState={
          quick === 'overdue'
            ? {
                object: 'checkmark',
                title: 'Nothing overdue',
                description: 'Everything with a due date is still ahead of you.',
              }
            : list.activeCount > 0 || quick !== undefined
              ? {
                  object: 'magnifier',
                  title: 'No tasks match these filters',
                  primaryAction: {
                    label: 'Clear filters',
                    onClick: () => {
                      list.reset();
                      setQuick(undefined);
                    },
                  },
                }
              : {
                  object: 'checkmark',
                  title: 'No tasks yet',
                  description: 'Give yourself the next step after a call so nothing goes quiet.',
                  ...(perms.has('task:create')
                    ? { primaryAction: { label: 'New task', href: '/tasks?create=true' } }
                    : {}),
                }
        }
        endpoint="GET /tasks · offset paginated. Bulk actions loop one PATCH per row (GAP-03)"
      />

      {editing !== null && (
        <TaskFormDialog
          open
          onOpenChange={(v) => {
            if (!v) setEditing(null);
          }}
          task={editing}
        />
      )}

      <Dialog
        open={assignOpen}
        onOpenChange={setAssignOpen}
        title={`Reassign ${String(selection.length)} tasks`}
        description="GAP-03: one PATCH per task, not a bulk endpoint."
        width={420}
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setAssignOpen(false);
              }}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={bulk.isPending}
              onClick={() => {
                bulk.mutate(
                  {
                    ids: selection,
                    label: 'Reassigning',
                    apply: (id) => update.mutateAsync({ id, body: { assigneeId: assignTo } }),
                  },
                  {
                    onSuccess: () => {
                      setSelection([]);
                      setAssignOpen(false);
                    },
                  },
                );
              }}
            >
              Reassign
            </Button>
          </>
        }
      >
        <OwnerPicker value={assignTo} onChange={setAssignTo} label="New assignee" />
      </Dialog>

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(v) => {
          if (!v) setDeleting(null);
        }}
        title={deleting === null ? 'Delete task?' : `Delete ${deleting.title}?`}
        description="The task is removed from the list and the calendar."
        confirmLabel="Delete task"
        loading={remove.isPending}
        onConfirm={() => {
          if (deleting === null) return;
          remove.mutate(deleting.id, {
            onSuccess: () => {
              toast({ tone: 'success', title: 'Task deleted' });
              setDeleting(null);
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

/* ── calendar ───────────────────────────────────────────────────────────────────────────── */

function startOfMonthGrid(month: Date): Date {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const weekday = (first.getDay() + 6) % 7; // Monday first
  first.setDate(first.getDate() - weekday);
  first.setHours(0, 0, 0, 0);
  return first;
}

function TaskCalendar() {
  const perms = usePermissions();
  const settings = useSettings();
  const users = useAssignableUsers();
  const [monthOffset, setMonthOffset] = useState(0);
  const [assigneeId, setAssigneeId] = useSearchParam('assignee');
  const [editing, setEditing] = useState<TaskDto | null>(null);

  const month = useMemo(() => {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() + monthOffset);
    return d;
  }, [monthOffset]);

  const gridStart = useMemo(() => startOfMonthGrid(month), [month]);
  const gridEnd = useMemo(() => {
    const d = new Date(gridStart);
    d.setDate(d.getDate() + 42);
    return d;
  }, [gridStart]);

  const query = useTaskCalendar(
    {
      from: gridStart.toISOString(),
      to: gridEnd.toISOString(),
      ...(assigneeId !== undefined ? { assigneeId } : {}),
    },
    perms.has('task:read'),
  );

  const byDay = useMemo(() => {
    const map = new Map<string, TaskDto[]>();
    for (const t of query.data ?? []) {
      if (t.dueAt === null) continue;
      const key = new Date(t.dueAt).toDateString();
      const list = map.get(key) ?? [];
      list.push(t);
      map.set(key, list);
    }
    return map;
  }, [query.data]);

  if (!perms.has('task:read')) return <ForbiddenState permission="task:read" what="Tasks" />;
  if (query.isError) {
    return (
      <ErrorState
        message={errorMessage(query.error)}
        requestId={errorInfo(query.error).requestId}
        onRetry={() => {
          void query.refetch();
        }}
      />
    );
  }

  const days = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(gridStart);
    d.setDate(d.getDate() + i);
    return d;
  });
  const today = new Date().toDateString();
  const monthLabel = new Intl.DateTimeFormat('en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: settings.timezone,
  }).format(month);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            setMonthOffset((m) => m - 1);
          }}
        >
          Previous
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            setMonthOffset(0);
          }}
        >
          Today
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            setMonthOffset((m) => m + 1);
          }}
        >
          Next
        </Button>
        <h2 className="ml-1 text-base font-medium">{monthLabel}</h2>
        <FilterChip
          label="Assignee"
          value={assigneeId}
          onChange={(v) => {
            setAssigneeId(v);
          }}
          options={[
            { value: perms.userId, label: 'Me' },
            ...(users.data ?? [])
              .filter((u) => u.id !== perms.userId)
              .map((u) => ({ value: u.id, label: u.name })),
          ]}
        />
        <span className="mono ml-auto text-xs text-faint">GET /tasks/calendar · 42 day window</span>
      </div>

      {query.isPending ? (
        <Skeleton height={520} shape="block" />
      ) : query.data.length === 0 ? (
        <EmptyState
          object="calendar"
          title="Nothing due this month"
          description="Tasks show here on their due date. Tasks with no due date stay on the list view."
          {...(perms.has('task:create')
            ? { primaryAction: { label: 'New task', href: '/tasks?create=true' } }
            : {})}
        />
      ) : (
        <div className="overflow-x-auto">
          <div className="min-w-160">
            <div className="grid grid-cols-7 gap-px">
              {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
                <div key={d} className="px-2 py-1.5 text-sm font-medium text-muted">
                  {d}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-px rounded-md border border-border bg-border">
              {days.map((d) => {
                const list = byDay.get(d.toDateString()) ?? [];
                const otherMonth = d.getMonth() !== month.getMonth();
                return (
                  <div
                    key={d.toISOString()}
                    className={cn(
                      'flex min-h-24 flex-col gap-1 bg-bg p-1.5',
                      otherMonth && 'bg-surface text-faint',
                      d.toDateString() === today && 'ring-1 ring-flare ring-inset',
                    )}
                  >
                    <span
                      className={cn(
                        'mono text-xs',
                        d.toDateString() === today && 'font-medium text-flare',
                      )}
                    >
                      {d.getDate()}
                    </span>
                    {list.slice(0, 3).map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => {
                          setEditing(t);
                        }}
                        className={cn(
                          'truncate rounded-xs border-l-2 bg-surface px-1.5 py-0.5 text-left text-sm hover:bg-surface-hover',
                          t.status === 'done' && 'text-muted line-through',
                          t.priority === 'high' ? 'border-l-danger' : 'border-l-flare',
                        )}
                      >
                        {t.title}
                      </button>
                    ))}
                    {list.length > 3 && (
                      <span className="px-1.5 text-xs text-faint">{list.length - 3} more</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {editing !== null && (
        <TaskFormDialog
          open
          onOpenChange={(v) => {
            if (!v) setEditing(null);
          }}
          task={editing}
        />
      )}
    </div>
  );
}
