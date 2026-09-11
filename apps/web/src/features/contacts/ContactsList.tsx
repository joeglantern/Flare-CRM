/**
 * Contacts list (Contacts · List). Table with sorting, column visibility, bulk selection,
 * saved views, export and all five states. Offset paginated (GAP-01).
 * Bulk actions are manager and admin only; an agent sees the rows but not the bar.
 */
import type { ContactSummaryDto } from '@crm/shared';
import { useNavigate } from '@tanstack/react-router';
import { Ban, Download, Plus, Tag as TagIcon, Trash2, Upload, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Dialog } from '@/components/ui/Overlay';
import { Input } from '@/components/ui/Input';
import { toast } from '@/components/ui/toast';
import { DataTable, type BulkAction, type Column } from '@/components/data/DataTable';
import { DateTime } from '@/components/data/formatters';
import { PhoneNumber } from '@/components/data/PhoneNumber';
import { DoNotCallBadge } from '@/components/data/status';
import { FilterBar, FilterChip } from '@/components/filters/FilterBar';
import { ExportDialog } from '@/components/filters/ExportDialog';
import { OwnerPicker } from '@/components/entity/pickers';
import { TagList } from '@/components/entity/TagInput';
import { PageHeader } from '@/app/shell/TopBar';
import { usePageMeta } from '@/app/shell/page-meta';
import { useContactMutations, useContacts, type ContactFilters } from './api';
import { ContactFormDrawer } from './ContactForm';
import { linkTo } from '@/lib/links';
import { errorMessage } from '@/lib/api/errors';
import { useListState } from '@/lib/list-state';
import { useSearchParam } from '@/lib/list-state';
import { viewStateOf, errorInfo } from '@/lib/view-state';
import { useAssignableUsers } from '@/features/users/api';
import { usePermissions } from '@/providers/permissions';
import { useSocketState } from '@/providers/socket';

