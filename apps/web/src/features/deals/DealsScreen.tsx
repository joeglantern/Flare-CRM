/**
 * Deals (Deals · Board and List). One screen, two views, the choice kept in the query
 * string so a board link and a table link are both shareable.
 *
 * The board moves cards with POST /deals/:id/stage, which is idempotent, so the move is optimistic
 * and rolls back on a 409 from expectedUpdatedAt. Moving into a lost stage asks for a reason first,
 * because the reason is written in the same request and cannot be added afterwards.
 * Drag and drop is keyboard operable: every card has a stage menu that performs the same mutation.
 */
import type { DealDto } from '@crm/shared';
import { useNavigate } from '@tanstack/react-router';
import { Download, Kanban, LayoutList, Plus, Trash2, UserPlus } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { Avatar } from '@/components/ui/Avatar';
import { Button, IconButton } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Skeleton } from '@/components/ui/Loading';
import { DropdownMenu } from '@/components/ui/Menu';
import { Dialog } from '@/components/ui/Overlay';
import { Select } from '@/components/ui/Select';
import { Segmented } from '@/components/ui/Toggle';
import { toast } from '@/components/ui/toast';
import { DataTable, type BulkAction, type Column } from '@/components/data/DataTable';
import { DateTime, Money } from '@/components/data/formatters';
import { DealStatusBadge } from '@/components/data/status';
import { EmptyState, ErrorState, ForbiddenState, OfflineState } from '@/components/data/states';
import { OwnerPicker } from '@/components/entity/pickers';
import { FilterBar, FilterChip } from '@/components/filters/FilterBar';
import { ExportDialog } from '@/components/filters/ExportDialog';
import { PageHeader } from '@/app/shell/TopBar';
import { usePageMeta } from '@/app/shell/page-meta';
import { errorMessage } from '@/lib/api/errors';
import { linkTo } from '@/lib/links';
import { useListState, useSearchParam } from '@/lib/list-state';
import { cn } from '@/lib/utils';
import { errorInfo, viewStateOf } from '@/lib/view-state';
import { useAssignableUsers } from '@/features/users/api';
import { usePermissions } from '@/providers/permissions';
import { useSocketState } from '@/providers/socket';
import {
  useChangeStage,
  useDealBoard,
  useDealMutations,
  useDeals,
  usePipelines,
  type BoardColumn,
  type DealFilters,
} from './api';
import { DealFormDrawer } from './DealForm';
import { LostReasonDialog } from './LostReasonDialog';

export function DealsScreen() {
  usePageMeta([{ label: 'Deals' }]);
  const [view, setView] = useSearchParam('view');
  const board = (view ?? 'board') === 'board';
  const perms = usePermissions();
  const [createParam, setCreateParam] = useSearchParam('create');
  const navigate = useNavigate();

  return (
    <div className="flex flex-col gap-4 p-6">
      <PageHeader
        title="Deals"
        description="Everything in play, by stage."
        actions={
          <>
            <Segmented
              value={board ? 'board' : 'list'}
              onChange={(v) => {
                setView(v === 'board' ? undefined : v);
              }}
              ariaLabel="Deal view"
              options={[
                {
                  value: 'board',
                  label: (
                    <span className="flex items-center gap-1.5">
                      <Kanban size={13} aria-hidden />
                      Board
                    </span>
                  ),
                },
                {
                  value: 'list',
                  label: (
                    <span className="flex items-center gap-1.5">
                      <LayoutList size={13} aria-hidden />
                      List
                    </span>
                  ),
                },
              ]}
            />
            {perms.has('deal:create') && (
              <Button
                variant="primary"
                icon={Plus}
                onClick={() => {
                  setCreateParam('true');
                }}
              >
                New deal
              </Button>
            )}
          </>
        }
      />

      {board ? <DealBoard /> : <DealList />}

      <DealFormDrawer
        open={createParam !== undefined}
        onOpenChange={(v) => {
          setCreateParam(v ? 'true' : undefined);
        }}
        onSaved={(d) => {
          setCreateParam(undefined);
          void navigate(linkTo.deal(d.id));
        }}
      />
    </div>
  );
}

/* ── board ──────────────────────────────────────────────────────────────────────────────── */

