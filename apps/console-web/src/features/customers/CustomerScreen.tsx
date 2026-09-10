/**
 * One customer: who they are, how their stack has been behaving, what they are entitled to, what we
 * have told them, and how to unlock one of their people. Six tabs because those are six different
 * jobs, and an owner is usually doing exactly one of them.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { useCallback, useState } from 'react';
import type { ConsoleServerPayload } from '@crm/shared';
import { Badge, Tabs, toast } from '@crm/ui';
import { StatusDot } from '@/components/Bits';
import { PageHeader, StateSlot } from '@/components/Page';
import { customerRoute } from '@/app/router';
import { CustomerInsights } from '@/features/analytics/CustomerInsights';
import { http } from '@/lib/api';
import { qk } from '@/lib/query';
import { useConsoleEvent } from '@/lib/socket';
import type { CustomerDetail, CustomerEntitlements } from '@/lib/types';
import { AnnounceTab } from './AnnounceTab';
import { EntitlementsTab } from './EntitlementsTab';
import { HistoryTab } from './HistoryTab';
import { OverviewTab } from './OverviewTab';
import { SupportTab } from './SupportTab';

type TabId = 'overview' | 'insights' | 'entitlements' | 'announce' | 'support' | 'history';

export function CustomerScreen() {
  const { customerId } = customerRoute.useParams();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<TabId>('overview');

  const detail = useQuery({
    queryKey: qk.customer(customerId),
    queryFn: () => http.get<CustomerDetail>(`/api/v1/customers/${customerId}`),
  });
  const entitlements = useQuery({
    queryKey: qk.entitlements(customerId),
    queryFn: () => http.get<CustomerEntitlements>(`/api/v1/customers/${customerId}/entitlements`),
  });

  /** A stack of this customer's changed state: the detail tab shows it, so refresh that row. */
  const onStack = useCallback(
    (event: ConsoleServerPayload<'fleet:stack'>) => {
      if (event.customerId !== customerId) return;
      void queryClient.invalidateQueries({ queryKey: qk.customer(customerId) });
    },
    [customerId, queryClient],
  );
  useConsoleEvent('fleet:stack', onStack);

  /** Delivery is the whole point of issuing, so it is reported as it happens. */
  const onIssue = useCallback(
    (event: ConsoleServerPayload<'issue:status'>) => {
      if (event.customerId !== customerId) return;
      void queryClient.invalidateQueries({ queryKey: qk.customer(customerId) });
      if (event.status === 'acked') {
        toast({ tone: 'success', title: 'The stack applied the new entitlements', key: 'issue' });
      } else if (event.status === 'rejected') {
        toast({
          tone: 'danger',
          title: 'The stack refused the document',
          description: event.reason ?? undefined,
          key: 'issue',
          duration: 0,
        });
      }
    },
    [customerId, queryClient],
  );
  useConsoleEvent('issue:status', onIssue);

  const customer = detail.data?.customer;
  const liveStack = detail.data?.stacks.find((s) => s.revokedAt === null && s.connected);

  return (
    <>
      <PageHeader
        back={
          <Link
            to="/fleet"
            className="inline-flex items-center gap-1 text-muted no-underline hover:underline"
          >
            <ArrowLeft size={13} aria-hidden />
            Fleet
          </Link>
        }
        title={customer?.name ?? 'Customer'}
        description={
          customer === undefined ? undefined : (
            <span className="flex flex-wrap items-center gap-3">
              <span className="mono text-sm">
                {customer.customDomain ?? customer.primaryDomain}
              </span>
              <StatusDot connected={liveStack !== undefined} />
              {customer.status !== 'active' && <Badge tone="warning">{customer.status}</Badge>}
            </span>
          )
        }
      />

      <StateSlot
        isPending={detail.isPending || entitlements.isPending}
        error={detail.error ?? entitlements.error}
        onRetry={() => {
          void detail.refetch();
          void entitlements.refetch();
        }}
      >
        {detail.data !== undefined && entitlements.data !== undefined && (
          <>
            <Tabs
              ariaLabel="Customer"
              value={tab}
              onChange={(id) => {
                setTab(id as TabId);
              }}
              tabs={[
                { id: 'overview', label: 'Overview' },
                { id: 'insights', label: 'Insights' },
                { id: 'entitlements', label: 'Entitlements' },
                { id: 'announce', label: 'Announce' },
                { id: 'support', label: 'Support' },
                { id: 'history', label: 'History', count: detail.data.issues.length },
              ]}
            />

            {tab === 'overview' && <OverviewTab detail={detail.data} />}
            {tab === 'insights' && <CustomerInsights customerId={customerId} />}
            {tab === 'entitlements' && (
              <EntitlementsTab
                customerId={customerId}
                entitlements={entitlements.data}
                stacks={detail.data.stacks}
                issues={detail.data.issues}
              />
            )}
            {tab === 'announce' && (
              <AnnounceTab customerId={customerId} connected={liveStack !== undefined} />
            )}
            {tab === 'support' && (
              <SupportTab
                customerId={customerId}
                customerName={detail.data.customer.name}
                connected={liveStack !== undefined}
              />
            )}
            {tab === 'history' && <HistoryTab issues={detail.data.issues} />}
          </>
        )}
      </StateSlot>
    </>
  );
}
