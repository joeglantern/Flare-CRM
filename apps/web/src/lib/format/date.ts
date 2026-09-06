/**
 * Dates in the user's time zone (users.timezone, default Africa/Nairobi), relative labels for the
 * last 24 hours, absolute after that (docs/17 section 4, docs/18).
 */
import { TZDate } from '@date-fns/tz';
import { differenceInMinutes, differenceInSeconds, format, isSameDay, isSameYear } from 'date-fns';

export const DEFAULT_TZ = 'Africa/Nairobi';

function toTz(value: string | Date, tz: string): TZDate {
  return new TZDate(typeof value === 'string' ? new Date(value) : value, tz);
}

/** "5 Sep 2026, 14:32" (year dropped when it is the current year). */
export function formatDateTime(
  value: string | Date | null | undefined,
  tz = DEFAULT_TZ,
  now: Date = new Date(),
): string {
  if (!value) return '';
  const d = toTz(value, tz);
  const n = toTz(now, tz);
  return format(d, isSameYear(d, n) ? 'd MMM, HH:mm' : 'd MMM yyyy, HH:mm');
}

/** "5 Sep 2026" */
export function formatDate(value: string | Date | null | undefined, tz = DEFAULT_TZ): string {
  if (!value) return '';
  return format(toTz(value, tz), 'd MMM yyyy');
}

/** "14:32" */
export function formatTime(value: string | Date | null | undefined, tz = DEFAULT_TZ): string {
  if (!value) return '';
  return format(toTz(value, tz), 'HH:mm');
}

/**
 * Relative within 24 h ("just now", "5 min ago", "3 h ago"), then "Yesterday 14:32", then the
 * absolute date. Future values (due dates) read "in 20 min", "in 3 h", "Tomorrow 09:00".
 */
export function formatRelative(
  value: string | Date | null | undefined,
  tz = DEFAULT_TZ,
  now: Date = new Date(),
): string {
  if (!value) return '';
  const d = toTz(value, tz);
  const n = toTz(now, tz);
  const seconds = differenceInSeconds(d, n);
  const abs = Math.abs(seconds);
  const future = seconds > 0;
  if (abs < 45) return future ? 'in a moment' : 'just now';
  if (abs < 3600) {
    const m = Math.max(1, Math.round(abs / 60));
    return future ? `in ${String(m)} min` : `${String(m)} min ago`;
  }
  if (abs < 24 * 3600) {
    const h = Math.round(abs / 3600);
    return future ? `in ${String(h)} h` : `${String(h)} h ago`;
  }
  const dayDiff = Math.round(differenceInMinutes(startOfDay(d), startOfDay(n)) / (24 * 60));
  if (dayDiff === -1) return `Yesterday ${format(d, 'HH:mm')}`;
  if (dayDiff === 1) return `Tomorrow ${format(d, 'HH:mm')}`;
  return formatDateTime(d, tz, now);
}

function startOfDay(d: TZDate): TZDate {
  const c = new TZDate(d, d.timeZone ?? DEFAULT_TZ);
  c.setHours(0, 0, 0, 0);
  return c;
}

/** Call and talk durations: "0:45", "12:03", "1:02:03". */
export function formatDuration(totalSeconds: number | null | undefined): string {
  if (totalSeconds === null || totalSeconds === undefined || !Number.isFinite(totalSeconds))
    return '';
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  return `${h > 0 ? `${String(h)}:` : ''}${mm}:${String(sec).padStart(2, '0')}`;
}

/** Day separator label for timelines and inbox: "Today", "Yesterday", "Fri 4 Sep". */
export function dayLabel(value: string | Date, tz = DEFAULT_TZ, now: Date = new Date()): string {
  const d = toTz(value, tz);
  const n = toTz(now, tz);
  if (isSameDay(d, n)) return 'Today';
  const y = new TZDate(n, tz);
  y.setDate(y.getDate() - 1);
  if (isSameDay(d, y)) return 'Yesterday';
  return format(d, isSameYear(d, n) ? 'EEE d MMM' : 'EEE d MMM yyyy');
}