function DealBoard() {
  const perms = usePermissions();
  const { online } = useSocketState();
  const navigate = useNavigate();
  const pipelines = usePipelines();
  const users = useAssignableUsers();
  const [pipelineParam, setPipelineParam] = useSearchParam('pipeline');
  const [ownerParam, setOwnerParam] = useSearchParam('owner');

  const params = useMemo(
    () => ({
      ...(pipelineParam !== undefined ? { pipelineId: pipelineParam } : {}),
      ...(ownerParam !== undefined ? { ownerId: ownerParam } : {}),
    }),
    [pipelineParam, ownerParam],
  );

  const query = useDealBoard(params, perms.has('deal:read'));
  const changeStage = useChangeStage();
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [lostPrompt, setLostPrompt] = useState<{ deal: DealDto; stageId: string } | null>(null);

  const columns = query.data?.columns ?? [];
  const canMove = perms.has('deal:change_stage');

  const move = (deal: DealDto, stageId: string, lostReason?: string) => {
    if (stageId === deal.stageId) return;
    const stage = columns.find((c) => c.stage.id === stageId)?.stage;
    if (stage?.type === 'lost' && lostReason === undefined) {
      setLostPrompt({ deal, stageId });
      return;
    }
    changeStage.mutate({
      id: deal.id,
      stageId,
      expectedUpdatedAt: deal.updatedAt,
      ...(lostReason !== undefined && lostReason !== '' ? { lostReason } : {}),
    });
  };

  if (!perms.has('deal:read')) return <ForbiddenState permission="deal:read" what="Deals" />;
  if (!online && query.data === undefined) {
    return (
      <OfflineState
        onRetry={() => {
          void query.refetch();
        }}
      />
    );
  }
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

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={pipelineParam ?? query.data?.pipelineId ?? null}
          onChange={(v) => {
            setPipelineParam(v);
          }}
          options={(pipelines.data ?? []).map((p) => ({
            value: p.id,
            label: p.isDefault ? `${p.name} (default)` : p.name,
          }))}
          ariaLabel="Pipeline"
          size="sm"
          placeholder="Pipeline"
        />
        <Select
          value={ownerParam ?? null}
          onChange={(v) => {
            setOwnerParam(v === '' ? undefined : v);
          }}
          options={[
            { value: '', label: 'Everyone' },
            { value: perms.userId, label: 'Mine' },
            ...(users.data ?? [])
              .filter((u) => u.id !== perms.userId)
              .map((u) => ({ value: u.id, label: u.name })),
          ]}
          ariaLabel="Owner"
          size="sm"
          placeholder="Owner"
        />
        <span className="mono ml-auto text-xs text-faint">GET /deals/board</span>
      </div>

      {query.isPending ? (
        <div className="flex gap-3 overflow-x-auto pb-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} height={360} width="272px" shape="block" />
          ))}
        </div>
      ) : columns.length === 0 ? (
        <EmptyState
          object="kanban"
          title="This pipeline has no stages"
          description="Add stages in settings before you can work the board."
          {...(perms.has('pipeline:manage')
            ? { primaryAction: { label: 'Pipeline settings', href: '/settings?section=pipelines' } }
            : {})}
        />
      ) : columns.every((c) => c.count === 0) ? (
        <EmptyState
          object="kanban"
          title="No deals in this pipeline"
          description="Open a deal from a contact, a company, or straight from a converted lead."
          {...(perms.has('deal:create')
            ? { primaryAction: { label: 'New deal', href: '/deals?create=true' } }
            : {})}
        />
      ) : (
        <div
          className="scrollbar-thin flex gap-3 overflow-x-auto pb-2"
          role="list"
          aria-label="Deal stages"
        >
          {columns.map((col) => (
            <BoardColumnView
              key={col.stage.id}
              column={col}
              allStages={columns.map((c) => c.stage)}
              canMove={canMove}
              isDropTarget={dropTarget === col.stage.id}
              onDragOver={(over) => {
                setDropTarget(over ? col.stage.id : null);
              }}
              onDropCard={(dealId) => {
                setDropTarget(null);
                setDragging(null);
                const deal = columns.flatMap((c) => c.deals).find((d) => d.id === dealId);
                if (deal !== undefined) move(deal, col.stage.id);
              }}
              draggingId={dragging}
              onDragStart={setDragging}
              onOpen={(id) => {
                void navigate(linkTo.deal(id));
              }}
              onMove={move}
            />
          ))}
        </div>
      )}

      <LostReasonDialog
        open={lostPrompt !== null}
        onOpenChange={(v) => {
          if (!v) setLostPrompt(null);
        }}
        loading={changeStage.isPending}
        onConfirm={(reason) => {
          if (lostPrompt === null) return;
          move(lostPrompt.deal, lostPrompt.stageId, reason);
          setLostPrompt(null);
        }}
      />
    </div>
  );
}

