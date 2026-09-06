/**
 * Company detail (Companies · Detail): header, tabs for contacts, deals, timeline and
 * notes, plus the profile and custom fields panels.
 *
 * GAP-06: the DTO has no `size` and no `domain`. Size is a custom field; website is a full URL.
 * GAP-07: there is no deal aggregate, so the pipeline total is summed from GET /deals?companyId.
 */
import { Link, useNavigate } from '@tanstack/react-router';
import { Building2, ExternalLink, Kanban, Pencil, Plus, Trash2, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Skeleton } from '@/components/ui/Loading';
import { Tabs } from '@/components/ui/Menu';
import { toast } from '@/components/ui/toast';
import { DateTime, Money } from '@/components/data/formatters';
import { PhoneNumber } from '@/components/data/PhoneNumber';
import { DealStatusBadge } from '@/components/data/status';
import { EmptyState, ErrorState, ForbiddenState, NotFoundState } from '@/components/data/states';
import { CustomFieldsPanel } from '@/components/entity/CustomFields';
import { DetailList, EntityHeader, Panel } from '@/components/entity/EntityHeader';
import { NotesPanel } from '@/components/entity/Notes';
import { Timeline, typesForFilter } from '@/components/entity/Timeline';
import { usePageMeta } from '@/app/shell/page-meta';
import { useTimeline } from '@/features/activity/api';
import { useDeals } from '@/features/deals/api';
import { DealFormDrawer } from '@/features/deals/DealForm';
import { useCustomFields } from '@/features/settings/api';
import { errorMessage, isApiError } from '@/lib/api/errors';
import { useDebounced } from '@/lib/hooks';
import { linkTo } from '@/lib/links';
import { useSearchParam } from '@/lib/list-state';
import { useWatchEntity } from '@/lib/socket/client';
import { usePermissions } from '@/providers/permissions';
import { useCompany, useCompanyContacts, useCompanyMutations } from './api';
import { CompanyFormDrawer } from './CompanyForm';
import { websiteHost } from './CompaniesList';

