/**
 * The console's landing page: the whole fleet in one screen.
 *
 * It answers, in the order an owner asks them: is everything up, how many customers are there and
 * what are they paying, how close is anyone to the limits they bought, what are they running, what
 * is about to run out, and what needs attention today.
 *
 * Nothing here is any customer's business data. Every figure is a count the console holds itself or
 * a sample a stack reported about its own size (docs/21): seats, bytes, minutes connected, versions
 * and money agreed.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Activity } from 'lucide-react';
import { useCallback } from 'react';
import {
  alertCopy,
  type AlertDto,
  type ConsoleOverviewDto,
  type RevenueAnalyticsDto,
} from '@crm/shared';
import { Badge } from '@crm/ui';
import {
  BarChart,
  ChartFrame,
  CountUp,
  EventTimeline,
  RingStat,
  Sparkline,
  TrendChart,
  seriesColor,
  type TimelineEvent,
} from '@crm/ui/charts';
import { Field, Fields, Table, type Column } from '@/components/Bits';
import { EmptyState, PageHeader, Section, StateSlot } from '@/components/Page';
import { http } from '@/lib/api';
import { ago, bytes, count, day, dateTime, daysUntil, money } from '@/lib/format';
import { qk } from '@/lib/query';
import { useConsoleEvent } from '@/lib/socket';
import {
  bytesLabel,
  compactCount,
  compactMoneyLabel,
  deltaOver,
  moneyLabel,
  pairTable,
  seriesTable,
  share,
  wholeCount,
} from './metrics';

/** The window the fleet screen also asks for, so both screens read one cached payload. */
const OVERVIEW_DAYS = 30;
const REVENUE_MONTHS = 12;
/** A week is the shortest window in which a fleet this size actually moves. */
const DELTA_DAYS = 7;

export function OverviewScreen() {
  const queryClient = useQueryClient();
  const overview = useQuery({
    queryKey: qk.overview(OVERVIEW_DAYS),
    queryFn: () =>
      http.get<ConsoleOverviewDto>('/api/v1/analytics/overview', { days: OVERVIEW_DAYS }),
  });

  /**
   * An alert opened or closed while this screen was open. The fleet screen patches its rows from the
   * event because a heartbeat carries the whole row; this one refetches, because the event carries a
   * summary rather than the alert the list renders, and an Attention list assembled from a summary
   * would be the console's own guess at what is wrong rather than what the server computed. Alerts
   * are rare enough that one request each is cheaper than being wrong.
   */
  const onAlert = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: qk.overview(OVERVIEW_DAYS) });
  }, [queryClient]);
  useConsoleEvent('alert:changed', onAlert);

  return (
    <>
      <PageHeader
        title="Overview"
        description={`The fleet over the last ${OVERVIEW_DAYS} days, from what each stack reports about itself.`}
        actions={
          overview.data === undefined ? undefined : (
            <span className="text-sm text-faint">Computed {ago(overview.data.generatedAt)}</span>
          )
        }
      />

      <StateSlot
        isPending={overview.isPending}
        error={overview.error}
        onRetry={() => {
          void overview.refetch();
        }}
      >
        {overview.data !== undefined &&
          (overview.data.hasData ? (
            <Dashboard data={overview.data} />
          ) : (
            <NothingReportedYet data={overview.data} />
          ))}
      </StateSlot>
    </>
  );
}

/**
 * Before the first stack connects there is nothing measured to draw, and a screen of empty charts
 * would imply there was. It says what is missing and what will appear, and counts what we do know.
 */
function NothingReportedYet({ data }: { data: ConsoleOverviewDto }) {
  const { customers, stacks } = data.now;
  return (
    <Section>
      <EmptyState
        icon={Activity}
        title="No stack has reported in yet"
        description={
          <>
            {customers === 0
              ? 'Add a customer, create its stack, and paste the environment lines onto their server.'
              : `${count(customers, 'customer')} and ${count(stacks, 'stack')} set up so far. A stack starts sending a sample every five minutes as soon as it can reach the console.`}{' '}
            Seats and storage against what was sold, uptime, version spread and what is about to
            expire all appear here once the first samples arrive.
          </>
        }
        action={<Link to="/customers">See every customer</Link>}
      />
    </Section>
  );
}

