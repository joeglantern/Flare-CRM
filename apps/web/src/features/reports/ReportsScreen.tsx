/**
 * Reports (Reports). Six reports behind one date range and one export button.
 *
 * GAP-18: report scope is decided by the server from the role, not by a parameter. An agent sees
 * their own numbers, a manager the team's. The screen says whose numbers these are rather than
 * offering a scope switch the API would ignore.
 * GAP-10: the forecast takes `months`, not a date range, so the range picker is disabled there and
 * explains itself instead of silently doing nothing.
 * GAP-19: there is no report export endpoint. Export goes through the CSV export of the underlying
 * entity, and says so.
 * GAP-16: the summary has no per-hour and no per-disposition breakdown, so those charts are not
 * drawn. What is here is what the API actually returns.
 */
import { BarChart3, Download, PhoneMissed, TrendingUp, Users } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Loading';
import { Tabs } from '@/components/ui/Menu';
import { Select } from '@/components/ui/Select';
import { BarChart, FunnelBar, ProgressBar, SERIES, StatCard } from '@/components/data/charts';
import { DataTable, type Column } from '@/components/data/DataTable';
import { DateTime, Duration, Money } from '@/components/data/formatters';
import { EmptyState, ErrorState, ForbiddenState } from '@/components/data/states';
import { Panel } from '@/components/entity/EntityHeader';
import { DateRangePicker, presetRange, type DateRange } from '@/components/filters/FilterBar';
import { ExportDialog } from '@/components/filters/ExportDialog';
import { PageHeader } from '@/app/shell/TopBar';
import { usePageMeta } from '@/app/shell/page-meta';
import { errorMessage } from '@/lib/api/errors';
import { useSearchParam } from '@/lib/list-state';
import { usePipelines } from '@/features/deals/api';
import { useMissedCalls } from '@/features/calls/api';
import { usePermissions } from '@/providers/permissions';
import {
  useAgentPerformance,
  useCallsSummary,
  useForecast,
  usePipelineConversion,
  usePipelineSummary,
  type AgentPerformanceRow,
} from './api';

const REPORTS = [
  { id: 'calls', label: 'Call volume' },
  { id: 'agents', label: 'Agent performance' },
  { id: 'missed', label: 'Missed calls' },
  { id: 'pipeline', label: 'Pipeline' },
  { id: 'conversion', label: 'Conversion' },
  { id: 'forecast', label: 'Forecast' },
] as const;

const percent = (rate: number): string => `${String(Math.round(rate * 100))}%`;