function BoardColumnView({
  column,
  allStages,
  canMove,
  isDropTarget,
  draggingId,
  onDragOver,
  onDropCard,
  onDragStart,
  onOpen,
  onMove,
}: {
  column: BoardColumn;
  allStages: BoardColumn['stage'][];
  canMove: boolean;
  isDropTarget: boolean;
  draggingId: string | null;
  onDragOver: (over: boolean) => void;
  onDropCard: (dealId: string) => void;
  onDragStart: (id: string | null) => void;
  onOpen: (id: string) => void;
  onMove: (deal: DealDto, stageId: string) => void;
}) {
  const tone =
    column.stage.type === 'won'
      ? 'border-t-success'
      : column.stage.type === 'lost'
        ? 'border-t-danger'
        : 'border-t-flare';

  return (
    <section
      role="listitem"
      aria-label={`${column.stage.name}, ${String(column.count)} deals`}
      className={cn(
        'flex w-68 shrink-0 flex-col rounded-md border border-t-2 border-border bg-surface',
        tone,
        isDropTarget && 'border-flare bg-flare-subtle',
      )}
      onDragOver={(e) => {
        if (!canMove || draggingId === null) return;
        e.preventDefault();
        onDragOver(true);
      }}
      onDragLeave={() => {
        onDragOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        const id = e.dataTransfer.getData('text/deal-id');
        if (id !== '') onDropCard(id);
      }}
    >
      <header className="flex items-baseline gap-2 border-b border-border px-3 py-2">
        <h3 className="min-w-0 flex-1 truncate text-base font-medium">{column.stage.name}</h3>
        <span className="mono text-xs text-faint">{column.count}</span>
      </header>
      <p className="border-b border-border px-3 py-1.5 text-sm text-muted">
        <Money amount={column.totalValue} compact /> · {column.stage.probability}%
      </p>

      <div className="flex min-h-24 flex-col gap-2 p-2">
        {column.deals.length === 0 ? (
          <p className="px-1 py-6 text-center text-sm text-faint">Nothing here</p>
        ) : (
          column.deals.map((deal) => (
            <DealCard
              key={deal.id}
              deal={deal}
              canMove={canMove}
              stages={allStages}
              dragging={draggingId === deal.id}
              onDragStart={() => {
                onDragStart(deal.id);
              }}
              onDragEnd={() => {
                onDragStart(null);
              }}
              onOpen={() => {
                onOpen(deal.id);
              }}
              onMove={(stageId) => {
                onMove(deal, stageId);
              }}
            />
          ))
        )}
      </div>
    </section>
  );
}

