/**
 * Money, DateTime and Duration (Component Inventory · Data display).
 * The formatting rules from the brief live here, not in every screen.
 */
import { useSettings } from '@/providers/settings';
import {
  formatDate,
  formatDateTime,
  formatDuration,
  formatMoney,
  formatMoneyCompact,
  formatRelative,
} from '@/lib/format';
import { cn } from '@/lib/utils';
import { Tooltip } from '@/components/ui/Tooltip';

export interface MoneyProps {
  amount: number | string | null | undefined;
  currency?: string;
  /** Renders "w KES …" beside the value (weighted pipeline figures). */
  weighted?: number;
  emphasis?: 'normal' | 'strong';
  compact?: boolean;
  className?: string;
}

export function Money({
  amount,
  currency,
  weighted,
  emphasis = 'normal',
  compact,
  className,
}: MoneyProps) {
  const settings = useSettings();
  const code = currency ?? settings.currency;
  const text = compact === true ? formatMoneyCompact(amount, code) : formatMoney(amount, code);
  if (text === '') return <span className="text-faint">—</span>;
  return (
    <span
      className={cn('tnum whitespace-nowrap', emphasis === 'strong' && 'font-medium', className)}
    >
      {text}
      {weighted !== undefined && (
        <span className="ml-1.5 text-sm text-muted">w {formatMoneyCompact(weighted, code)}</span>
      )}
    </span>
  );
}

export interface DateTimeProps {
  value: string | Date | null | undefined;
  /** auto: relative under 24 h, then "Yesterday 17:20", then a date. */
  mode?: 'relative' | 'absolute' | 'auto';
  showTime?: boolean;
  tz?: string;
  className?: string;
  /** Suppress the hover tooltip (inside an existing tooltip or a dense cell). */
  bare?: boolean;
}

export function DateTime({
  value,
  mode = 'auto',
  showTime = true,
  tz,
  className,
  bare,
}: DateTimeProps) {
  const settings = useSettings();
  const zone = tz ?? settings.timezone;
  if (value === null || value === undefined || value === '')
    return <span className="text-faint">—</span>;
  const label =
    mode === 'relative'
      ? formatRelative(value, zone)
      : mode === 'absolute'
        ? showTime
          ? formatDateTime(value, zone)
          : formatDate(value, zone)
        : formatRelative(value, zone);
  const exact = formatDateTime(value, zone);
  const body = (
    <span className={cn('whitespace-nowrap', className)}>
      <time dateTime={typeof value === 'string' ? value : value.toISOString()}>{label}</time>
    </span>
  );
  if (bare === true || mode === 'absolute') return body;
  return <Tooltip content={`${exact} · ${settings.timezoneLabel}`}>{body}</Tooltip>;
}

export function Duration({
  seconds,
  format = 'mmss',
  className,
}: {
  seconds: number | null | undefined;
  format?: 'mmss' | 'long';
  className?: string;
}) {
  if (seconds === null || seconds === undefined) return <span className="text-faint">—</span>;
  if (format === 'long') {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return (
      <span className={cn('whitespace-nowrap', className)}>
        {m > 0 ? `${String(m)} min ` : ''}
        {String(s)} s
      </span>
    );
  }
  return <span className={cn('mono whitespace-nowrap', className)}>{formatDuration(seconds)}</span>;
}

/** Truncated identifier with click-to-copy, per the design system type table. */
export function Identifier({ value, className }: { value: string; className?: string }) {
  const short = value.length > 12 ? `${value.slice(0, 8)}…${value.slice(-2)}` : value;
  return (
    <Tooltip content={`${value} · click to copy`}>
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard.writeText(value);
        }}
        className={cn('mono text-muted hover:text-text', className)}
      >
        {short}
      </button>
    </Tooltip>
  );
}
