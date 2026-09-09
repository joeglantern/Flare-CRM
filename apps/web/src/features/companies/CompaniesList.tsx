/**
 * Companies list (Companies · List). Offset paginated, sortable on name and the two
 * timestamps, with column visibility, export and every view state.
 *
 * GAP-06: no `domain` field. The Website column shows the hostname of the stored URL.
 * Open deals come straight from the company DTO (formerly GAP-07).
 *
 * There is no `company:import` permission. POST /imports guards every entity with `contact:import`,
 * so that is what gates the Import button here.
 */
import type { CompanyDto } from '@crm/shared';
import { useNavigate } from '@tanstack/react-router';
import { Building2, Download, ExternalLink, Plus, Upload } from 'lucide-react';
import { useState } from 'react';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { DataTable, type Column } from '@/components/data/DataTable';
import { DateTime, Money } from '@/components/data/formatters';
import { PhoneNumber } from '@/components/data/PhoneNumber';
import { FilterBar, FilterChip } from '@/components/filters/FilterBar';
import { ExportDialog } from '@/components/filters/ExportDialog';
import { PageHeader } from '@/app/shell/TopBar';
import { usePageMeta } from '@/app/shell/page-meta';
import { linkTo } from '@/lib/links';
import { useListState, useSearchParam } from '@/lib/list-state';
import { errorInfo, viewStateOf } from '@/lib/view-state';
import { useAssignableUsers } from '@/features/users/api';
import { usePermissions } from '@/providers/permissions';
import { useSocketState } from '@/providers/socket';
import { useCompanies, type CompanyFilters } from './api';
import { CompanyFormDrawer } from './CompanyForm';

/** GAP-06: the DTO stores a full URL, the column shows just the host. */
export function websiteHost(url: string | null): string | null {
  if (url === null || url.trim() === '') return null;
  try {
    return new URL(url.includes('://') ? url : `https://${url}`).host.replace(/^www\./, '');
  } catch {
    return url;
  }
}