function Dashboard({ data }: { data: ConsoleOverviewDto }) {
  const { now, series } = data;
  const fullMoney = moneyLabel(now.currency);

  return (
    <>
      <Section>
        <div className="grid gap-x-8 gap-y-6 sm:grid-cols-3">
          <ChartFrame
            label="Live now"
            value={<CountUp value={now.customersLive} format={wholeCount} />}
            delta={deltaOver(series.live, DELTA_DAYS, 'up')}
            footnote={`of ${count(now.stacks, 'stack')} across ${count(now.customers, 'customer')}`}
            table={seriesTable(
              'Customers with a live stack per day',
              'Live',
              series.live,
              wholeCount,
            )}
          >
            <Sparkline points={series.live} height={34} />
          </ChartFrame>

          <ChartFrame
            label="Customers"
            value={<CountUp value={now.customers} format={wholeCount} />}
            delta={deltaOver(series.customers, DELTA_DAYS, 'up')}
            footnote={`${wholeCount(now.customersActive)} active`}
            table={seriesTable('Customers per day', 'Customers', series.customers, wholeCount)}
          >
            <Sparkline points={series.customers} height={34} color={seriesColor(1)} />
          </ChartFrame>

          <ChartFrame
            label="Monthly recurring revenue"
            value={<CountUp value={now.mrrMinor} format={fullMoney} />}
            delta={deltaOver(series.mrrMinor, DELTA_DAYS, 'up')}
            footnote={`${fullMoney(now.arpuMinor)} per customer`}
            table={seriesTable(
              'Monthly recurring revenue per day',
              'MRR',
              series.mrrMinor,
              fullMoney,
            )}
          >
            <Sparkline points={series.mrrMinor} height={34} color={seriesColor(2)} />
          </ChartFrame>
        </div>
      </Section>

      <div className="grid items-start gap-5 lg:grid-cols-2">
        <Section>
          <ChartFrame
            label="Seats in use"
            value={<CountUp value={now.seats.used} format={wholeCount} />}
            delta={deltaOver(series.seatsUsed, DELTA_DAYS)}
            legend={[
              { label: 'In use', color: seriesColor(0) },
              { label: 'Sold', color: seriesColor(1), dashed: true },
            ]}
            footnote={seatsFootnote(now.seats)}
            table={pairTable(
              'Seats in use and seats sold per day',
              ['In use', 'Sold'],
              series.seatsUsed,
              series.seatsSold,
              wholeCount,
            )}
          >
            <TrendChart
              format={wholeCount}
              inspectLabel="Inspect seats by day"
              emptyLabel="No seat samples yet"
              series={[
                { key: 'used', label: 'In use', points: series.seatsUsed },
                { key: 'sold', label: 'Sold', points: series.seatsSold, dashed: true },
              ]}
            />
          </ChartFrame>
        </Section>

        <Section>
          <ChartFrame
            label="Storage in use"
            value={<CountUp value={now.storage.usedBytes} format={bytesLabel} />}
            delta={deltaOver(series.storageBytes, DELTA_DAYS)}
            footnote={storageFootnote(now.storage)}
            table={seriesTable(
              'Storage in use per day',
              'Storage',
              series.storageBytes,
              bytesLabel,
            )}
          >
            <TrendChart
              format={bytesLabel}
              inspectLabel="Inspect storage by day"
              emptyLabel="No storage samples yet"
              cap={
                now.storage.soldBytes > 0
                  ? { value: now.storage.soldBytes, label: `${bytes(now.storage.soldBytes)} sold` }
                  : null
              }
              series={[{ key: 'used', label: 'In use', points: series.storageBytes }]}
            />
          </ChartFrame>
        </Section>
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-2">
        <RevenueSection currency={now.currency} />

        <Section>
          <ChartFrame
            label="Plan mix"
            table={{
              caption: 'Customers and revenue by plan',
              columns: ['Plan', 'Customers', 'Monthly revenue'],
              rows: data.planMix.map((plan) => [
                plan.name,
                plan.customers,
                fullMoney(plan.mrrMinor),
              ]),
            }}
          >
            <RingStat
              slices={data.planMix.map((plan) => ({ label: plan.name, value: plan.customers }))}
              value={<CountUp value={now.customers} format={wholeCount} />}
              caption={now.customers === 1 ? 'customer' : 'customers'}
              format={compactCount}
              emptyLabel="No plans sold yet"
            />
          </ChartFrame>
        </Section>
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-2">
        <Section>
          <ChartFrame
            label="Version spread"
            value={<CountUp value={data.versions.length} format={wholeCount} />}
            footnote={
              data.versions.length > 1
                ? 'More than one version is running. The oldest is the one to chase.'
                : 'Every stack that has reported is on the same version.'
            }
            table={{
              caption: 'Stacks per version',
              columns: ['Version', 'Stacks'],
              rows: data.versions.map((entry) => [entry.version, entry.stacks]),
            }}
          >
            <BarChart
              orientation="horizontal"
              categories={data.versions.map((entry) => entry.version)}
              series={[
                {
                  key: 'stacks',
                  label: 'Stacks',
                  values: data.versions.map((entry) => entry.stacks),
                },
              ]}
              format={wholeCount}
              emptyLabel="No stack has reported a version yet"
            />
          </ChartFrame>
        </Section>

        <Section
          title="Expiring soon"
          description="Once a plan runs out that customer can read their CRM and change nothing in it."
        >
          <EventTimeline
            events={data.expiring.map((entry) => expiryEvent(entry, now.currency))}
            emptyLabel="Nothing expires in the next month"
          />
        </Section>
      </div>

      <Section
        title="Attention"
        description={
          now.openAlerts === 0
            ? 'Nothing is asking for you.'
            : `${count(now.openAlerts, 'open alert')}, newest first.`
        }
      >
        {data.alerts.length === 0 ? (
          <EmptyState
            title="Nothing needs attention"
            description="Every stack is reporting in, inside its limits, backed up and on a plan that has not run out."
          />
        ) : (
          <Table
            caption="Open alerts across the fleet"
            columns={alertColumns}
            rows={data.alerts}
            rowKey={(alert) => alert.id}
          />
        )}

        {/* How the entitlement documents themselves are going: a rejected one means a stack is
            running on the previous set, which is the kind of thing nobody notices without a figure. */}
        <div className="mt-4 border-t border-border pt-3">
          <p className="mb-2 text-sm font-medium text-muted">Entitlement delivery</p>
          <Fields columns={3}>
            <Field label="Documents pending">{wholeCount(data.delivery.pending)}</Field>
            <Field label="Rejected">
              {data.delivery.rejected === 0 ? (
                wholeCount(0)
              ) : (
                <Badge tone="danger">{wholeCount(data.delivery.rejected)}</Badge>
              )}
            </Field>
            <Field label="Median acknowledgement">
              {data.delivery.medianAckSeconds === null
                ? 'No answers yet'
                : `${wholeCount(data.delivery.medianAckSeconds)}s`}
            </Field>
          </Fields>
        </div>
      </Section>
    </>
  );
}