export function ReportsScreen() {
  usePageMeta([{ label: 'Reports' }]);
  const perms = usePermissions();
  const [tab, setTab] = useSearchParam('report');
  const [range, setRange] = useState<DateRange>(() => presetRange('30d'));
  const [exportOpen, setExportOpen] = useState(false);

  const active = tab ?? 'calls';
  const canView = perms.has('report:view_own');
  const filters = useMemo(() => ({ from: range.from, to: range.to }), [range]);

  if (!canView) return <ForbiddenState permission="report:view_own" what="Reports" />;

  const scopeLine = perms.isAdmin
    ? 'These are the whole organisation’s numbers.'
    : perms.isManager
      ? 'These are your team’s numbers.'
      : 'These are your own numbers.';

  return (
    <div className="flex flex-col gap-4 p-6">
      <PageHeader
        title="Reports"
        description={scopeLine}
        actions={
          perms.has('report:export') ? (
            <Button
              variant="secondary"
              icon={Download}
              onClick={() => {
                setExportOpen(true);
              }}
            >
              Export data
            </Button>
          ) : undefined
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <Tabs
          tabs={REPORTS.map((r) => ({ id: r.id, label: r.label }))}
          value={active}
          onChange={(id) => {
            setTab(id === 'calls' ? undefined : id);
          }}
          ariaLabel="Reports"
        />
        <span className="ml-auto">
          <DateRangePicker
            value={range}
            onChange={setRange}
            disabled={active === 'forecast'}
            disabledReason="The forecast is grouped by month ahead, so it takes a number of months rather than a date range (GAP-10)."
          />
        </span>
      </div>

      {active === 'calls' && <CallVolumeReport filters={filters} />}
      {active === 'agents' && <AgentPerformanceReport filters={filters} />}
      {active === 'missed' && <MissedCallsReport filters={filters} />}
      {active === 'pipeline' && <PipelineReport filters={filters} />}
      {active === 'conversion' && <ConversionReport filters={filters} />}
      {active === 'forecast' && <ForecastReport />}

      <ExportDialog
        open={exportOpen}
        onOpenChange={setExportOpen}
        entity={
          active === 'pipeline' || active === 'conversion' || active === 'forecast'
            ? 'deals'
            : 'calls'
        }
        filters={filters}
        filterSummary={`${range.from.slice(0, 10)} to ${range.to.slice(0, 10)} · export gives the rows behind this chart, as CSV`}
      />
    </div>
  );
}

/* ── call volume ────────────────────────────────────────────────────────────────────────── */

function CallVolumeReport({ filters }: { filters: { from: string; to: string } }) {
  const query = useCallsSummary(filters);

  if (query.isPending) return <ReportSkeleton />;
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

  const {
    totals,
    answerRate,
    avgTalkSec,
    avgRingSec,
    totalTalkSec,
    series,
    byHour,
    byDisposition,
  } = query.data;
  if (totals.calls === 0) {
    return (
      <EmptyState
        object="bar-chart"
        title="No calls in this range"
        description="Widen the date range, or check that the PBX integration is connected."
      />
    );
  }

  const breakdown: { label: string; value: number; tone: string }[] = [
    { label: 'Inbound', value: totals.inbound, tone: SERIES[0] ?? 'var(--chart-1)' },
    { label: 'Outbound', value: totals.outbound, tone: SERIES[1] ?? 'var(--chart-2)' },
    { label: 'Internal', value: totals.internal, tone: SERIES[2] ?? 'var(--chart-3)' },
    { label: 'Missed', value: totals.missed, tone: 'var(--danger)' },
    { label: 'Abandoned', value: totals.abandoned, tone: 'var(--warning)' },
    { label: 'Voicemail', value: totals.voicemail, tone: 'var(--border-strong)' },
    { label: 'Busy', value: totals.busy, tone: 'var(--border-strong)' },
    { label: 'Failed', value: totals.failed, tone: 'var(--border-strong)' },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Calls" value={totals.calls} icon={BarChart3} />
        <StatCard
          label="Answer rate"
          value={percent(answerRate)}
          sub={`${String(totals.answered)} answered of ${String(totals.inbound)} inbound`}
          tone={answerRate >= 0.8 ? 'success' : answerRate >= 0.6 ? 'warning' : 'danger'}
        />
        <StatCard label="Talk time" value={<Duration seconds={totalTalkSec} format="long" />} />
        <StatCard
          label="Average talk"
          value={<Duration seconds={avgTalkSec} />}
          sub={
            <>
              ring <Duration seconds={avgRingSec} />
            </>
          }
        />
      </div>

      <Panel title="By day">
        <BarChart
          legend={[
            { label: 'Answered', tone: SERIES[0] ?? 'var(--chart-1)' },
            { label: 'Missed', tone: 'var(--danger)' },
            { label: 'Outbound', tone: SERIES[1] ?? 'var(--chart-2)' },
          ]}
          series={series.map((d) => ({
            label: d.date.slice(5),
            segments: [
              { value: d.answered, tone: SERIES[0] ?? 'var(--chart-1)', label: 'Answered' },
              { value: d.missed, tone: 'var(--danger)', label: 'Missed' },
              { value: d.outbound, tone: SERIES[1] ?? 'var(--chart-2)', label: 'Outbound' },
            ],
          }))}
        />
      </Panel>

      <Panel title="How calls ended" note="Status totals from the summary.">
        <div className="flex flex-col gap-3">
          {breakdown.map((b) => (
            <ProgressBar
              key={b.label}
              value={b.value}
              max={totals.calls}
              label={`${b.label} ${String(b.value)}`}
              tone={b.tone}
            />
          ))}
        </div>
      </Panel>

      <Panel
        title="By hour of day"
        note="When the phones ring. All hours are shown so a quiet one reads as quiet, not missing."
      >
        <BarChart
          labelWidth={56}
          legend={[
            { label: 'Answered', tone: SERIES[0] ?? 'var(--chart-1)' },
            { label: 'Missed', tone: 'var(--danger)' },
            { label: 'Outbound', tone: SERIES[1] ?? 'var(--chart-2)' },
          ]}
          series={byHour.map((h) => ({
            label: `${String(h.hour).padStart(2, '0')}:00`,
            segments: [
              { value: h.answered, tone: SERIES[0] ?? 'var(--chart-1)', label: 'Answered' },
              { value: h.missed, tone: 'var(--danger)', label: 'Missed' },
              { value: h.outbound, tone: SERIES[1] ?? 'var(--chart-2)', label: 'Outbound' },
            ],
          }))}
        />
      </Panel>

      <Panel
        title="Outcomes"
        note="Dispositions agents recorded after the call. Calls with none are counted as not set."
      >
        {byDisposition.length === 0 ? (
          <p className="text-base text-muted">No calls in this range.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {byDisposition.map((d, i) => (
              <ProgressBar
                key={d.dispositionId ?? 'none'}
                value={d.count}
                max={totals.calls}
                label={`${d.name} ${String(d.count)}`}
                tone={
                  d.dispositionId === null
                    ? 'var(--text-faint)'
                    : (SERIES[i % SERIES.length] ?? 'var(--chart-1)')
                }
              />
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}

/* ── agent performance ──────────────────────────────────────────────────────────────────── */

function AgentPerformanceReport({ filters }: { filters: { from: string; to: string } }) {
  const query = useAgentPerformance(filters);

  if (query.isPending) return <ReportSkeleton />;
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

  const rows = query.data;
  const columns: Column<AgentPerformanceRow>[] = [
    {
      key: 'name',
      header: 'Agent',
      width: '1.6fr',
      render: (r) => <span className="truncate font-medium">{r.name}</span>,
    },
    {
      key: 'extension',
      header: 'Ext',
      width: '0.6fr',
      hideable: true,
      render: (r) => <span className="mono text-muted">{r.extension ?? '—'}</span>,
    },
    {
      key: 'total',
      header: 'Calls',
      width: '0.7fr',
      align: 'end',
      render: (r) => <span className="tnum">{r.total}</span>,
    },
    {
      key: 'inbound',
      header: 'In',
      width: '0.6fr',
      align: 'end',
      hideable: true,
      render: (r) => <span className="tnum text-muted">{r.inbound}</span>,
    },
    {
      key: 'outbound',
      header: 'Out',
      width: '0.6fr',
      align: 'end',
      hideable: true,
      render: (r) => <span className="tnum text-muted">{r.outbound}</span>,
    },
    {
      key: 'answered',
      header: 'Answered',
      width: '0.8fr',
      align: 'end',
      render: (r) => <span className="tnum">{r.answered}</span>,
    },
    {
      key: 'missed',
      header: 'Missed',
      width: '0.8fr',
      align: 'end',
      render: (r) => <span className="tnum text-danger">{r.missed}</span>,
    },
    {
      key: 'totalTalkSec',
      header: 'Talk time',
      width: '1fr',
      align: 'end',
      render: (r) => <Duration seconds={r.totalTalkSec} format="long" />,
    },
    {
      key: 'avgTalkSec',
      header: 'Avg talk',
      width: '0.9fr',
      align: 'end',
      hideable: true,
      render: (r) => <Duration seconds={r.avgTalkSec} />,
    },
    {
      key: 'avgRingSec',
      header: 'Avg ring',
      width: '0.9fr',
      align: 'end',
      hideable: true,
      optional: true,
      render: (r) => <Duration seconds={r.avgRingSec} />,
    },
  ];

  return (
    <DataTable
      tableId="report-agents"
      ariaLabel="Agent performance"
      columns={columns}
      rows={rows}
      rowKey={(r) => r.userId}
      state={rows.length === 0 ? 'empty' : 'ready'}
      emptyState={{
        object: 'headset',
        title: 'No agent activity in this range',
        description: 'Nobody handled a call between those dates.',
      }}

      note="Scope comes from your role, not from a filter (GAP-18). These rows carry no disposition counts (GAP-16)."
    />
  );
}

/* ── missed calls ───────────────────────────────────────────────────────────────────────── */

function MissedCallsReport({ filters }: { filters: { from: string; to: string } }) {
  const query = useMissedCalls({ ...filters, pageSize: 50 });
  const rows = query.rows;

  if (query.isPending) return <ReportSkeleton />;
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

  const notReturned = rows.filter((r) => !r.returned).length;
  const repeats = rows.filter((r) => r.attempts > 1).length;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Missed calls" value={query.total} icon={PhoneMissed} />
        <StatCard
          label="Not called back"
          value={notReturned}
          tone={notReturned > 0 ? 'danger' : 'success'}
        />
        <StatCard label="Repeat callers" value={repeats} sub="rang more than once in this range" />
      </div>

      <Panel
        padded={false}
        note="Called back and repeat counts are worked out from your own call list, not returned by the API (GAP-17)."
      >
        {rows.length === 0 ? (
          <EmptyState
            compact
            object="checkmark"
            title="Nothing was missed"
            description="Every call in this range was answered."
          />
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((r) => (
              <li key={r.id} className="flex items-center gap-3 px-3.5 py-2.5">
                <PhoneMissed size={14} className="shrink-0 text-danger" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">
                    {r.contact?.displayName ?? r.externalDisplay ?? r.externalNumber ?? 'Unknown'}
                  </span>
                  <span className="block truncate text-sm text-muted">
                    <DateTime value={r.startedAt} /> · rang <Duration seconds={r.ringDurationSec} />
                  </span>
                </span>
                {r.attempts > 1 && (
                  <span className="mono shrink-0 text-sm text-warning">{r.attempts} attempts</span>
                )}
                <span className="shrink-0 text-sm text-muted">
                  {r.returned ? 'Called back' : 'Not called back'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

/* ── pipeline ───────────────────────────────────────────────────────────────────────────── */

function PipelineReport({ filters }: { filters: { from: string; to: string } }) {
  const pipelines = usePipelines();
  const [pipelineId, setPipelineId] = useState<string | null>(null);
  const query = usePipelineSummary({ ...filters, ...(pipelineId !== null ? { pipelineId } : {}) });

  if (query.isPending) return <ReportSkeleton />;
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

  const { stages, won, lost, winRate, currency } = query.data;
  const openValue = stages.reduce((a, s) => a + s.openValue, 0);
  const weighted = stages.reduce((a, s) => a + s.weightedValue, 0);
  const openCount = stages.reduce((a, s) => a + s.openCount, 0);
  const peak = Math.max(1, ...stages.map((s) => s.openValue));

  return (
    <div className="flex flex-col gap-4">
      <Select
        value={pipelineId}
        onChange={setPipelineId}
        size="sm"
        ariaLabel="Pipeline"
        placeholder="Default pipeline"
        options={(pipelines.data ?? []).map((p) => ({ value: p.id, label: p.name }))}
        className="max-w-56"
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Open deals" value={openCount} />
        <StatCard
          label="Open value"
          value={<Money amount={openValue} currency={currency} compact />}
        />
        <StatCard
          label="Weighted"
          value={<Money amount={weighted} currency={currency} compact />}
          tone="flare"
        />
        <StatCard
          label="Win rate"
          value={percent(winRate)}
          sub={`${String(won.count)} won · ${String(lost.count)} lost`}
          tone={winRate >= 0.5 ? 'success' : 'neutral'}
        />
      </div>

      <Panel title="By stage">
        {stages.length === 0 ? (
          <p className="text-base text-muted">No deals in this pipeline for the selected range.</p>
        ) : (
          <BarChart
            max={peak}
            format={(v) => new Intl.NumberFormat('en-KE', { notation: 'compact' }).format(v)}
            series={stages.map((s, i) => ({
              label: s.name,
              segments: [
                { value: s.openValue, tone: SERIES[i % SERIES.length] ?? 'var(--chart-1)' },
              ],
              meta: (
                <span className="text-sm">
                  {s.openCount} · <Money amount={s.openValue} currency={currency} compact />
                </span>
              ),
            }))}
          />
        )}
      </Panel>

      <Panel title="Closed">
        <div className="flex flex-col gap-3">
          <ProgressBar
            value={won.count}
            max={Math.max(1, won.count + lost.count)}
            label={
              <>
                Won {won.count} · <Money amount={won.value} currency={currency} compact />
              </>
            }
            tone="var(--success)"
          />
          <ProgressBar
            value={lost.count}
            max={Math.max(1, won.count + lost.count)}
            label={
              <>
                Lost {lost.count} · <Money amount={lost.value} currency={currency} compact />
              </>
            }
            tone="var(--danger)"
          />
        </div>
      </Panel>
    </div>
  );
}

/* ── conversion ─────────────────────────────────────────────────────────────────────────── */

function ConversionReport({ filters }: { filters: { from: string; to: string } }) {
  const pipelines = usePipelines();
  const [pipelineId, setPipelineId] = useState<string | null>(null);
  const query = usePipelineConversion({
    ...filters,
    ...(pipelineId !== null ? { pipelineId } : {}),
  });

  if (query.isPending) return <ReportSkeleton />;
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

  const { created, stages, won, lost, winRate, avgCycleDays } = query.data;

  return (
    <div className="flex flex-col gap-4">
      <Select
        value={pipelineId}
        onChange={setPipelineId}
        size="sm"
        ariaLabel="Pipeline"
        placeholder="Default pipeline"
        options={(pipelines.data ?? []).map((p) => ({ value: p.id, label: p.name }))}
        className="max-w-56"
      />

      <div className="grid gap-3 sm:grid-cols-4">
        <StatCard label="Deals created" value={created} />
        <StatCard
          label="Win rate"
          value={percent(winRate)}
          tone="success"
          sub={`${String(won)} won · ${String(lost)} lost`}
        />
        <StatCard
          label="Average days to close"
          value={avgCycleDays === null ? null : Math.round(avgCycleDays)}
          icon={TrendingUp}
        />
        <StatCard label="Still open" value={Math.max(0, created - won - lost)} />
      </div>

      <Panel
        title="How far deals get"
        note="The share of deals created in this range that reached each stage."
      >
        {stages.length === 0 ? (
          <p className="text-base text-muted">No stage movement in this range.</p>
        ) : (
          <FunnelBar
            steps={stages.map((s) => ({
              label: s.name,
              value: s.reached,
              rate: s.pct,
              meta: <span className="text-sm text-muted">{percent(s.pct)}</span>,
            }))}
          />
        )}
      </Panel>
    </div>
  );
}

/* ── forecast ───────────────────────────────────────────────────────────────────────────── */

function ForecastReport() {
  const pipelines = usePipelines();
  const [pipelineId, setPipelineId] = useState<string | null>(null);
  const [months, setMonths] = useState('3');
  const query = useForecast({
    months: Number(months),
    ...(pipelineId !== null ? { pipelineId } : {}),
  });

  if (query.isPending) return <ReportSkeleton />;
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

  const { months: rows, unscheduled, currency } = query.data;
  const value = rows.reduce((a, m) => a + m.value, 0);
  const weighted = rows.reduce((a, m) => a + m.weightedValue, 0);
  const count = rows.reduce((a, m) => a + m.count, 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={pipelineId}
          onChange={setPipelineId}
          size="sm"
          ariaLabel="Pipeline"
          placeholder="Default pipeline"
          options={(pipelines.data ?? []).map((p) => ({ value: p.id, label: p.name }))}
          className="max-w-56"
        />
        <Select
          value={months}
          onChange={setMonths}
          size="sm"
          ariaLabel="Months ahead"
          options={[
            { value: '3', label: 'Next 3 months' },
            { value: '6', label: 'Next 6 months' },
            { value: '12', label: 'Next 12 months' },
          ]}
          className="max-w-48"
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <StatCard label="Deals closing" value={count} icon={Users} />
        <StatCard
          label="Total value"
          value={<Money amount={value} currency={currency} compact />}
        />
        <StatCard
          label="Weighted"
          value={<Money amount={weighted} currency={currency} compact />}
          tone="flare"
        />
        <StatCard
          label="No close date"
          value={unscheduled.count}
          sub={<Money amount={unscheduled.value} currency={currency} compact />}
          tone={unscheduled.count > 0 ? 'warning' : 'neutral'}
        />
      </div>

      <Panel title="By month" note="Takes months ahead, not a date range (GAP-10).">
        {rows.length === 0 ? (
          <EmptyState
            compact
            object="calendar"
            title="Nothing forecast"
            description="No open deal has an expected close date in this window."
          />
        ) : (
          <BarChart
            format={(v) => new Intl.NumberFormat('en-KE', { notation: 'compact' }).format(v)}
            legend={[
              { label: 'Weighted', tone: 'var(--flare)' },
              { label: 'Rest of the value', tone: SERIES[0] ?? 'var(--chart-1)' },
            ]}
            series={rows.map((m) => ({
              label: m.month,
              segments: [
                { value: m.weightedValue, tone: 'var(--flare)', label: 'Weighted' },
                {
                  value: Math.max(0, m.value - m.weightedValue),
                  tone: SERIES[0] ?? 'var(--chart-1)',
                  label: 'Unweighted',
                },
              ],
              meta: (
                <span className="text-sm">
                  {m.count} · <Money amount={m.value} currency={currency} compact />
                </span>
              ),
            }))}
          />
        )}
      </Panel>
    </div>
  );
}

function ReportSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} height={72} shape="block" />
        ))}
      </div>
      <Skeleton height={280} shape="block" />
    </div>
  );
}