export function ContactsListScreen() {
  usePageMeta([{ label: 'Contacts' }]);
  const navigate = useNavigate();
  const perms = usePermissions();
  const { online } = useSocketState();
  const list = useListState<ContactFilters>();
  const [createParam, setCreateParam] = useSearchParam('create');
  const [selection, setSelection] = useState<string[]>([]);
  const [exportOpen, setExportOpen] = useState(false);
  const [bulkDialog, setBulkDialog] = useState<'assign' | 'tag' | 'delete' | null>(null);

  const canRead = perms.has('contact:read');
  const query = useContacts(list.queryParams, canRead);
  const users = useAssignableUsers();
  const { bulk } = useContactMutations();

  const rows = query.data?.data ?? [];
  const state = viewStateOf({
    allowed: canRead,
    online,
    isPending: query.isPending,
    isError: query.isError,
    error: query.error,
    count: rows.length,
  });

  const columns: Column<ContactSummaryDto>[] = [
    {
      key: 'name',
      header: 'Name',
      width: '1.5fr',
      sortable: true,
      render: (c) => (
        <span className="flex min-w-0 items-center gap-2">
          <Avatar name={c.displayName} seed={c.id} src={c.avatarUrl} size={20} />
          <span className="truncate font-medium">{c.displayName}</span>
          {c.doNotCall && <DoNotCallBadge compact />}
        </span>
      ),
    },
    {
      key: 'company',
      header: 'Company',
      width: '1.3fr',
      hideable: true,
      render: (c) => (
        <span className="truncate">{c.company?.name ?? <span className="text-faint">—</span>}</span>
      ),
    },
    {
      key: 'phone',
      header: 'Phone',
      width: '1.4fr',
      hideable: true,
      render: (c) => (
        <PhoneNumber
          e164={c.primaryPhone}
          contactId={c.id}
          contactName={c.displayName}
          contactCompany={c.company?.name ?? null}
          doNotCall={c.doNotCall}
          actions
        />
      ),
    },
    {
      key: 'owner',
      header: 'Owner',
      width: '1fr',
      hideable: true,
      render: (c) => {
        const owner = (users.data ?? []).find((u) => u.id === c.ownerId);
        if (owner === undefined) return <span className="text-faint">Unassigned</span>;
        return (
          <span className="flex min-w-0 items-center gap-1.5 text-muted">
            <Avatar name={owner.name} seed={owner.id} src={owner.avatarUrl} size={18} />
            <span className="truncate">{owner.name}</span>
          </span>
        );
      },
    },
    {
      key: 'tags',
      header: 'Tags',
      width: '1.1fr',
      hideable: true,
      render: (c) => <TagList tags={c.tags} />,
    },
    {
      key: 'updatedAt',
      header: 'Last activity',
      width: '0.9fr',
      align: 'end',
      sortable: true,
      hideable: true,
      render: (c) => (
        <span className="text-muted">
          <DateTime value={c.updatedAt} />
        </span>
      ),
    },
    {
      key: 'primaryEmail',
      header: 'Email',
      width: '1.2fr',
      hideable: true,
      optional: true,
      render: (c) => <span className="truncate text-muted">{c.primaryEmail ?? '—'}</span>,
    },
    {
      key: 'doNotCall',
      header: 'Do not call',
      width: '0.8fr',
      hideable: true,
      optional: true,
      render: (c) =>
        c.doNotCall ? <DoNotCallBadge compact /> : <span className="text-faint">No</span>,
    },
  ];

  const bulkActions: BulkAction[] = perms.has('contact:assign')
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
          id: 'tag',
          label: 'Add tag',
          icon: TagIcon,
          onRun: () => {
            setBulkDialog('tag');
          },
        },
        ...(perms.has('contact:delete')
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
        title="Contacts"
        description="Everyone you call, message or sell to."
        actions={
          <>
            {perms.has('contact:export') && (
              <Button
                variant="secondary"
                icon={Download}
                onClick={() => {
                  setExportOpen(true);
                }}
              >
                Export
              </Button>
            )}
            {perms.has('contact:import') && (
              <Button
                variant="secondary"
                icon={Upload}
                onClick={() => {
                  void navigate({
                    to: '/imports',
                    search: { entity: 'contact', create: true } as never,
                  });
                }}
              >
                Import
              </Button>
            )}
            {perms.has('contact:create') && (
              <Button
                variant="primary"
                icon={Plus}
                onClick={() => {
                  setCreateParam('true');
                }}
              >
                New contact
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
        savedViewsKey="contacts"
      >
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
        <FilterChip
          label="Source"
          value={list.filters.source}
          onChange={(v) => {
            list.set({ source: v });
          }}
          options={[
            { value: 'manual', label: 'Manual' },
            { value: 'import', label: 'Import' },
            { value: 'webform', label: 'Web form' },
            { value: 'call', label: 'Call' },
            { value: 'whatsapp', label: 'WhatsApp' },
            { value: 'lead', label: 'Lead' },
          ]}
        />
        <FilterChip
          label="Do not call"
          value={list.filters.doNotCall}
          onChange={(v) => {
            list.set({ doNotCall: v as 'true' | 'false' | undefined });
          }}
          options={[
            { value: 'true', label: 'Flagged' },
            { value: 'false', label: 'Not flagged' },
          ]}
        />
      </FilterBar>

      <DataTable
        tableId="contacts"
        ariaLabel="Contacts"
        columns={columns}
        rows={rows}
        rowKey={(c) => c.id}
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
        onRowClick={(c) => {
          void navigate(linkTo.contact(c.id));
        }}
        onRetry={() => {
          void query.refetch();
        }}
        error={errorInfo(query.error)}
        forbidden={{ permission: 'contact:read', what: 'Contacts' }}
        emptyState={
          list.activeCount > 0
            ? {
                object: 'magnifier',
                title: `No contacts match ${list.filters.q !== undefined ? `“${list.filters.q}”` : 'these filters'}`,
                description:
                  'Try a name, company or number. Numbers match on the last 9 digits when suffix match is on.',
                primaryAction: { label: 'Clear filters', onClick: list.reset },
              }
            : {
                object: 'contact-card',
                title: 'No contacts yet',
                description:
                  'Add your first contact, or bring your list across from a spreadsheet.',
                ...(perms.has('contact:create')
                  ? {
                      primaryAction: {
                        label: 'New contact',
                        onClick: () => {
                          setCreateParam('true');
                        },
                      },
                    }
                  : {}),
                ...(perms.has('contact:import')
                  ? { secondaryAction: { label: 'Import CSV', href: '/imports' } }
                  : {}),
              }
        }
      />

      <ContactFormDrawer
        open={createParam !== undefined}
        onOpenChange={(v) => {
          setCreateParam(v ? 'true' : undefined);
        }}
        prefillPhone={createParam !== undefined && createParam !== 'true' ? createParam : undefined}
        onSaved={(c) => {
          setCreateParam(undefined);
          void navigate(linkTo.contact(c.id));
        }}
      />

      <ExportDialog
        open={exportOpen}
        onOpenChange={setExportOpen}
        entity="contacts"
        filters={list.queryParams}
        estimatedCount={query.data?.page.total}
        filterSummary={summarise(list.filters)}
      />

      <BulkDialogs
        which={bulkDialog}
        onClose={() => {
          setBulkDialog(null);
        }}
        ids={selection}
        onDone={() => {
          setSelection([]);
          setBulkDialog(null);
        }}
        run={(body) =>
          new Promise<void>((resolve, reject) => {
            bulk.mutate(body, {
              onSuccess: (r) => {
                toast({ tone: 'success', title: `${String(r.updated)} contacts updated` });
                resolve();
              },
              onError: (e) => {
                toast({
                  tone: 'danger',
                  title: 'Bulk action failed',
                  description: errorMessage(e),
                });
                reject(e instanceof Error ? e : new Error('failed'));
              },
            });
          })
        }
      />
    </div>
  );
}

function summarise(filters: ContactFilters): string {
  const parts = Object.entries(filters)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${k}=${String(v)}`);
  return parts.length === 0 ? 'None' : parts.join(', ');
}

function BulkDialogs({
  which,
  onClose,
  ids,
  onDone,
  run,
}: {
  which: 'assign' | 'tag' | 'delete' | null;
  onClose: () => void;
  ids: string[];
  onDone: () => void;
  run: (body: {
    action: 'assign' | 'tag' | 'untag' | 'delete';
    ids: string[];
    ownerId?: string | null;
    tag?: string;
  }) => Promise<void>;
}) {
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [tag, setTag] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = (body: Parameters<typeof run>[0]) => {
    void (async () => {
      setBusy(true);
      try {
        await run(body);
        onDone();
      } finally {
        setBusy(false);
      }
    })();
  };

  return (
    <>
      <Dialog
        open={which === 'assign'}
        onOpenChange={onClose}
        title={`Assign ${String(ids.length)} contacts`}
        width={420}
        footer={
          <>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={busy}
              onClick={() => {
                submit({ action: 'assign', ids, ownerId });
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
        open={which === 'tag'}
        onOpenChange={onClose}
        title={`Tag ${String(ids.length)} contacts`}
        width={420}
        footer={
          <>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={tag.trim() === ''}
              loading={busy}
              onClick={() => {
                submit({ action: 'tag', ids, tag: tag.trim().toLowerCase() });
              }}
            >
              Add tag
            </Button>
          </>
        }
      >
        <Input
          autoFocus
          label="Tag"
          value={tag}
          onChange={(e) => {
            setTag(e.target.value);
          }}
          description="Lower case. Existing tags on those contacts are kept."
        />
      </Dialog>

      <ConfirmDialog
        open={which === 'delete'}
        onOpenChange={onClose}
        title={`Delete ${String(ids.length)} contacts?`}
        description="They are soft deleted and can be restored for 90 days. Calls and audit entries stay."
        confirmLabel={`Delete ${String(ids.length)}`}
        consequences={[
          'Deals, tasks and notes stay but lose the contact link',
          'Restorable from the contact page until the retention purge',
        ]}
        loading={busy}
        onConfirm={() => {
          submit({ action: 'delete', ids });
        }}
      />
    </>
  );
}

export { Ban };