/**
 * Revenue has its own endpoint because it is months rather than days, and its own state: a failure
 * here must not empty the chart, which would read as a fleet that stopped paying.
 */
function RevenueSection({ currency }: { currency: string }) {
  const revenue = useQuery({
    queryKey: qk.revenue(),
    queryFn: () =>
      http.get<RevenueAnalyticsDto>('/api/v1/analytics/revenue', { months: REVENUE_MONTHS }),
  });

  return (
    <Section>
      <StateSlot
        isPending={revenue.isPending}
        error={revenue.error}
        onRetry={() => {
          void revenue.refetch();
        }}
      >
        {revenue.data !== undefined && <RevenueChart data={revenue.data} fallback={currency} />}
      </StateSlot>
    </Section>
  );
}

function RevenueChart({ data, fallback }: { data: RevenueAnalyticsDto; fallback: string }) {
  const currency = data.currency === '' ? fallback : data.currency;
  const fullMoney = moneyLabel(currency);
  const chartMoney = compactMoneyLabel(currency);

  return (
    <ChartFrame
      label={`Revenue, last ${REVENUE_MONTHS} months`}
      value={<CountUp value={data.mrrMinor} format={fullMoney} />}
      delta={deltaOver(data.months, 1, 'up')}
      footnote={
        data.atRisk.customers === 0
          ? `${fullMoney(data.arpuMinor)} per paying customer, ${count(data.payingCustomers, 'customer')} paying.`
          : `${fullMoney(data.atRisk.minor)} is at risk across ${count(data.atRisk.customers, 'customer')} whose plan ends within ${count(data.atRisk.withinDays, 'day')}.`
      }
      table={{
        caption: 'Monthly recurring revenue by month',
        columns: ['Month', 'Revenue'],
        rows: data.months.map((point) => [day(point.t), fullMoney(point.v)]),
      }}
    >
      <TrendChart
        granularity="month"
        format={chartMoney}
        inspectLabel="Inspect revenue by month"
        emptyLabel="No month has closed yet"
        series={[{ key: 'mrr', label: 'Revenue', points: data.months }]}
      />
    </ChartFrame>
  );
}

