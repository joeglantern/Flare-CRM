/**
 * Calls list and Missed calls (Calls · Calls list / Missed calls).
 * One screen with two modes: the missed view filters to inbound misses and swaps the last column
 * for the callback action. Scope tabs are role aware — an agent only ever sees `mine=true`.
 */
import type { CallDto } from '@crm/shared';
import { useNavigate } from '@tanstack/react-router';
import { Check, Download, Grid3x3, Phone } from 'lucide-react';
import { useState } from 'react';
import { Avatar } from '@/components/ui/Avatar';
import { Button, IconButton } from '@/components/ui/Button';
import { Segmented } from '@/components/ui/Toggle';
import { DataTable, type Column } from '@/components/data/DataTable';
import { DateTime, Duration } from '@/components/data/formatters';
import { PhoneNumber } from '@/components/data/PhoneNumber';
import { CallDirection, CallStatusBadge, RecordingBadge } from '@/components/data/status';
import {
  DateRangePicker,
  FilterBar,
  FilterChip,
  presetRange,
  type DateRange,
} from '@/components/filters/FilterBar';
import { ExportDialog } from '@/components/filters/ExportDialog';
import { PageHeader } from '@/app/shell/TopBar';
import { usePageMeta } from '@/app/shell/page-meta';
import { useDispositions } from '@/features/telephony/api';
import { Dialpad } from '@/features/telephony/Dialpad';
import { linkTo } from '@/lib/links';
import { useListState } from '@/lib/list-state';
import { viewStateOf, errorInfo } from '@/lib/view-state';
import { useAssignableUsers } from '@/features/users/api';
import { usePermissions } from '@/providers/permissions';
import { useSocketState } from '@/providers/socket';
import { useCalls, type CallFilters } from './api';

