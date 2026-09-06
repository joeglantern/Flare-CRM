/**
 * StatCard, BarChart, FunnelBar and ProgressBar (Component Inventory · Data display).
 * These are the only chart shapes in the product; they are flex and CSS so they theme and print
 * cleanly, and no chart library is needed. Series colours follow the fixed order in docs/18 §3.
 */
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Skeleton } from '@/components/ui/Loading';
import { cn } from '@/lib/utils';

export const SERIES = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
];

export interface StatCardProps {
  label: string;
  /**
   * A plain value, or a formatted node such as <Money> or <Duration>. Null and undefined render
   * as a dash: an unknown metric is never shown as zero.
   */
  value: ReactNode;
  unit?: string;
  sub?: ReactNode;
  icon?: LucideIcon;
  tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'flare';
  loading?: boolean;
  onClick?: () => void;
  className?: string;
}

const TONE: Record<NonNullable<StatCardProps['tone']>, string> = {
  neutral: 'text-text',
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
  flare: 'text-flare-on',
};

/** Renders a dash rather than a zero when there is no data — an empty metric is not "0". */
export function StatCard({
  label,
  value,
  unit,
  sub,
  icon: Icon,
  tone = 'neutral',
  loading = false,
  onClick,
  className,
}: StatCardProps) {
  const empty = value === null || value === undefined || value === '';
  const body = (
    <>
      <div className="flex items-center gap-1.5 text-sm text-muted">
        {Icon !== undefined && <Icon size={13} aria-hidden />}
        <span className="truncate">{label}</span>
      </div>
      {loading ? (
        <Skeleton height={24} width="60%" className="mt-1.5" />
      ) : (
        <div
          className={cn('tnum mt-1 flex items-baseline gap-1 text-2xl font-semibold', TONE[tone])}
        >
          {empty ? <span className="text-faint">—</span> : value}
          {!empty && unit !== undefined && (
            <span className="text-sm font-normal text-muted">{unit}</span>
          )}
        </div>
      )}
      {sub !== undefined && !loading && (
        <div className="mt-0.5 truncate text-sm text-muted">{sub}</div>
      )}
    </>
  );
  const cls = cn('min-w-0 rounded-md border border-border bg-surface p-3.5 text-left', className);
  return onClick !== undefined ? (
    <button type="button" onClick={onClick} className={cn(cls, 'hover:bg-hover')}>
      {body}
    </button>
  ) : (
    <div className={cls}>{body}</div>
  );
}

export interface BarSeries {
  label: string;
  segments: { value: number; tone: string; label?: string }[];
  /** Optional right-hand annotation, e.g. a total. */
  meta?: ReactNode;
  onClick?: () => void;
}

export function BarChart({
  series,
  max,
  legend,
  format = (v) => v.toLocaleString('en-KE'),
  className,
  labelWidth = 128,
}: {
  series: BarSeries[];
  max?: number;
  legend?: { label: string; tone: string }[];
  format?: (v: number) => string;
  className?: string;
  labelWidth?: number;
}) {
  const peak =
    max ?? Math.max(1, ...series.map((s) => s.segments.reduce((a, x) => a + x.value, 0)));
  return (
    <div className={cn('flex flex-col gap-2.5', className)}>
      {legend !== undefined && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
          {legend.map((l) => (
            <span key={l.label} className="inline-flex items-center gap-1.5">
              <i className="h-2.5 w-2.5 rounded-[3px]" style={{ background: l.tone }} aria-hidden />
              {l.label}
            </span>
          ))}
        </div>
      )}
      {series.map((s) => {
        const total = s.segments.reduce((a, x) => a + x.value, 0);
        const row = (
          <>
            <span style={{ width: labelWidth }} className="shrink-0 truncate text-sm text-muted">
              {s.label}
            </span>
            <span className="flex h-5 min-w-0 flex-1 items-center gap-px overflow-hidden rounded-[3px] bg-[var(--surface-hover)]">
              {s.segments.map((seg, i) => (
                <i
                  key={i}
                  title={`${seg.label ?? s.label}: ${format(seg.value)}`}
                  style={{ width: `${String((seg.value / peak) * 100)}%`, background: seg.tone }}
                  className="h-full first:rounded-l-[3px] last:rounded-r-[3px]"
                  aria-hidden
                />
              ))}
            </span>
            <span className="tnum w-16 shrink-0 text-right text-sm">{s.meta ?? format(total)}</span>
          </>
        );
        return s.onClick !== undefined ? (
          <button
            key={s.label}
            type="button"
            onClick={s.onClick}
            className="flex items-center gap-3 text-left hover:opacity-90"
          >
            {row}
          </button>
        ) : (
          <div key={s.label} className="flex items-center gap-3">
            {row}
          </div>
        );
      })}
    </div>
  );
}

export interface FunnelStep {
  label: string;
  value: number;
  /** Conversion from the previous step, 0–1. */
  rate?: number;
  meta?: ReactNode;
  onClick?: () => void;
}

export function FunnelBar({
  steps,
  format = (v) => v.toLocaleString('en-KE'),
  className,
}: {
  steps: FunnelStep[];
  format?: (v: number) => string;
  className?: string;
}) {
  const peak = Math.max(1, ...steps.map((s) => s.value));
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {steps.map((s, i) => (
        <div key={s.label} className="flex items-center gap-3">
          <span className="w-28 shrink-0 truncate text-sm text-muted">{s.label}</span>
          <span className="relative flex h-7 min-w-0 flex-1 items-center">
            <i
              style={{
                width: `${String(Math.max(2, (s.value / peak) * 100))}%`,
                background: SERIES[i % SERIES.length],
              }}
              className="h-full rounded-[3px] opacity-90"
              aria-hidden
            />
            <span className="tnum absolute left-2 text-sm font-medium text-[var(--on-flare)] mix-blend-luminosity">
              {format(s.value)}
            </span>
          </span>
          <span className="tnum w-20 shrink-0 text-right text-sm text-muted">
            {s.meta ?? (s.rate !== undefined ? `${String(Math.round(s.rate * 100))}%` : '')}
          </span>
        </div>
      ))}
    </div>
  );
}

export function ProgressBar({
  value,
  max = 100,
  tone = 'var(--flare)',
  label,
  className,
}: {
  value: number;
  max?: number;
  tone?: string;
  label?: ReactNode;
  className?: string;
}) {
  const pct = Math.max(0, Math.min(100, (value / Math.max(1, max)) * 100));
  return (
    <div className={cn('flex min-w-0 items-center gap-2', className)}>
      <span
        role="progressbar"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
        className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-[var(--surface-hover)]"
      >
        <i
          className="block h-full rounded-full transition-[width]"
          style={{ width: `${String(pct)}%`, background: tone }}
        />
      </span>
      {label !== undefined && <span className="tnum shrink-0 text-sm text-muted">{label}</span>}
    </div>
  );
}

/** Inline share bar used inside table cells (stage share, agent share). */
export function ShareBar({
  value,
  total,
  tone = 'var(--flare)',
}: {
  value: number;
  total: number;
  tone?: string;
}) {
  return <ProgressBar value={value} max={total} tone={tone} className="w-full" />;
}