export function CompaniesListScreen() {
  usePageMeta([{ label: 'Companies' }]);
  const navigate = useNavigate();
  const perms = usePermissions();
  const { online } = useSocketState();
  const list = useListState<CompanyFilters>();
  const [createParam, setCreateParam] = useSearchParam('create');
  const [exportOpen, setExportOpen] = useState(false);

  const canRead = perms.has('company:read');
  const query = useCompanies(list.queryParams, canRead);
  const users = useAssignableUsers();

  const rows = query.data?.data ?? [];

  const state = viewStateOf({
    allowed: canRead,
    online,
    isPending: query.isPending,
    isError: query.isError,
    error: query.error,
    count: rows.length,
  });

  const industries = Array.from(
    new Set(rows.map((c) => c.industry).filter((i): i is string => i !== null && i !== '')),
  ).sort();

  const columns: Column<CompanyDto>[] = [
    {
      key: 'name',
      header: 'Company',
      width: '1.6fr',
      sortable: true,
      render: (c) => (
        <span className="flex min-w-0 items-center gap-2">
          <Avatar name={c.name} seed={c.id} size={20} />
          <span className="truncate font-medium">{c.name}</span>
        </span>
      ),
    },
    {
      key: 'industry',
      header: 'Industry',
      width: '1fr',
      hideable: true,
      render: (c) => (
        <span className="truncate text-muted">
          {c.industry ?? <span className="text-faint">—</span>}
        </span>
      ),
    },
    {
      key: 'website',
      header: 'Website',
      width: '1.1fr',
      hideable: true,
      render: (c) => {
        const host = websiteHost(c.website);
        if (host === null) return <span className="text-faint">—</span>;
        return (
          <a
            href={c.website ?? '#'}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex min-w-0 items-center gap-1 truncate text-muted underline-offset-2 hover:text-fg hover:underline"
            onClick={(e) => {
              e.stopPropagation();
            }}
          >
            <span className="truncate">{host}</span>
            <ExternalLink size={11} className="shrink-0" aria-hidden />
          </a>
        );
      },
    },
    {
      key: 'phone',
      header: 'Main line',
      width: '1.3fr',
      hideable: true,
      render: (c) => <PhoneNumber e164={c.phone} actions />,
    },
    {
      key: 'contactCount',
      header: 'Contacts',
      width: '0.7fr',
      align: 'end',
      hideable: true,
      render: (c) => <span className="mono text-muted">{c.contactCount}</span>,
    },
    {
      key: 'openDeals',
      header: 'Open deals',
      width: '1.1fr',
      align: 'end',
      hideable: true,
      render: (c) =>
        c.openDealCount === 0 ? (
          <span className="text-faint">None</span>
        ) : (
          <span className="mono text-muted">
            {c.openDealCount} · <Money amount={c.openDealValue} currency="KES" compact />
          </span>
        ),
    },
    {
      key: 'owner',
      header: 'Owner',
      width: '1fr',
      hideable: true,
      render: (c) =>
        c.owner === null ? (
          <span className="text-faint">Unassigned</span>
        ) : (
          <span className="flex min-w-0 items-center gap-1.5 text-muted">
            <Avatar name={c.owner.name} seed={c.owner.id} size={18} />
            <span className="truncate">{c.owner.name}</span>
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
      render: (c) => (
        <span className="text-muted">
          <DateTime value={c.updatedAt} />
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
      optional: true,
      render: (c) => (
        <span className="text-muted">
          <DateTime value={c.createdAt} />
        </span>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-4 p-6">
      <PageHeader
        title="Companies"
        description="The organisations behind your contacts and deals."
        actions={
          <>
            {perms.has('company:export') && (
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
                    search: { entity: 'company', create: true } as never,
                  });
                }}
              >
                Import
              </Button>
            )}
            {perms.has('company:create') && (
              <Button
                variant="primary"
                icon={Plus}
                onClick={() => {
                  setCreateParam('true');
                }}
              >
                New company
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
        searchPlaceholder="Company name"
        activeCount={list.activeCount}
        onClear={list.reset}
        savedViewsKey="companies"
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
          label="Industry"
          value={list.filters.industry}
          onChange={(v) => {
            list.set({ industry: v });
          }}
          options={industries.map((i) => ({ value: i, label: i }))}
        />
      </FilterBar>

      <DataTable
        tableId="companies"
        ariaLabel="Companies"
        columns={columns}
        rows={rows}
        rowKey={(c) => c.id}
        state={state}
        sort={list.sort}
        onSortChange={list.setSort}
        pagination={{
          kind: 'offset',
          page: list.page,
          pageSize: list.pageSize,
          total: query.data?.page.total ?? 0,
        }}
        onPageChange={list.setPage}
        onPageSizeChange={list.setPageSize}
        onRowClick={(c) => {
          void navigate(linkTo.company(c.id));
        }}
        onRetry={() => {
          void query.refetch();
        }}
        error={errorInfo(query.error)}
        forbidden={{ permission: 'company:read', what: 'Companies' }}
        emptyState={
          list.activeCount > 0
            ? {
                object: 'magnifier',
                title: 'No companies match these filters',
                description: 'Company search matches the name only.',
                primaryAction: { label: 'Clear filters', onClick: list.reset },
              }
            : {
                object: 'folder',
                title: 'No companies yet',
                description: 'Group contacts and deals under the organisation they belong to.',
                ...(perms.has('company:create')
                  ? {
                      primaryAction: {
                        label: 'New company',
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
        endpoint="GET /companies · offset paginated. Open deals are on the DTO."
      />

      <CompanyFormDrawer
        open={createParam !== undefined}
        onOpenChange={(v) => {
          setCreateParam(v ? 'true' : undefined);
        }}
        prefillName={createParam !== undefined && createParam !== 'true' ? createParam : undefined}
        onSaved={(c) => {
          setCreateParam(undefined);
          void navigate(linkTo.company(c.id));
        }}
      />

      <ExportDialog
        open={exportOpen}
        onOpenChange={setExportOpen}
        entity="companies"
        filters={list.queryParams}
        estimatedCount={query.data?.page.total}
        filterSummary={
          Object.entries(list.filters)
            .filter(([, v]) => v !== undefined && v !== '')
            .map(([k, v]) => `${k}=${String(v)}`)
            .join(', ') || 'None'
        }
      />
    </div>
  );
}

export { Building2 };
