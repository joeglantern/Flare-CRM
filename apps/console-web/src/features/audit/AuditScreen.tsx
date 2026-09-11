/**
 * Everything anyone has done in this console, which the database will not let anyone edit or delete.
 * When a customer asks why a feature stopped working, this is the answer.
 */
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Badge, Input, Select } from '@crm/ui';
import { Pager, Table, type Column } from '@/components/Bits';
import { EmptyState, PageHeader, StateSlot } from '@/components/Page';
import { http } from '@/lib/api';
import { dateTime } from '@/lib/format';
import { qk } from '@/lib/query';
import type { AuditRow } from '@/lib/types';

const ACTIONS = [
  { value: '', label: 'Everything' },
  { value: 'customer', label: 'Customers' },
  { value: 'entitlement', label: 'Entitlements' },
  { value: 'plan', label: 'Plans' },
  { value: 'stack', label: 'Stacks' },
  { value: 'owner', label: 'Owners' },
  { value: 'settings', label: 'Settings' },
  { value: 'access.denied', label: 'Refused requests' },
];

const PAGE_SIZE = 50;

export function AuditScreen() {
  const [action, setAction] = useState('');
  const [entityId, setEntityId] = useState('');
  const [page, setPage] = useState(1);

  const filter = { action, entityId: entityId.trim(), page };
  const audit = useQuery({
    queryKey: qk.audit(filter),
    queryFn: () =>
      http.list<AuditRow>('/api/v1/audit', {
        page,
        pageSize: PAGE_SIZE,
        ...(action === '' ? {} : { action }),
        ...(entityId.trim() === '' ? {} : { entityId: entityId.trim() }),
      }),
  });

  const columns: Column<AuditRow>[] = [
    { key: 'when', header: 'When', cell: (row) => dateTime(row.createdAt) },
    {
      key: 'who',
      header: 'Who',
      cell: (row) =>
        row.actorName ?? (row.actorType === 'system' ? <Badge tone="neutral">System</Badge> : '—'),
    },
    {
      key: 'action',
      header: 'Action',
      cell: (row) => <code className="mono text-xs">{row.action}</code>,
    },
    {
      key: 'what',
      header: 'On',
      cell: (row) => (
        <span className="flex flex-col">
          <span className="text-base">{row.entity}</span>
          {row.entityId !== null && (
            <button
              type="button"
              className="mono text-left text-xs text-flare-link underline underline-offset-2"
              onClick={() => {
                setEntityId(row.entityId ?? '');
                setPage(1);
              }}
            >
              {row.entityId}
            </button>
          )}
        </span>
      ),
    },
    { key: 'change', header: 'Change', cell: (row) => <Change row={row} /> },
  ];

  const total = audit.data?.page.total ?? 0;

  return (
    <>
      <PageHeader
        title="Audit"
        description="Append-only: the database refuses updates and deletes on this table."
        actions={
          <>
            <Select
              ariaLabel="Filter by action"
              value={action}
              onChange={(v) => {
                setAction(v);
                setPage(1);
              }}
              options={ACTIONS}
              className="w-44"
            />
            <Input
              placeholder="Filter by id"
              mono
              containerClassName="w-56"
              value={entityId}
              onChange={(e) => {
                setEntityId(e.target.value);
                setPage(1);
              }}
            />
          </>
        }
      />

      <StateSlot
        isPending={audit.isPending}
        error={audit.error}
        isEmpty={audit.data?.data.length === 0}
        empty={<EmptyState title="Nothing recorded for that" description="Try a wider filter." />}
        onRetry={() => {
          void audit.refetch();
        }}
      >
        <div className="rounded-md border border-border bg-surface">
          <Table
            caption="Console audit log"
            columns={columns}
            rows={audit.data?.data ?? []}
            rowKey={(row) => row.id}
          />
        </div>
        <Pager
          page={page}
          pageSize={PAGE_SIZE}
          total={total}
          onChange={setPage}
          labels={{ previous: 'Newer', next: 'Older' }}
        />
      </StateSlot>
    </>
  );
}

/** Before and after are stored as JSON; showing the keys that differ is more use than a blob. */
function Change({ row }: { row: AuditRow }) {
  const [open, setOpen] = useState(false);
  const before = row.before as Record<string, unknown> | null;
  const after = row.after as Record<string, unknown> | null;
  if (before === null && after === null) return <span className="text-muted">—</span>;
  const keys = [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])].filter(
    (k) => JSON.stringify(before?.[k]) !== JSON.stringify(after?.[k]),
  );
  return (
    <span className="flex flex-col items-start gap-1">
      <span className="text-sm text-muted">
        {keys.length === 0 ? 'no field changes' : keys.join(', ')}
      </span>
      <button
        type="button"
        className="text-sm text-flare-link underline underline-offset-2"
        onClick={() => {
          setOpen(!open);
        }}
      >
        {open ? 'Hide detail' : 'Show detail'}
      </button>
      {open && (
        <pre className="mono max-w-md overflow-x-auto rounded-sm border border-border bg-bg p-2 text-xs">
          {JSON.stringify({ before, after }, null, 2)}
        </pre>
      )}
    </span>
  );
}
