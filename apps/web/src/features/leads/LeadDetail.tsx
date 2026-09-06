/**
 * Lead detail (Leads · Detail): header with click-to-dial, the qualify strip that moves the
 * status, the timeline, notes, and the convert action.
 *
 * The status strip is optimistic. PATCH /leads/:id with the same status is idempotent, so a retry
 * or a double click cannot produce a different result and the rollback is a straight revert.
 */
import { Link, useNavigate } from '@tanstack/react-router';
import { ArrowRight, Building2, Check, Pencil, Trash2, UserRound } from 'lucide-react';
import { useState } from 'react';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Skeleton } from '@/components/ui/Loading';
import { Tabs } from '@/components/ui/Menu';
import { toast } from '@/components/ui/toast';
import { DateTime } from '@/components/data/formatters';
import { PhoneNumber } from '@/components/data/PhoneNumber';
import { LeadStatusBadge } from '@/components/data/status';
import { ErrorState, ForbiddenState, NotFoundState } from '@/components/data/states';
import { CustomFieldsPanel } from '@/components/entity/CustomFields';
import { DetailList, EntityHeader, Panel } from '@/components/entity/EntityHeader';
import { NotesPanel } from '@/components/entity/Notes';
import { Timeline, typesForFilter } from '@/components/entity/Timeline';
import { usePageMeta } from '@/app/shell/page-meta';
import { useTimeline } from '@/features/activity/api';
import { useCustomFields } from '@/features/settings/api';
import { errorMessage, isApiError } from '@/lib/api/errors';
import { useDebounced } from '@/lib/hooks';
import { linkTo } from '@/lib/links';
import { useSearchParam } from '@/lib/list-state';
import { useWatchEntity } from '@/lib/socket/client';
import { usePermissions } from '@/providers/permissions';
import { useLead, useLeadMutations } from './api';
import { ConvertLeadDialog } from './ConvertLead';
import { LeadFormDrawer } from './LeadForm';
import { leadName } from './LeadsList';

const QUALIFY_STEPS = [
  { id: 'new', label: 'New' },
  { id: 'contacted', label: 'Contacted' },
  { id: 'qualified', label: 'Qualified' },
] as const;

