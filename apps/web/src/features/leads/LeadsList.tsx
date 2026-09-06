/**
 * Leads list (Leads · List). Offset paginated with status and source filters, bulk assign,
 * bulk status change and bulk delete, plus the convert action on the row overflow.
 *
 * Converted leads stay in the list. They are shown with the converted badge and a link through to
 * the contact, because the server keeps the row for the audit trail rather than deleting it.
 */
import type { LeadDto } from '@crm/shared';
import { useNavigate } from '@tanstack/react-router';
import { ArrowRight, Plus, Trash2, Upload, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Dialog } from '@/components/ui/Overlay';
import { Select } from '@/components/ui/Select';
import { toast } from '@/components/ui/toast';
import { DataTable, type BulkAction, type Column } from '@/components/data/DataTable';
import { DateTime } from '@/components/data/formatters';
import { PhoneNumber } from '@/components/data/PhoneNumber';
import { LeadStatusBadge } from '@/components/data/status';
import { FilterBar, FilterChip } from '@/components/filters/FilterBar';
import { OwnerPicker } from '@/components/entity/pickers';
import { PageHeader } from '@/app/shell/TopBar';
import { usePageMeta } from '@/app/shell/page-meta';
import { errorMessage } from '@/lib/api/errors';
import { linkTo } from '@/lib/links';
import { useListState, useSearchParam } from '@/lib/list-state';
import { errorInfo, viewStateOf } from '@/lib/view-state';
import { useAssignableUsers } from '@/features/users/api';
import { usePermissions } from '@/providers/permissions';
import { useSocketState } from '@/providers/socket';
import { useLeadMutations, useLeads, type LeadFilters } from './api';
import { LeadFormDrawer } from './LeadForm';

const SOURCE_LABEL: Record<string, string> = {
  manual: 'Manual',
  webform: 'Web form',
  import: 'Import',
  call: 'Call',
  chat: 'Chat',
};

export function leadName(l: LeadDto): string {
  return `${l.firstName} ${l.lastName ?? ''}`.trim();
}

