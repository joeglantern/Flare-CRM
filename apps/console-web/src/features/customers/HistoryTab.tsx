/**
 * Every document we have signed for this customer, and what their stack did with it. A rejection
 * keeps its reason, which is the only place to find out that a stack is holding an old key.
 */
import { Table, IssueStatusBadge, type Column } from '@/components/Bits';
import { EmptyState, Section } from '@/components/Page';
import { dateTime } from '@/lib/format';
import type { Issue } from '@/lib/types';

export function HistoryTab({ issues }: { issues: Issue[] }) {
  const columns: Column<Issue>[] = [
    { key: 'issued', header: 'Issued', cell: (i) => dateTime(i.issuedAt) },
    {
      key: 'stack',
      header: 'Stack',
      cell: (i) => <code className="mono text-xs">{i.stackId}</code>,
    },
    { key: 'status', header: 'Status', cell: (i) => <IssueStatusBadge status={i.status} /> },
    {
      key: 'delivered',
      header: 'Delivered',
      cell: (i) => <span className="text-sm text-muted">{dateTime(i.deliveredAt)}</span>,
    },
    {
      key: 'acked',
      header: 'Applied',
      cell: (i) => <span className="text-sm text-muted">{dateTime(i.ackedAt)}</span>,
    },
    {
      key: 'reason',
      header: 'Reason',
      cell: (i) =>
        i.rejectReason === null ? (
          <span className="text-muted">—</span>
        ) : (
          <span className="text-base text-danger">{i.rejectReason}</span>
        ),
    },
  ];

  return (
    <Section title="Issued documents" description="Newest first, twenty at a time.">
      {issues.length === 0 ? (
        <EmptyState
          title="Nothing issued yet"
          description="Save what this customer is entitled to, then issue it."
        />
      ) : (
        <Table
          caption="Entitlements documents issued to this customer"
          columns={columns}
          rows={issues}
          rowKey={(i) => i.id}
        />
      )}
    </Section>
  );
}
