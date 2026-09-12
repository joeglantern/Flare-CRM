/**
 * Every document we have signed for this customer, and what their stack did with it. A rejection
 * keeps its reason, which is the only place to find out that a stack is holding an old key.
 *
 * Paged from the server rather than handed the twenty the customer screen already fetched: the
 * customers worth reading this tab about are the ones who have been here longest, and they are
 * exactly the ones whose history does not fit in twenty rows.
 */
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Pager, Table, IssueStatusBadge, type Column } from '@/components/Bits';
import { EmptyState, Section, StateSlot } from '@/components/Page';
import { http } from '@/lib/api';
import { dateTime } from '@/lib/format';
import { qk } from '@/lib/query';
import type { Issue } from '@/lib/types';

const PAGE_SIZE = 20;

export function HistoryTab({ customerId }: { customerId: string }) {
  const [page, setPage] = useState(1);
  const issues = useQuery({
    queryKey: qk.customerIssues(customerId, page),
    queryFn: () =>
      http.list<Issue>(`/api/v1/customers/${customerId}/issues`, { page, pageSize: PAGE_SIZE }),
  });

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

  const rows = issues.data?.data ?? [];
  const total = issues.data?.page.total ?? 0;

  return (
    <Section
      title="Issued documents"
      description={total === 0 ? 'Newest first.' : `Newest first. ${String(total)} in all.`}
    >
      <StateSlot
        isPending={issues.isPending}
        error={issues.error}
        isEmpty={rows.length === 0}
        empty={
          <EmptyState
            title="Nothing issued yet"
            description="Save what this customer is entitled to, then issue it."
          />
        }
        onRetry={() => {
          void issues.refetch();
        }}
      >
        <Table
          caption="Entitlements documents issued to this customer"
          columns={columns}
          rows={rows}
          rowKey={(i) => i.id}
        />
        <div className="mt-3">
          <Pager
            page={page}
            pageSize={PAGE_SIZE}
            total={total}
            onChange={setPage}
            noun="documents"
          />
        </div>
      </StateSlot>
    </Section>
  );
}
