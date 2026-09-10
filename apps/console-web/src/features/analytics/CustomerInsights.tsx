/**
 * One customer's history: what they are using, against what they bought, and how their stack has
 * behaved while doing it.
 *
 * The Overview tab says what is true now. This says what has been true for a month, which is the
 * only way to answer the two questions that matter before a renewal: are they going to run out of
 * something, and has their stack been reliable.
 *
 * Still nothing of theirs: seats, bytes, minutes connected, backups seen, versions run, documents
 * sent (docs/21).
 */
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CircleCheck } from 'lucide-react';
import type { CustomerAnalyticsDto } from '@crm/shared';
import { Badge } from '@crm/ui';
import {
  ChartFrame,
  CountUp,
  EventTimeline,
  HeatStrip,
  TrendChart,
  seriesColor,
  type TimelineEvent,
} from '@crm/ui/charts';
import { Field, Fields } from '@/components/Bits';
import { EmptyState, Section, StateSlot } from '@/components/Page';
import { http } from '@/lib/api';
import { ago, bytes, count, day, dateTime, gigabytes } from '@/lib/format';
import { qk } from '@/lib/query';
import {
  backupCells,
  bytesLabel,
  deltaOver,
  seriesTable,
  uptimeCells,
  uptimeTable,
  UPTIME_MAX,
  wholeCount,
} from './metrics';

const INSIGHT_DAYS = 30;
const DELTA_DAYS = 7;
/** A stack that has not backed up in two days is stale, which is what the alert uses (docs/21). */
const STALE_BACKUP_HOURS = 48;

export function CustomerInsights({ customerId }: { customerId: string }) {
  const insights = useQuery({
    queryKey: qk.customerAnalytics(customerId, INSIGHT_DAYS),
    queryFn: () =>
      http.get<CustomerAnalyticsDto>(`/api/v1/analytics/customers/${customerId}`, {
        days: INSIGHT_DAYS,
      }),
  });

  return (
    <StateSlot
      isPending={insights.isPending}
      error={insights.error}
      onRetry={() => {
        void insights.refetch();
      }}
    >
      {insights.data !== undefined &&
        (insights.data.hasData ? (
          <Insights data={insights.data} />
        ) : (
          <Section>
            <EmptyState
              title="This stack has not reported in yet"
              description="Seats and storage over time, uptime, backups and version history appear here once it connects and starts sending samples."
            />
          </Section>
        ))}
    </StateSlot>
  );
}

function Insights({ data }: { data: CustomerAnalyticsDto }) {
  return (
    <>
      <div className="grid items-start gap-5 lg:grid-cols-2">
        <Section>
          <SeatsChart seats={data.seats} />
        </Section>
        <Section>
          <StorageChart storage={data.storage} />
        </Section>
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-2">
        <Section>
          <UptimeStrip uptime={data.uptime} />
        </Section>
        <Section>
          <BackupStrip backups={data.backups} />
        </Section>
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-2">
        <Section
          title="Version history"
          description="What this stack has been running, most recent first."
        >
          <EventTimeline
            events={[...data.versions].reverse().map(versionEvent)}
            emptyLabel="No version reported yet"
          />
        </Section>

        <Section
          title="Changes"
          description="Entitlements sent, issues raised, and what their stack did about them."
        >
          <EventTimeline
            events={data.events.map(changeEvent)}
            emptyLabel="Nothing has happened on this account yet"
          />
        </Section>
      </div>
    </>
  );
}

function SeatsChart({ seats }: { seats: CustomerAnalyticsDto['seats'] }) {
  const cap = seats.cap;
  const used = seats.latest ?? 0;
  return (
    <ChartFrame
      label="Seats in use"
      value={<CountUp value={used} format={wholeCount} />}
      delta={deltaOver(seats.series, DELTA_DAYS)}
      legend={
        cap === null
          ? undefined
          : [
              { label: 'In use', color: seriesColor(0) },
              { label: 'Plan limit', color: 'var(--text-faint)', dashed: true },
            ]
      }
      footnote={
        cap === null
          ? 'Their plan does not cap seats, so there is nothing to run out of.'
          : `${wholeCount(used)} of ${wholeCount(cap)} allowed. The next sign-up is refused at the limit.`
      }
      table={seriesTable('Seats in use per day', 'Seats', seats.series, wholeCount)}
    >
      <TrendChart
        format={wholeCount}
        inspectLabel="Inspect seats by day"
        emptyLabel="No seat samples yet"
        cap={cap === null ? null : { value: cap, label: `${wholeCount(cap)} allowed` }}
        series={[{ key: 'seats', label: 'In use', points: seats.series }]}
      />
    </ChartFrame>
  );
}