function DealCard({
  deal,
  canMove,
  stages,
  dragging,
  onDragStart,
  onDragEnd,
  onOpen,
  onMove,
}: {
  deal: DealDto;
  canMove: boolean;
  stages: BoardColumn['stage'][];
  dragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onOpen: () => void;
  onMove: (stageId: string) => void;
}) {
  const menuRef = useRef<HTMLButtonElement | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <article
      draggable={canMove}
      onDragStart={(e) => {
        e.dataTransfer.setData('text/deal-id', deal.id);
        e.dataTransfer.effectAllowed = 'move';
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      className={cn(
        'group rounded-sm border border-border bg-bg p-2.5 focus-within:border-border-strong hover:border-border-strong',
        dragging && 'opacity-40',
        canMove && 'cursor-grab active:cursor-grabbing',
      )}
    >
      <div className="flex items-start gap-1.5">
        <button
          type="button"
          onClick={onOpen}
          className="min-w-0 flex-1 truncate text-left text-base font-medium hover:underline"
        >
          {deal.title}
        </button>
        {canMove && (
          <>
            <IconButton
              ref={menuRef}
              icon={Kanban}
              label={`Move ${deal.title} to another stage`}
              size={26}
              variant="ghost"
              onClick={() => {
                setMenuOpen(true);
              }}
            />
            <DropdownMenu
              open={menuOpen}
              onOpenChange={setMenuOpen}
              anchor={menuRef}
              items={stages.map((s) => ({
                id: s.id,
                label: s.name,
                disabled: s.id === deal.stageId,
                onSelect: () => {
                  onMove(s.id);
                },
              }))}
            />
          </>
        )}
      </div>

      {deal.company !== null && <p className="truncate text-sm text-muted">{deal.company.name}</p>}
      {deal.company === null && deal.contact !== null && (
        <p className="truncate text-sm text-muted">{deal.contact.displayName}</p>
      )}

      <div className="mt-2 flex items-center gap-2">
        <Money amount={deal.value} currency={deal.currency} emphasis="strong" />
        <span className="ml-auto flex items-center gap-1.5 text-sm text-faint">
          {deal.expectedCloseDate !== null && (
            <DateTime value={deal.expectedCloseDate} showTime={false} bare />
          )}
          {deal.owner !== null && <Avatar name={deal.owner.name} seed={deal.owner.id} size={18} />}
        </span>
      </div>
    </article>
  );
}

/* ── list ───────────────────────────────────────────────────────────────────────────────── */

function DealList() {
  const perms = usePermissions();
  const { online } = useSocketState();
  const navigate = useNavigate();
  const list = useListState<DealFilters>();
  const pipelines = usePipelines();
  const users = useAssignableUsers();
  const [selection, setSelection] = useState<string[]>([]);
  const [bulkDialog, setBulkDialog] = useState<'assign' | 'delete' | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [ownerId, setOwnerId] = useState<string | null>(null);

  const canRead = perms.has('deal:read');
  const query = useDeals(list.queryParams, canRead);
  const { bulk } = useDealMutations();
  const rows = query.data?.data ?? [];

  const stages = useMemo(() => {
    const p =
      (pipelines.data ?? []).find((x) => x.id === list.filters.pipelineId) ??
      (pipelines.data ?? [])[0];
    return p?.stages ?? [];
  }, [pipelines.data, list.filters.pipelineId]);

  const state = viewStateOf({
    allowed: canRead,
    online,
    isPending: query.isPending,
    isError: query.isError,
    error: query.error,
    count: rows.length,
  });

  const columns: Column<DealDto>[] = [
    {
      key: 'title',
      header: 'Deal',
      width: '1.6fr',
      sortable: true,
      render: (d) => <span className="truncate font-medium">{d.title}</span>,
    },
    {
      key: 'company',
      header: 'Company',
      width: '1.2fr',
      hideable: true,
      render: (d) => (
        <span className="truncate text-muted">
          {d.company?.name ?? d.contact?.displayName ?? <span className="text-faint">—</span>}
        </span>
      ),
    },
    {
      key: 'stage',
      header: 'Stage',
      width: '1fr',
      hideable: true,
      render: (d) => <span className="truncate">{d.stage.name}</span>,
    },
    {
      key: 'value',
      header: 'Value',
      width: '1fr',
      align: 'end',
      sortable: true,
      render: (d) => <Money amount={d.value} currency={d.currency} emphasis="strong" />,
    },
    {
      key: 'weightedValue',
      header: 'Weighted',
      width: '1fr',
      align: 'end',
      hideable: true,
      optional: true,
      render: (d) => <Money amount={d.weightedValue} currency={d.currency} />,
    },
    {
      key: 'probability',
      header: 'Probability',
      width: '0.8fr',
      align: 'end',
      hideable: true,
      optional: true,
      render: (d) => <span className="mono text-muted">{d.probability}%</span>,
    },
    {
      key: 'status',
      header: 'Status',
      width: '0.8fr',
      hideable: true,
      render: (d) => <DealStatusBadge status={d.status} />,
    },
    {
      key: 'expectedCloseDate',
      header: 'Expected close',
      width: '1fr',
      align: 'end',
      sortable: true,
      hideable: true,
      render: (d) => (
        <span className="text-muted">
          <DateTime value={d.expectedCloseDate} showTime={false} />
        </span>
      ),
    },
    {
      key: 'owner',
      header: 'Owner',
      width: '1fr',
      hideable: true,
      render: (d) =>
        d.owner === null ? (
          <span className="text-faint">Unassigned</span>
        ) : (
          <span className="flex min-w-0 items-center gap-1.5 text-muted">
            <Avatar name={d.owner.name} seed={d.owner.id} size={18} />
            <span className="truncate">{d.owner.name}</span>
          </span>
        ),
    },
  ];

  const bulkActions: BulkAction[] = perms.has('deal:assign')
    ? [
        {
          id: 'assign',
          label: 'Assign owner',
          icon: UserPlus,
          onRun: () => {
            setBulkDialog('assign');
          },
        },
        ...(perms.has('deal:delete')
          ? [
              {
                id: 'delete',
                label: 'Delete',
                icon: Trash2,
                danger: true,
                onRun: () => {
                  setBulkDialog('delete');
                },
              },
            ]
          : []),
      ]
    : [];

  return (
    <div className="flex flex-col gap-4">
      <FilterBar
        search={list.filters.q ?? ''}
        onSearchChange={(v) => {
          list.set({ q: v === '' ? undefined : v });
        }}
        searchPlaceholder="Deal title"
        activeCount={list.activeCount}
        onClear={list.reset}
        savedViewsKey="deals"
        right={
          perms.has('deal:export') ? (
            <Button
              variant="secondary"
              size="sm"
              icon={Download}
              onClick={() => {
                setExportOpen(true);
              }}
            >
              Export
            </Button>
          ) : undefined
        }
      >
        <FilterChip
          label="Pipeline"
          value={list.filters.pipelineId}
          onChange={(v) => {
            list.set({ pipelineId: v, stageId: undefined });
          }}
          options={(pipelines.data ?? []).map((p) => ({ value: p.id, label: p.name }))}
        />
        <FilterChip
          label="Stage"
          value={list.filters.stageId}
          onChange={(v) => {
            list.set({ stageId: v });
          }}
          options={stages.map((s) => ({ value: s.id, label: s.name }))}
        />
        <FilterChip
          label="Status"
          value={list.filters.status}
          onChange={(v) => {
            list.set({ status: v });
          }}
          options={[
            { value: 'open', label: 'Open' },
            { value: 'won', label: 'Won' },
            { value: 'lost', label: 'Lost' },
          ]}
        />
        <FilterChip
          label="Owner"
          value={list.filters.ownerId}
          onChange={(v) => {
            list.set({ ownerId: v });
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
        tableId="deals"
        ariaLabel="Deals"
        columns={columns}
        rows={rows}
        rowKey={(d) => d.id}
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
        onRowClick={(d) => {
          void navigate(linkTo.deal(d.id));
        }}
        onRetry={() => {
          void query.refetch();
        }}
        error={errorInfo(query.error)}
        forbidden={{ permission: 'deal:read', what: 'Deals' }}
        emptyState={
          list.activeCount > 0
            ? {
                object: 'magnifier',
                title: 'No deals match these filters',
                description: 'Deal search matches the title only.',
                primaryAction: { label: 'Clear filters', onClick: list.reset },
              }
            : {
                object: 'kanban',
                title: 'No deals yet',
                description: 'Open a deal from a contact, a company or a converted lead.',
                ...(perms.has('deal:create')
                  ? { primaryAction: { label: 'New deal', href: '/deals?create=true' } }
                  : {}),
              }
        }
        endpoint="GET /deals · offset paginated"
      />

      <ExportDialog
        open={exportOpen}
        onOpenChange={setExportOpen}
        entity="deals"
        filters={list.queryParams}
        estimatedCount={query.data?.page.total}
        filterSummary={
          Object.entries(list.filters)
            .filter(([, v]) => v !== undefined && v !== '')
            .map(([k, v]) => `${k}=${String(v)}`)
            .join(', ') || 'None'
        }
      />

      <Dialog
        open={bulkDialog === 'assign'}
        onOpenChange={() => {
          setBulkDialog(null);
        }}
        title={`Assign ${String(selection.length)} deals`}
        width={420}
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setBulkDialog(null);
              }}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={bulk.isPending}
              onClick={() => {
                bulk.mutate(
                  { action: 'assign', ids: selection, ownerId },
                  {
                    onSuccess: (r) => {
                      toast({ tone: 'success', title: `${String(r.updated)} deals updated` });
                      setSelection([]);
                      setBulkDialog(null);
                    },
                    onError: (e) => {
                      toast({
                        tone: 'danger',
                        title: 'Bulk action failed',
                        description: errorMessage(e),
                      });
                    },
                  },
                );
              }}
            >
              Assign
            </Button>
          </>
        }
      >
        <OwnerPicker value={ownerId} onChange={setOwnerId} label="New owner" />
      </Dialog>

      <ConfirmDialog
        open={bulkDialog === 'delete'}
        onOpenChange={() => {
          setBulkDialog(null);
        }}
        title={`Delete ${String(selection.length)} deals?`}
        description="They are soft deleted and leave the board and the reports."
        confirmLabel={`Delete ${String(selection.length)}`}
        consequences={['Stage history is kept', 'Won and lost totals in reports will change']}
        loading={bulk.isPending}
        onConfirm={() => {
          bulk.mutate(
            { action: 'delete', ids: selection },
            {
              onSuccess: (r) => {
                toast({ tone: 'success', title: `${String(r.updated)} deals deleted` });
                setSelection([]);
                setBulkDialog(null);
              },
              onError: (e) => {
                toast({
                  tone: 'danger',
                  title: 'Bulk action failed',
                  description: errorMessage(e),
                });
              },
            },
          );
        }}
      />
    </div>
  );
}