export function CallsListScreen({ missed = false }: { missed?: boolean }) {
  usePageMeta(
    missed ? [{ label: 'Calls', href: '/calls' }, { label: 'Missed' }] : [{ label: 'Calls' }],
  );
  const perms = usePermissions();
  const navigate = useNavigate();
  const { online } = useSocketState();
  const users = useAssignableUsers();
  const dispositions = useDispositions();
  const list = useListState<CallFilters>({ sort: '-startedAt' });
  const [range, setRange] = useState<DateRange>(() => presetRange('30d'));
  const [dialpadOpen, setDialpadOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);

  const scope =
    list.filters.mine === 'true' ? 'mine' : list.filters.userId !== undefined ? 'agent' : 'all';
  // there is no call:read_team permission; a wider scope is a role question (docs/07)
  const canSeeAll = perms.isAdmin || perms.isManager;

  const filters: CallFilters = {
    ...list.queryParams,
    from: range.from,
    to: range.to,
    ...(missed ? { status: 'missed', direction: 'inbound' } : {}),
    ...(canSeeAll ? {} : { mine: 'true' }),
  };

  const canRead = perms.has('call:read');
  const query = useCalls(filters, canRead);
  const rows = query.data?.data ?? [];
  const state = viewStateOf({
    allowed: canRead,
    online,
    isPending: query.isPending,
    isError: query.isError,
    error: query.error,
    count: rows.length,
  });

  const columns: Column<CallDto>[] = [
    {
      key: 'direction',
      header: 'Direction',
      width: '120px',
      render: (c) => <CallDirection direction={c.direction} />,
    },
    {
      key: 'party',
      header: 'Contact',
      width: '1.6fr',
      render: (c) => (
        <span className="flex min-w-0 items-center gap-2">
          {c.contact !== null ? (
            <>
              <Avatar name={c.contact.displayName} seed={c.contact.id} size={20} />
              <span className="truncate font-medium">{c.contact.displayName}</span>
            </>
          ) : (
            <span className="truncate text-muted">Unknown number</span>
          )}
        </span>
      ),
    },
    {
      key: 'number',
      header: 'Number',
      width: '1.2fr',
      hideable: true,
      render: (c) => (
        <PhoneNumber
          e164={c.externalNumber}
          display={c.externalDisplay}
          contactId={c.contactId}
          contactName={c.contact?.displayName}
          actions
        />
      ),
    },
    {
      key: 'agent',
      header: 'Agent',
      width: '1fr',
      hideable: true,
      render: (c) =>
        c.user !== null ? (
          <span className="flex min-w-0 items-center gap-1.5 text-muted">
            <Avatar name={c.user.name} seed={c.user.id} size={18} />
            <span className="truncate">{c.user.name}</span>
          </span>
        ) : (
          <span className="text-faint">{c.extension ?? 'Ring group'}</span>
        ),
    },
    {
      key: 'extension',
      header: 'Ext',
      width: '70px',
      hideable: true,
      optional: true,
      render: (c) => <span className="mono text-muted">{c.extension ?? '—'}</span>,
    },
    {
      key: 'startedAt',
      header: 'Started',
      width: '1.1fr',
      sortable: true,
      render: (c) => (
        <span className="text-muted">
          <DateTime value={c.startedAt} />
        </span>
      ),
    },
    {
      key: 'talkDurationSec',
      header: 'Talk',
      width: '80px',
      align: 'end',
      sortable: true,
      hideable: true,
      render: (c) => <Duration seconds={c.talkDurationSec} />,
    },
    ...(missed
      ? []
      : [
          {
            key: 'disposition',
            header: 'Disposition',
            width: '1.1fr',
            hideable: true,
            render: (c: CallDto) =>
              c.disposition !== null ? (
                <span className="truncate">{c.disposition.name}</span>
              ) : (
                <span className="text-faint">Not set</span>
              ),
          } satisfies Column<CallDto>,
        ]),
    {
      key: 'status',
      header: missed ? 'Callback' : 'Status',
      width: '1.2fr',
      align: 'end',
      render: (c) =>
        missed ? (
          <span className="flex items-center justify-end gap-1.5">
            {c.externalNumber !== null && (
              <PhoneNumber
                e164={c.externalNumber}
                contactId={c.contactId}
                contactName={c.contact?.displayName}
                actions
                layout="tooltip"
                className="hidden"
              />
            )}
            <Button
              size="sm"
              variant="secondary"
              icon={Phone}
              onClick={(e) => {
                e.stopPropagation();
                void navigate(linkTo.call(c.id));
              }}
            >
              Call back
            </Button>
          </span>
        ) : (
          <span className="flex items-center justify-end gap-1.5">
            {c.recordingStatus === 'stored' && <RecordingBadge />}
            <CallStatusBadge status={c.status} />
          </span>
        ),
    },
  ];

  return (
    <div className="flex flex-col gap-4 p-6">
      <PageHeader
        title={missed ? 'Missed calls' : 'Calls'}
        description={
          missed
            ? 'Inbound calls nobody answered. Call back, or open the call to log why.'
            : 'Every call the PBX logged: inbound, outbound, missed and internal.'
        }
        actions={
          <>
            {perms.has('call:export') && (
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
            {perms.has('call:dial') && (
              <Button
                variant="primary"
                icon={Grid3x3}
                onClick={() => {
                  setDialpadOpen(true);
                }}
              >
                Dialpad
              </Button>
            )}
          </>
        }
      />

      <FilterBar
        search={list.filters.number ?? ''}
        onSearchChange={(v) => {
          list.set({ number: v === '' ? undefined : v });
        }}
        searchPlaceholder="Search by number"
        activeCount={list.activeCount}
        onClear={list.reset}
        savedViewsKey={missed ? 'calls-missed' : 'calls'}
        right={<DateRangePicker value={range} onChange={setRange} />}
      >
        {canSeeAll && (
          <Segmented
            ariaLabel="Scope"
            value={scope}
            onChange={(v) => {
              list.set({
                mine: v === 'mine' ? 'true' : undefined,
                userId: undefined,
              });
            }}
            options={[
              { value: 'mine', label: 'Mine' },
              { value: 'all', label: 'All' },
            ]}
          />
        )}
        {!missed && (
          <FilterChip
            label="Direction"
            value={list.filters.direction}
            onChange={(v) => {
              list.set({ direction: v });
            }}
            options={[
              { value: 'inbound', label: 'Inbound' },
              { value: 'outbound', label: 'Outbound' },
              { value: 'internal', label: 'Internal' },
            ]}
          />
        )}
        {!missed && (
          <FilterChip
            label="Status"
            value={list.filters.status}
            onChange={(v) => {
              list.set({ status: v });
            }}
            options={[
              { value: 'answered', label: 'Answered' },
              { value: 'missed', label: 'Missed' },
              { value: 'busy', label: 'Busy' },
              { value: 'failed', label: 'Failed' },
              { value: 'no_answer', label: 'No answer' },
              { value: 'voicemail', label: 'Voicemail' },
            ]}
          />
        )}
        {canSeeAll && (
          <FilterChip
            label="Agent"
            value={list.filters.userId}
            onChange={(v) => {
              list.set({ userId: v, mine: undefined });
            }}
            options={(users.data ?? []).map((u) => ({ value: u.id, label: u.name }))}
          />
        )}
        <FilterChip
          label="Recording"
          value={list.filters.hasRecording}
          onChange={(v) => {
            list.set({ hasRecording: v as 'true' | 'false' | undefined });
          }}
          options={[
            { value: 'true', label: 'Has a recording' },
            { value: 'false', label: 'No recording' },
          ]}
        />
        {!missed && dispositions.data !== undefined && dispositions.data.length > 0 && (
          <FilterChip
            label="Unmatched"
            value={list.filters.unmatched}
            onChange={(v) => {
              list.set({ unmatched: v as 'true' | undefined });
            }}
            options={[{ value: 'true', label: 'No contact linked' }]}
          />
        )}
      </FilterBar>

      <DataTable
        tableId={missed ? 'calls-missed' : 'calls'}
        ariaLabel={missed ? 'Missed calls' : 'Calls'}
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
          void navigate(linkTo.call(c.id));
        }}
        onRetry={() => {
          void query.refetch();
        }}
        error={errorInfo(query.error)}
        forbidden={{
          permission: 'call:read',
          what: 'Calls',
        }}
        emptyState={
          missed
            ? {
                object: 'checkmark',
                title: 'No missed calls to handle',
                description:
                  'Every missed call has been called back or logged. New ones appear here the moment call:logged arrives.',
              }
            : {
                object: 'handset',
                title: 'No calls in this range',
                description:
                  'Calls appear here the moment the PBX logs them. Inbound, outbound, missed and internal.',
                ...(perms.has('call:dial')
                  ? {
                      primaryAction: {
                        label: 'Open dialpad',
                        onClick: () => {
                          setDialpadOpen(true);
                        },
                      },
                    }
                  : {}),
              }
        }
        endpoint={
          missed
            ? 'GET /calls?status=missed&direction=inbound&from=&to=&sort=-startedAt'
            : `GET /calls?${canSeeAll ? '' : 'mine=true&'}from=&to=&sort=-startedAt`
        }
      />

      <Dialpad open={dialpadOpen} onOpenChange={setDialpadOpen} />
      <ExportDialog
        open={exportOpen}
        onOpenChange={setExportOpen}
        entity="calls"
        filters={filters}
        estimatedCount={query.data?.page.total}
        filterSummary={`${range.from.slice(0, 10)} → ${range.to.slice(0, 10)}${missed ? ' · missed · inbound' : ''}`}
      />
    </div>
  );
}

export { Check, IconButton };