function StorageChart({ storage }: { storage: CustomerAnalyticsDto['storage'] }) {
  const cap = storage.capBytes;
  const used = storage.latestBytes ?? 0;
  const projection = storage.projection;
  return (
    <ChartFrame
      label="Storage in use"
      value={<CountUp value={used} format={bytesLabel} />}
      delta={deltaOver(storage.series, DELTA_DAYS)}
      footnote={
        projection === null
          ? cap === null
            ? 'Their plan does not cap storage.'
            : `${bytes(used)} of ${gigabytes(Math.round(cap / 1024 ** 3))} allowed, and not growing fast enough to project a date.`
          : `Growing by about ${bytes(projection.perDayBytes)} a day. At that rate it is full on ${day(projection.fullOn)}.`
      }
      table={seriesTable('Storage in use per day', 'Storage', storage.series, bytesLabel)}
    >
      <TrendChart
        format={bytesLabel}
        inspectLabel="Inspect storage by day"
        emptyLabel="No storage samples yet"
        cap={cap === null ? null : { value: cap, label: `${bytes(cap)} allowed` }}
        series={[{ key: 'storage', label: 'In use', points: storage.series }]}
      />
    </ChartFrame>
  );
}

function UptimeStrip({ uptime }: { uptime: CustomerAnalyticsDto['uptime'] }) {
  const percent = uptime.percent;
  return (
    <ChartFrame
      label={`Uptime, last ${count(uptime.days.length, 'day')}`}
      value={
        percent === null ? (
          <span className="text-muted">Not measured</span>
        ) : (
          <CountUp value={percent} format={(value) => `${value.toFixed(1)}%`} />
        )
      }
      footnote="One cell per day, darker for more minutes connected. Amber is a day the stack was up but one of its own checks was failing."
      table={uptimeTable(uptime.days)}
    >
      <HeatStrip
        days={uptimeCells(uptime.days)}
        max={UPTIME_MAX}
        format={(minutes) => `${wholeCount(Math.round(minutes / 60))} hours`}
        emptyLabel="No day has been measured yet"
      />
    </ChartFrame>
  );
}

function BackupStrip({ backups }: { backups: CustomerAnalyticsDto['backups'] }) {
  const stale = backups.ageHours === null || backups.ageHours > STALE_BACKUP_HOURS;
  const seen = backups.days.filter((entry) => entry.seen).length;
  return (
    <ChartFrame
      label="Backups"
      value={
        <span className="inline-flex items-center gap-2">
          {backups.lastAt === null ? (
            <span className="text-muted">Never</span>
          ) : (
            ago(backups.lastAt)
          )}
          {stale ? (
            <Badge tone="warning" icon={AlertTriangle}>
              Stale
            </Badge>
          ) : (
            <Badge tone="success" icon={CircleCheck}>
              Fresh
            </Badge>
          )}
        </span>
      }
      footnote={`${count(seen, 'day')} of the last ${backups.days.length} had a backup. Anything over two days old raises an alert.`}
      table={{
        caption: 'Whether a backup ran each day',
        columns: ['Day', 'Backup'],
        rows: backups.days.map((entry) => [day(entry.t), entry.seen ? 'Yes' : 'No']),
      }}
    >
      <div className="flex flex-col gap-4">
        <HeatStrip
          days={backupCells(backups.days)}
          max={1}
          format={(value) => (value > 0 ? 'backed up' : 'no backup')}
          emptyLabel="No backup has been seen yet"
        />
        <Fields columns={2}>
          <Field label="Last backup">
            {backups.lastAt === null ? 'Never' : dateTime(backups.lastAt)}
          </Field>
          <Field label="Age">
            {backups.ageHours === null
              ? 'No backup yet'
              : `${wholeCount(Math.round(backups.ageHours))} hours`}
          </Field>
        </Fields>
      </div>
    </ChartFrame>
  );
}

function versionEvent(entry: CustomerAnalyticsDto['versions'][number]): TimelineEvent {
  return {
    id: `${entry.from}-${entry.version}`,
    when: day(entry.from),
    label: entry.version,
    tone: 'accent',
  };
}

const EVENT_TONES = {
  issue: 'neutral',
  entitlement: 'accent',
  alert: 'warning',
  announce: 'neutral',
  stack: 'success',
} as const;

const EVENT_LEADS = {
  issue: 'issue',
  entitlement: 'entitlements',
  alert: 'alert',
  announce: 'announcement',
  stack: 'stack',
} as const;

function changeEvent(entry: CustomerAnalyticsDto['events'][number], index: number): TimelineEvent {
  return {
    id: `${entry.at}-${entry.kind}-${index}`,
    when: day(entry.at),
    label: entry.label,
    detail: entry.detail,
    lead: EVENT_LEADS[entry.kind],
    tone: EVENT_TONES[entry.kind],
  };
}