function seatsFootnote(seats: ConsoleOverviewDto['now']['seats']): string {
  const filled = share(seats.used, seats.sold);
  const unlimited =
    seats.unlimited === 0 ? '' : ` ${count(seats.unlimited, 'customer')} on an unlimited plan.`;
  if (filled === null) return `Nothing sold with a seat limit.${unlimited}`;
  return `${wholeCount(seats.used)} of ${wholeCount(seats.sold)} sold, ${filled}% taken.${unlimited}`;
}

function storageFootnote(storage: ConsoleOverviewDto['now']['storage']): string {
  const filled = share(storage.usedBytes, storage.soldBytes);
  const unlimited =
    storage.unlimited === 0 ? '' : ` ${count(storage.unlimited, 'customer')} on an unlimited plan.`;
  if (filled === null) return `Nothing sold with a storage limit.${unlimited}`;
  return `${bytes(storage.usedBytes)} of ${bytes(storage.soldBytes)} sold, ${filled}% used.${unlimited}`;
}

/** A plan running out is the one thing on this screen that is about the future, so it leads with when. */
function expiryEvent(
  entry: ConsoleOverviewDto['expiring'][number],
  currency: string,
): TimelineEvent {
  const days = daysUntil(entry.expiresAt) ?? entry.days;
  return {
    id: entry.customerId,
    when: day(entry.expiresAt),
    label: entry.name,
    detail: entry.mrrMinor === 0 ? null : `${money(entry.mrrMinor, currency)} a month`,
    lead: days < 0 ? 'expired' : days === 0 ? 'today' : `in ${count(days, 'day')}`,
    tone: days <= 0 ? 'danger' : days <= 14 ? 'warning' : 'neutral',
  };
}

const LEVEL_TONE = { info: 'info', warning: 'warning', danger: 'danger' } as const;

const alertColumns: Column<AlertDto>[] = [
  {
    key: 'what',
    header: 'What',
    cell: (alert) => (
      <span className="flex flex-col items-start gap-0.5">
        <Badge tone={LEVEL_TONE[alert.level]} dot>
          {alertCopy(alert.kind).label}
        </Badge>
        <span className="text-sm text-muted">{alertCopy(alert.kind).description}</span>
      </span>
    ),
  },
  {
    key: 'customer',
    header: 'Customer',
    cell: (alert) => (
      <Link to="/customers/$customerId" params={{ customerId: alert.customerId }}>
        {alert.customerName}
      </Link>
    ),
  },
  {
    key: 'opened',
    header: 'Since',
    align: 'end',
    cell: (alert) => (
      <span className="text-sm text-muted" title={dateTime(alert.openedAt)}>
        {ago(alert.openedAt)}
      </span>
    ),
  },
];