export function CompanyDetailScreen({ companyId }: { companyId: string }) {
  const perms = usePermissions();
  const navigate = useNavigate();
  const query = useCompany(companyId);
  const company = query.data;
  const [tab, setTab] = useSearchParam('tab');
  const [editing, setEditing] = useState(false);
  const [dealOpen, setDealOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { remove } = useCompanyMutations();

  useWatchEntity('company', companyId);
  usePageMeta([{ label: 'Companies', href: '/companies' }, { label: company?.name ?? 'Company' }]);

  if (query.isError) {
    if (isApiError(query.error) && query.error.status === 404) {
      return (
        <NotFoundState what="company" backTo={{ label: 'All companies', href: '/companies' }} />
      );
    }
    if (isApiError(query.error) && query.error.isForbidden) {
      return (
        <ForbiddenState
          permission="company:read"
          what="this company"
          backTo={{ label: 'All companies', href: '/companies' }}
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

  if (query.isPending || company === undefined) {
    return (
      <div className="flex flex-col gap-4 p-6">
        <div className="flex items-center gap-4">
          <Skeleton shape="circle" height={40} />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton height={20} width="220px" />
            <Skeleton height={12} width="320px" />
          </div>
        </div>
        <Skeleton height={200} shape="block" />
      </div>
    );
  }

  const canEdit = perms.can('company:update', { ownerId: company.ownerId });
  const canDelete = perms.can('company:delete', { ownerId: company.ownerId });
  const active = tab ?? 'contacts';
  const host = websiteHost(company.website);

  const tabs = [
    { id: 'contacts', label: 'Contacts', count: company.contactCount },
    { id: 'deals', label: 'Deals' },
    { id: 'timeline', label: 'Timeline' },
    { id: 'notes', label: 'Notes' },
  ];

  return (
    <div className="flex flex-col gap-4 p-6">
      <EntityHeader
        title={company.name}
        avatarSeed={company.id}
        monogramIcon={<Building2 size={18} aria-hidden />}
        subtitle={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted">
            {company.industry !== null && <span>{company.industry}</span>}
            {host !== null && (
              <a
                href={company.website ?? '#'}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-1 underline-offset-2 hover:text-fg hover:underline"
              >
                {host}
                <ExternalLink size={11} aria-hidden />
              </a>
            )}
            <span>
              {company.contactCount} {company.contactCount === 1 ? 'contact' : 'contacts'}
            </span>
          </span>
        }
        {...(company.phone !== null ? { phone: { e164: company.phone, actions: true } } : {})}
        actions={[
          ...(perms.has('contact:create')
            ? [
                {
                  id: 'contact',
                  label: 'Add contact',
                  icon: UserPlus,
                  variant: 'secondary' as const,
                  onClick: () => {
                    void navigate({ to: '/contacts', search: { create: 'true' } as never });
                  },
                },
              ]
            : []),
          ...(perms.has('deal:create')
            ? [
                {
                  id: 'deal',
                  label: 'New deal',
                  icon: Plus,
                  variant: 'secondary' as const,
                  onClick: () => {
                    setDealOpen(true);
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
                  label: 'Delete company',
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

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-3">
          <Tabs
            tabs={tabs}
            value={active}
            onChange={(id) => {
              setTab(id === 'contacts' ? undefined : id);
            }}
            ariaLabel="Company sections"
          />

          {active === 'contacts' && (
            <CompanyContactsTab companyId={company.id} companyName={company.name} />
          )}
          {active === 'deals' && (
            <CompanyDealsTab
              companyId={company.id}
              onNew={() => {
                setDealOpen(true);
              }}
            />
          )}
          {active === 'timeline' && <CompanyTimelineTab companyId={company.id} />}
          {active === 'notes' && (
            <NotesPanel parent="company" id={company.id} canCreate={perms.has('note:create')} />
          )}
        </div>

        <aside className="flex min-w-0 flex-col gap-3">
          <Panel title="Profile">
            <DetailList
              items={[
                {
                  label: 'Industry',
                  value: company.industry ?? <span className="text-faint">Not set</span>,
                },
                {
                  label: 'Website',
                  value:
                    company.website === null ? (
                      <span className="text-faint">Not set</span>
                    ) : (
                      <a
                        href={company.website}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="break-all underline-offset-2 hover:underline"
                      >
                        {company.website}
                      </a>
                    ),
                },
                { label: 'Main line', value: <PhoneNumber e164={company.phone} actions /> },
                {
                  label: 'Email',
                  value:
                    company.email === null ? (
                      <span className="text-faint">Not set</span>
                    ) : (
                      <a
                        href={`mailto:${company.email}`}
                        className="break-all underline-offset-2 hover:underline"
                      >
                        {company.email}
                      </a>
                    ),
                },
                {
                  label: 'Address',
                  value:
                    company.address === null ? (
                      <span className="text-faint">Not set</span>
                    ) : (
                      <span>
                        {[
                          company.address.line1,
                          company.address.line2,
                          company.address.city,
                          company.address.region,
                          company.address.postalCode,
                        ]
                          .filter((p) => p !== undefined && p !== '')
                          .join(', ')}
                      </span>
                    ),
                },
                {
                  label: 'Owner',
                  value:
                    company.owner === null ? (
                      <span className="text-faint">Unassigned</span>
                    ) : (
                      <span className="flex items-center gap-1.5">
                        <Avatar name={company.owner.name} seed={company.owner.id} size={18} />
                        {company.owner.name}
                      </span>
                    ),
                },
                { label: 'Created', value: <DateTime value={company.createdAt} /> },
                { label: 'Updated', value: <DateTime value={company.updatedAt} /> },
              ]}
            />
          </Panel>

          <CompanyCustomFields values={company.customFields} />
        </aside>
      </div>

      <CompanyFormDrawer open={editing} onOpenChange={setEditing} company={company} />

      <DealFormDrawer
        open={dealOpen}
        onOpenChange={setDealOpen}
        defaults={{ companyId: company.id }}
        onSaved={(d) => {
          setDealOpen(false);
          void navigate(linkTo.deal(d.id));
        }}
      />

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete ${company.name}?`}
        description="The company is soft deleted. Its contacts and deals stay but lose the company link."
        confirmLabel="Delete company"
        consequences={[
          `${String(company.contactCount)} contacts will no longer show this company`,
          'Deals keep their value and stage',
        ]}
        loading={remove.isPending}
        onConfirm={() => {
          remove.mutate(company.id, {
            onSuccess: () => {
              toast({ tone: 'success', title: 'Company deleted', description: company.name });
              void navigate({ to: '/companies' });
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

function CompanyCustomFields({ values }: { values: Record<string, unknown> }) {
  const definitions = useCustomFields('company');
  if ((definitions.data ?? []).length === 0) return null;
  return <CustomFieldsPanel definitions={definitions.data ?? []} values={values} />;
}

function CompanyContactsTab({
  companyId,
  companyName,
}: {
  companyId: string;
  companyName: string;
}) {
  const perms = usePermissions();
  const query = useCompanyContacts(companyId, perms.has('contact:read'));
  const rows = query.data?.data ?? [];

  if (!perms.has('contact:read')) {
    return <ForbiddenState permission="contact:read" what="contacts" compact />;
  }
  if (query.isPending) return <Skeleton height={160} shape="block" />;
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
          object="contact-card"
          title={`No contacts at ${companyName}`}
          description="Add a contact and set this company on it."
          {...(perms.has('contact:create')
            ? { primaryAction: { label: 'New contact', href: '/contacts?create=true' } }
            : {})}
        />
      </Panel>
    );
  }

  return (
    <Panel title={`${String(rows.length)} contacts`} padded={false}>
      <ul className="divide-y divide-border">
        {rows.map((c) => {
          const primary = c.phones.find((p) => p.isPrimary) ?? c.phones[0];
          return (
            <li key={c.id}>
              <Link
                {...linkTo.contact(c.id)}
                className="flex items-center gap-3 px-3.5 py-2.5 hover:bg-surface-hover"
              >
                <Avatar name={c.displayName} seed={c.id} src={c.avatarUrl} size={24} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{c.displayName}</span>
                  {c.jobTitle !== null && (
                    <span className="block truncate text-sm text-muted">{c.jobTitle}</span>
                  )}
                </span>
                <PhoneNumber
                  e164={primary?.e164 ?? null}
                  contactId={c.id}
                  contactName={c.displayName}
                  actions
                />
              </Link>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

function CompanyDealsTab({ companyId, onNew }: { companyId: string; onNew: () => void }) {
  const perms = usePermissions();
  const query = useDeals({ companyId, pageSize: 50 }, perms.has('deal:read'));
  const rows = query.data?.data ?? [];
  const openValue = rows.filter((d) => d.status === 'open').reduce((a, d) => a + d.value, 0);

  if (!perms.has('deal:read'))
    return <ForbiddenState permission="deal:read" what="deals" compact />;
  if (query.isPending) return <Skeleton height={160} shape="block" />;
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
          object="kanban"
          title="No deals with this company"
          description="Open a deal to track the value and the stage."
          {...(perms.has('deal:create')
            ? { primaryAction: { label: 'New deal', onClick: onNew } }
            : {})}
        />
      </Panel>
    );
  }

  return (
    <Panel
      title="Deals"
      note={`Open pipeline ${new Intl.NumberFormat('en-KE').format(openValue)} KES · GAP-07: summed client side from GET /deals?companyId`}
      padded={false}
      actions={
        perms.has('deal:create') ? (
          <Button variant="ghost" size="sm" icon={Plus} onClick={onNew}>
            New
          </Button>
        ) : undefined
      }
    >
      <ul className="divide-y divide-border">
        {rows.map((d) => (
          <li key={d.id}>
            <Link
              {...linkTo.deal(d.id)}
              className="flex items-center gap-3 px-3.5 py-2.5 hover:bg-surface-hover"
            >
              <Kanban size={14} className="shrink-0 text-muted" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{d.title}</span>
                <span className="block truncate text-sm text-muted">{d.stage.name}</span>
              </span>
              <DealStatusBadge status={d.status} />
              <Money amount={d.value} currency={d.currency} emphasis="strong" />
            </Link>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function CompanyTimelineTab({ companyId }: { companyId: string }) {
  const [filter, setFilter] = useState('all');
  const [q, setQ] = useState('');
  const debounced = useDebounced(q, 250);
  const query = useTimeline('company', companyId, {
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
      emptyTitle="Nothing on this company yet"
      emptyDescription="Calls, deals and notes on the company all land here."
    />
  );
}