export function LeadsListScreen() {
  usePageMeta([{ label: 'Leads' }]);
  const navigate = useNavigate();
  const perms = usePermissions();
  const { online } = useSocketState();
  const list = useListState<LeadFilters>();
  const [createParam, setCreateParam] = useSearchParam('create');
  const [selection, setSelection] = useState<string[]>([]);
  const [bulkDialog, setBulkDialog] = useState<'assign' | 'status' | 'delete' | null>(null);

  const canRead = perms.has('lead:read');
  const query = useLeads(list.queryParams, canRead);
  const users = useAssignableUsers();
  const { bulk } = useLeadMutations();

  const rows = query.data?.data ?? [];
  const state = viewStateOf({
    allowed: canRead,
    online,
    isPending: query.isPending,
    isError: query.isError,
    error: query.error,
    count: rows.length,
  });

  const columns: Column<LeadDto>[] = [
    {
      key: 'firstName',
      header: 'Name',
      width: '1.4fr',
      sortable: true,
      render: (l) => (
        <span className="flex min-w-0 items-center gap-2">
          <Avatar name={leadName(l)} seed={l.id} size={20} />
          <span className="truncate font-medium">{leadName(l)}</span>
        </span>
      ),
    },
    {
      key: 'companyName',
      header: 'Company',
      width: '1.2fr',
      hideable: true,
      render: (l) => (
        <span className="truncate text-muted">
          {l.companyName ?? <span className="text-faint">—</span>}
        </span>
      ),
    },
    {
      key: 'phone',
      header: 'Phone',
      width: '1.3fr',
      hideable: true,
      render: (l) => <PhoneNumber e164={l.phone} actions />,
    },
    {
      key: 'email',
      header: 'Email',
      width: '1.2fr',
      hideable: true,
      optional: true,
      render: (l) => <span className="truncate text-muted">{l.email ?? '—'}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      width: '0.9fr',
      sortable: true,
      render: (l) => <LeadStatusBadge status={l.status} />,
    },
    {
      key: 'source',
      header: 'Source',
      width: '0.9fr',
      hideable: true,
      render: (l) => <span className="text-muted">{SOURCE_LABEL[l.source] ?? l.source}</span>,
    },
    {
      key: 'owner',
      header: 'Owner',
      width: '1fr',
      hideable: true,
      render: (l) =>
        l.owner === null ? (
          <span className="text-faint">Unassigned</span>
        ) : (
          <span className="flex min-w-0 items-center gap-1.5 text-muted">
            <Avatar name={l.owner.name} seed={l.owner.id} size={18} />
            <span className="truncate">{l.owner.name}</span>
          </span>
        ),
    },
    {
      key: 'createdAt',
      header: 'Created',
      width: '0.9fr',
      align: 'end',
      sortable: true,
      hideable: true,
      render: (l) => (
        <span className="text-muted">
          <DateTime value={l.createdAt} />
        </span>
      ),
    },
    {
      key: 'updatedAt',
      header: 'Updated',
      width: '0.9fr',
      align: 'end',
      sortable: true,
      hideable: true,
      optional: true,
      render: (l) => (
        <span className="text-muted">
          <DateTime value={l.updatedAt} />
        </span>
      ),
    },
  ];

  const bulkActions: BulkAction[] = perms.has('lead:assign')
    ? [
        {
          id: 'assign',
          label: 'Assign owner',
          icon: UserPlus,
          onRun: () => {
            setBulkDialog('assign');
          },
        },
        {
          id: 'status',
          label: 'Set status',
          icon: ArrowRight,
          onRun: () => {
            setBulkDialog('status');
          },
        },
        ...(perms.has('lead:delete')
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
    <div className="flex flex-col gap-4 p-6">
      <PageHeader
        title="Leads"
        description="People who are not contacts yet. Qualify them, then convert."
        actions={
          <>
            {perms.has('lead:import') && (
              <Button
                variant="secondary"
                icon={Upload}
                onClick={() => {
                  void navigate({
                    to: '/imports',
                    search: { entity: 'lead', create: true } as never,
                  });
                }}
              >
                Import
              </Button>
            )}
            {perms.has('lead:create') && (
              <Button
                variant="primary"
                icon={Plus}
                onClick={() => {
                  setCreateParam('true');
                }}
              >
                New lead
              </Button>
            )}
          </>
        }
      />

      <FilterBar
        search={list.filters.q ?? ''}
        onSearchChange={(v) => {
          list.set({ q: v === '' ? undefined : v });
        }}
        searchPlaceholder="Name, company, number or email"
        activeCount={list.activeCount}
        onClear={list.reset}
        savedViewsKey="leads"
      >
        <FilterChip
          label="Status"
          value={list.filters.status}
          onChange={(v) => {
            list.set({ status: v });
          }}
          options={[
            { value: 'new', label: 'New' },
            { value: 'contacted', label: 'Contacted' },
            { value: 'qualified', label: 'Qualified' },
            { value: 'unqualified', label: 'Unqualified' },
            { value: 'converted', label: 'Converted' },
          ]}
        />
        <FilterChip
          label="Source"
          value={list.filters.source}
          onChange={(v) => {
            list.set({ source: v });
          }}
          options={Object.entries(SOURCE_LABEL).map(([value, label]) => ({ value, label }))}
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
        tableId="leads"
        ariaLabel="Leads"
        columns={columns}
        rows={rows}
        rowKey={(l) => l.id}
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
        onRowClick={(l) => {
          void navigate(linkTo.lead(l.id));
        }}
        onRetry={() => {
          void query.refetch();
        }}
        error={errorInfo(query.error)}
        forbidden={{ permission: 'lead:read', what: 'Leads' }}
        emptyState={
          list.activeCount > 0
            ? {
                object: 'magnifier',
                title: 'No leads match these filters',
                description: 'Try a wider status, or clear the owner.',
                primaryAction: { label: 'Clear filters', onClick: list.reset },
              }
            : {
                object: 'funnel',
                title: 'No leads yet',
                description:
                  'Leads arrive from web forms, calls and chats, or you can add one by hand.',
                ...(perms.has('lead:create')
                  ? {
                      primaryAction: {
                        label: 'New lead',
                        onClick: () => {
                          setCreateParam('true');
                        },
                      },
                    }
                  : {}),
                ...(perms.has('lead:import')
                  ? { secondaryAction: { label: 'Import CSV', href: '/imports' } }
                  : {}),
              }
        }
        endpoint="GET /leads · offset paginated"
      />

      <LeadFormDrawer
        open={createParam !== undefined}
        onOpenChange={(v) => {
          setCreateParam(v ? 'true' : undefined);
        }}
        prefillPhone={createParam !== undefined && createParam !== 'true' ? createParam : undefined}
        onSaved={(l) => {
          setCreateParam(undefined);
          void navigate(linkTo.lead(l.id));
        }}
      />

      <BulkLeadDialogs
        which={bulkDialog}
        ids={selection}
        pending={bulk.isPending}
        onClose={() => {
          setBulkDialog(null);
        }}
        onRun={(body) => {
          bulk.mutate(body, {
            onSuccess: (r) => {
              toast({ tone: 'success', title: `${String(r.updated)} leads updated` });
              setSelection([]);
              setBulkDialog(null);
            },
            onError: (e) => {
              toast({ tone: 'danger', title: 'Bulk action failed', description: errorMessage(e) });
            },
          });
        }}
      />
    </div>
  );
}

function BulkLeadDialogs({
  which,
  ids,
  pending,
  onClose,
  onRun,
}: {
  which: 'assign' | 'status' | 'delete' | null;
  ids: string[];
  pending: boolean;
  onClose: () => void;
  onRun: (body: {
    action: 'assign' | 'delete' | 'status';
    ids: string[];
    ownerId?: string | null;
    status?: string;
  }) => void;
}) {
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [status, setStatus] = useState('contacted');

  return (
    <>
      <Dialog
        open={which === 'assign'}
        onOpenChange={onClose}
        title={`Assign ${String(ids.length)} leads`}
        width={420}
        footer={
          <>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={pending}
              onClick={() => {
                onRun({ action: 'assign', ids, ownerId });
              }}
            >
              Assign
            </Button>
          </>
        }
      >
        <OwnerPicker value={ownerId} onChange={setOwnerId} label="New owner" />
      </Dialog>

      <Dialog
        open={which === 'status'}
        onOpenChange={onClose}
        title={`Set status on ${String(ids.length)} leads`}
        width={420}
        footer={
          <>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={pending}
              onClick={() => {
                onRun({ action: 'status', ids, status });
              }}
            >
              Set status
            </Button>
          </>
        }
      >
        <Select
          label="Status"
          value={status}
          onChange={setStatus}
          options={[
            { value: 'new', label: 'New' },
            { value: 'contacted', label: 'Contacted' },
            { value: 'qualified', label: 'Qualified' },
            { value: 'unqualified', label: 'Unqualified' },
          ]}
          description="Converted is set by the conversion flow, not by hand."
        />
      </Dialog>

      <ConfirmDialog
        open={which === 'delete'}
        onOpenChange={onClose}
        title={`Delete ${String(ids.length)} leads?`}
        description="They are soft deleted and disappear from the list."
        confirmLabel={`Delete ${String(ids.length)}`}
        consequences={['Converted leads keep their contact and deal', 'The audit entries stay']}
        loading={pending}
        onConfirm={() => {
          onRun({ action: 'delete', ids });
        }}
      />
    </>
  );
}
