/**
 * Formatting the console needs. Sizes are shown in the unit an operator thinks in, times as
 * "4 minutes ago" for anything recent and an absolute date once it stops being interesting.
 */
import { format, formatDistanceToNowStrict, isValid, parseISO } from 'date-fns';

export function bytes(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  if (value < 1024) return `${String(value)} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let size = value / 1024;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size < 10 ? size.toFixed(1) : String(Math.round(size))} ${units[unit] ?? 'TB'}`;
}

export function gigabytes(value: number | null | undefined): string {
  return value === null || value === undefined ? 'No limit' : `${String(value)} GB`;
}

function parse(iso: string | null | undefined): Date | null {
  if (iso === null || iso === undefined || iso === '') return null;
  const date = parseISO(iso);
  return isValid(date) ? date : null;
}

export function ago(iso: string | null | undefined): string {
  const date = parse(iso);
  if (date === null) return 'never';
  return `${formatDistanceToNowStrict(date)} ago`;
}

export function dateTime(iso: string | null | undefined): string {
  const date = parse(iso);
  return date === null ? '—' : format(date, 'd MMM yyyy, HH:mm');
}

export function day(iso: string | null | undefined): string {
  const date = parse(iso);
  return date === null ? '—' : format(date, 'd MMM yyyy');
}

/** For the expiry field, which is a date input and needs `yyyy-MM-dd`. */
export function dateInput(iso: string | null | undefined): string {
  const date = parse(iso);
  return date === null ? '' : format(date, 'yyyy-MM-dd');
}

/** Whole days until a date, negative once it has passed. */
export function daysUntil(iso: string | null | undefined): number | null {
  const date = parse(iso);
  if (date === null) return null;
  return Math.ceil((date.getTime() - Date.now()) / 86_400_000);
}

export function limitLabel(value: number | null | undefined, unit: string): string {
  if (value === null || value === undefined) return 'No limit';
  return unit === '' ? String(value) : `${String(value)} ${unit}`;
}

export function count(value: number, singular: string, plural = `${singular}s`): string {
  return `${String(value)} ${value === 1 ? singular : plural}`;
}