export function LeadDetailScreen({ leadId }: { leadId: string }) {
  const perms = usePermissions();
  const navigate = useNavigate();
  const query = useLead(leadId);
  const lead = query.data;
  const [tab, setTab] = useSearchParam('tab');
  const [editing, setEditing] = useState(false);
  const [converting, setConverting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { update, remove } = useLeadMutations();

  useWatchEntity('lead', leadId);
  usePageMeta([
    { label: 'Leads', href: '/leads' },
    { label: lead === undefined ? 'Lead' : leadName(lead) },
  ]);

  if (query.isError) {
    if (isApiError(query.error) && query.error.status === 404) {
      return <NotFoundState what="lead" backTo={{ label: 'All leads', href: '/leads' }} />;
    }
    if (isApiError(query.error) && query.error.isForbidden) {
      return (
        <ForbiddenState
          permission="lead:read"
          what="this lead"
          backTo={{ label: 'All leads', href: '/leads' }}
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

  if (query.isPending || lead === undefined) {
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

  const converted = lead.convertedAt !== null;
  const canEdit = !converted && perms.can('lead:update', { ownerId: lead.ownerId });
  const canConvert = !converted && perms.can('lead:convert', { ownerId: lead.ownerId });
  const canDelete = perms.can('lead:delete', { ownerId: lead.ownerId });
  const active = tab ?? 'timeline';

  const setStatus = (status: string) => {
    if (!canEdit || status === lead.status) return;
    update.mutate(
      { id: lead.id, body: { status } },
      {
        onError: (e) => {
          toast({
            tone: 'danger',
            title: 'Could not change the status',
            description: errorMessage(e),
          });
        },
      },
    );
  };

  return (
    <div className="flex flex-col gap-4 p-6">
      <EntityHeader
        title={leadName(lead)}
        avatarSeed={lead.id}
        subtitle={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted">
            {lead.companyName !== null && (
              <span className="flex items-center gap-1">
                <Building2 size={12} aria-hidden />
                {lead.companyName}
              </span>
            )}
            {lead.email !== null && (
              <a
                href={`mailto:${lead.email}`}
                className="underline-offset-2 hover:text-fg hover:underline"
              >
                {lead.email}
              </a>
            )}
            <span>
              Added <DateTime value={lead.createdAt} mode="relative" />
            </span>
          </span>
        }
        badges={
          <>
            <LeadStatusBadge status={lead.status} />
            {converted && <Badge tone="success">Converted</Badge>}
          </>
        }
        {...(lead.phone !== null ? { phone: { e164: lead.phone, actions: true } } : {})}
        actions={[
          ...(canEdit
            ? [
                {
                  id: 'edit',
                  label: 'Edit',
                  icon: Pencil,
                  variant: 'secondary' as const,
                  onClick: () => {
                    setEditing(true);
                  },
                },
              ]
            : []),
          ...(canConvert
            ? [
                {
                  id: 'convert',
                  label: 'Convert',
                  icon: ArrowRight,
                  variant: 'primary' as const,
                  onClick: () => {
                    setConverting(true);
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
                  label: 'Delete lead',
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

      {converted ? (
        <Panel>
          <div className="flex flex-wrap items-center gap-3">
            <Check size={16} className="text-success" aria-hidden />
            <span className="min-w-0 flex-1">
              Converted <DateTime value={lead.convertedAt} mode="relative" />. The records it
              created:
            </span>
            {lead.convertedContactId !== null && (
              <Link {...linkTo.contact(lead.convertedContactId)}>
                <Button variant="secondary" size="sm" icon={UserRound}>
                  Contact
                </Button>
              </Link>
            )}
            {lead.convertedDealId !== null && (
              <Link {...linkTo.deal(lead.convertedDealId)}>
                <Button variant="secondary" size="sm" icon={ArrowRight}>
                  Deal
                </Button>
              </Link>
            )}
          </div>
        </Panel>
      ) : (
        <Panel title="Qualify">
          <div className="flex flex-wrap items-center gap-2">
            {QUALIFY_STEPS.map((step) => {
              const isCurrent = lead.status === step.id;
              return (
                <button
                  key={step.id}
                  type="button"
                  disabled={!canEdit || update.isPending}
                  aria-pressed={isCurrent}
                  onClick={() => {
                    setStatus(step.id);
                  }}
                  className={
                    isCurrent
                      ? 'h-8 rounded-sm border border-flare bg-flare-subtle px-3 text-base font-medium text-flare-on-subtle'
                      : 'h-8 rounded-sm border border-border px-3 text-base text-muted hover:border-border-strong hover:text-fg disabled:cursor-not-allowed disabled:opacity-50'
                  }
                >
                  {step.label}
                </button>
              );
            })}
            <span className="mx-1 h-4 w-px bg-border" aria-hidden />
            <button
              type="button"
              disabled={!canEdit || update.isPending}
              aria-pressed={lead.status === 'unqualified'}
              onClick={() => {
                setStatus('unqualified');
              }}
              className={
                lead.status === 'unqualified'
                  ? 'h-8 rounded-sm border border-danger bg-danger-subtle px-3 text-base font-medium text-danger'
                  : 'h-8 rounded-sm border border-border px-3 text-base text-muted hover:border-border-strong hover:text-fg disabled:cursor-not-allowed disabled:opacity-50'
              }
            >
              Unqualified
            </button>
            {canConvert && (
              <Button
                variant="primary"
                size="sm"
                icon={ArrowRight}
                className="ml-auto"
                onClick={() => {
                  setConverting(true);
                }}
              >
                Convert to contact and deal
              </Button>
            )}
          </div>
        </Panel>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-3">
          <Tabs
            tabs={[
              { id: 'timeline', label: 'Timeline' },
              { id: 'notes', label: 'Notes' },
            ]}
            value={active}
            onChange={(id) => {
              setTab(id === 'timeline' ? undefined : id);
            }}
            ariaLabel="Lead sections"
          />
          {active === 'timeline' ? (
            <LeadTimelineTab leadId={lead.id} />
          ) : (
            <NotesPanel parent="lead" id={lead.id} canCreate={perms.has('note:create')} />
          )}
        </div>

        <aside className="flex min-w-0 flex-col gap-3">
          <Panel title="Details">
            <DetailList
              items={[
                { label: 'Phone', value: <PhoneNumber e164={lead.phone} actions /> },
                {
                  label: 'Email',
                  value:
                    lead.email === null ? (
                      <span className="text-faint">Not set</span>
                    ) : (
                      <a
                        href={`mailto:${lead.email}`}
                        className="break-all underline-offset-2 hover:underline"
                      >
                        {lead.email}
                      </a>
                    ),
                },
                {
                  label: 'Company',
                  value: lead.companyName ?? <span className="text-faint">Not set</span>,
                },
                { label: 'Source', value: lead.source },
                {
                  label: 'Source ref',
                  value: lead.sourceRef ?? <span className="text-faint">None</span>,
                },
                {
                  label: 'Owner',
                  value:
                    lead.owner === null ? (
                      <span className="text-faint">Unassigned</span>
                    ) : (
                      <span className="flex items-center gap-1.5">
                        <Avatar name={lead.owner.name} seed={lead.owner.id} size={18} />
                        {lead.owner.name}
                      </span>
                    ),
                },
                { label: 'Created', value: <DateTime value={lead.createdAt} /> },
                { label: 'Updated', value: <DateTime value={lead.updatedAt} /> },
              ]}
            />
          </Panel>

          {lead.notes !== null && lead.notes !== '' && (
            <Panel
              title="Lead notes"
              note="Captured when the lead was created. Later notes are on the Notes tab."
            >
              <p className="whitespace-pre-wrap text-base text-muted">{lead.notes}</p>
            </Panel>
          )}

          <LeadCustomFields values={lead.customFields} />
        </aside>
      </div>

      <LeadFormDrawer open={editing} onOpenChange={setEditing} lead={lead} />
      <ConvertLeadDialog open={converting} onOpenChange={setConverting} lead={lead} />

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete ${leadName(lead)}?`}
        description="The lead is soft deleted and leaves the list."
        confirmLabel="Delete lead"
        consequences={
          converted
            ? ['The contact and deal created from this lead are kept']
            : ['Nothing has been created from this lead yet']
        }
        loading={remove.isPending}
        onConfirm={() => {
          remove.mutate(lead.id, {
            onSuccess: () => {
              toast({ tone: 'success', title: 'Lead deleted' });
              void navigate({ to: '/leads' });
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

function LeadCustomFields({ values }: { values: Record<string, unknown> }) {
  const definitions = useCustomFields('lead');
  if ((definitions.data ?? []).length === 0) return null;
  return <CustomFieldsPanel definitions={definitions.data ?? []} values={values} />;
}

function LeadTimelineTab({ leadId }: { leadId: string }) {
  const [filter, setFilter] = useState('all');
  const [q, setQ] = useState('');
  const debounced = useDebounced(q, 250);
  const query = useTimeline('lead', leadId, {
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
      emptyTitle="Nothing on this lead yet"
      emptyDescription="Calls and notes on the lead land here until it is converted."
    />
  );
}

export { LeadDetailScreen as default };
