/**
 * The arithmetic the analytics screens do on what the server sends, kept out of the components so
 * it can be read and tested on its own.
 *
 * The server does every aggregation (docs/21), so nothing here re-computes a total. What is left is
 * presentation: how a figure is said at the size a chart has room for, what a series did lately,
 * and the same numbers written out as table rows for a screen reader.
 */
import type { SeriesPoint } from '@crm/shared';
import type { ChartDelta, ChartTable, HeatDay } from '@crm/ui/charts';
import { bytes, currencyDigits, day as dayLabel, money } from '@/lib/format';

/**
 * Money at the size of a chart label. The full figure is what the headline and the table say; an
 * axis has room for "KES 12k" and not for "KES 12,400.00".
 */
export function compactMoney(minor: number, currency: string): string {
  const major = minor / 10 ** currencyDigits(currency);
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      notation: 'compact',
      maximumFractionDigits: 1,
    }).format(major);
  } catch {
    return `${compactCount(major)} ${currency}`;
  }
}

/** A count at the size of a chart label: 1.2k rather than 1,234. */
export function compactCount(value: number): string {
  return new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(
    value,
  );
}

/** Whole seats, since half a seat is not a thing even when an average says otherwise. */
export function wholeCount(value: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value);
}

export function bytesLabel(value: number): string {
  return bytes(value);
}

/**
 * What a series has done lately, said in words. Compares the last point with the one `back` days
 * before it, or with the oldest point there is when the fleet has not been running that long, and
 * says which window it used so the figure cannot be misread.
 *
 * `good` is which direction is good news, which the series cannot know: revenue climbing is good,
 * storage climbing is not, and seats climbing is neither.
 */
export function deltaOver(
  points: readonly SeriesPoint[],
  back: number,
  good: 'up' | 'down' | 'none' = 'none',
): ChartDelta | undefined {
  const window = Math.min(back, points.length - 1);
  if (window < 1) return undefined;
  const now = points[points.length - 1]?.v;
  const then = points[points.length - 1 - window]?.v;
  if (now === undefined || then === undefined) return undefined;

  const over = `in ${window} ${window === 1 ? 'day' : 'days'}`;
  if (now === then) return { label: `level ${over}`, direction: 'flat', tone: 'neutral' };

  const direction = now > then ? 'up' : 'down';
  const tone = good === 'none' ? 'neutral' : direction === good ? 'positive' : 'negative';
  if (then === 0) {
    return { label: `up from none ${over}`, direction, tone };
  }
  const percent = Math.round(Math.abs((now - then) / then) * 100);
  // Under half a percent over a month is not movement, and rounding it to "0%" would claim it was.
  const size = percent === 0 ? 'barely' : `${percent}%`;
  return { label: `${direction} ${size} ${over}`, direction, tone };
}

/** A series written out as table rows: one day, one figure, in the order they happened. */
export function seriesTable(
  caption: string,
  valueColumn: string,
  points: readonly SeriesPoint[],
  format: (value: number) => string,
): ChartTable {
  return {
    caption,
    columns: ['Day', valueColumn],
    rows: points.map((point) => [dayLabel(point.t), format(point.v)]),
  };
}

/** Two series against each other, used where something measured is read against what was sold. */
export function pairTable(
  caption: string,
  columns: [string, string],
  used: readonly SeriesPoint[],
  sold: readonly SeriesPoint[],
  format: (value: number) => string,
): ChartTable {
  return {
    caption,
    columns: ['Day', ...columns],
    rows: used.map((point, index) => [
      dayLabel(point.t),
      format(point.v),
      format(sold[index]?.v ?? 0),
    ]),
  };
}

/** How full something is, as a percentage, or null where the plan does not cap it. */
export function share(used: number, sold: number): number | null {
  if (sold <= 0) return null;
  return Math.min(999, Math.round((used / sold) * 100));
}

const MINUTES_IN_DAY = 1440;

/**
 * A day's connection record as one cell. A day with a failing readiness check is coloured for the
 * failure rather than shaded for its minutes, because a stack that was up and broken is not a good
 * day, and the shading would have said it was.
 */
export function uptimeCells(
  days: readonly { t: string; connectedMinutes: number; readyFailures: number }[],
): HeatDay[] {
  return days.map((entry) => {
    const hours = Math.round((entry.connectedMinutes / 60) * 10) / 10;
    const reported = entry.connectedMinutes > 0;
    const label = `${dayLabel(entry.t)}: ${
      reported ? `${hours} hours connected` : 'no contact'
    }${entry.readyFailures > 0 ? `, ${entry.readyFailures} failing checks` : ''}`;
    if (entry.readyFailures > 0)
      return { t: entry.t, value: entry.connectedMinutes, tone: 'warning', label };
    if (!reported) return { t: entry.t, value: 0, tone: 'empty', label };
    return { t: entry.t, value: entry.connectedMinutes, label };
  });
}

export const UPTIME_MAX = MINUTES_IN_DAY;

/** Backups are a yes or a no per day, so they are coloured rather than shaded. */
export function backupCells(days: readonly { t: string; seen: boolean }[]): HeatDay[] {
  return days.map((entry) => ({
    t: entry.t,
    value: entry.seen ? 1 : 0,
    tone: entry.seen ? 'success' : 'empty',
    label: `${dayLabel(entry.t)}: ${entry.seen ? 'backed up' : 'no backup'}`,
  }));
}

export function uptimeTable(
  days: readonly { t: string; connectedMinutes: number; readyFailures: number }[],
): ChartTable {
  return {
    caption: 'Minutes connected and failing checks per day',
    columns: ['Day', 'Minutes connected', 'Failing checks'],
    rows: days.map((entry) => [dayLabel(entry.t), entry.connectedMinutes, entry.readyFailures]),
  };
}

/** How a full amount of money is said wherever there is room to say it all. */
export function moneyLabel(currency: string): (minor: number) => string {
  return (minor) => money(minor, currency);
}

/** How money is said on a chart, where there is not. */
export function compactMoneyLabel(currency: string): (minor: number) => string {
  return (minor) => compactMoney(minor, currency);
}
