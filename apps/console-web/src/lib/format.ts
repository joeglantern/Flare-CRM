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

/**
 * Money crosses the wire in minor units and is never a float there, so these three are the only
 * place the decimal point is put in or taken out.
 */
/** Whether Intl recognises the code, which is the only currency check worth making on a form. */
export function isCurrency(code: string): boolean {
  try {
    new Intl.NumberFormat(undefined, { style: 'currency', currency: code });
    return true;
  } catch {
    return false;
  }
}

export function currencyDigits(currency: string): number {
  // Two is the right fallback: every currency the console sells in has two, and an unknown code
  // being off by a factor of ten in a label is better than a crash on the fleet screen.
  if (!isCurrency(currency)) return 2;
  return (
    new Intl.NumberFormat(undefined, { style: 'currency', currency }).resolvedOptions()
      .maximumFractionDigits ?? 2
  );
}

export function money(minor: number | null | undefined, currency: string): string {
  if (minor === null || minor === undefined) return 'Not sold';
  const major = minor / 10 ** currencyDigits(currency);
  if (!isCurrency(currency)) return `${major.toFixed(2)} ${currency}`;
  return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(major);
}

/** Minor units to what a person types into a price field. */
export function fromMinor(minor: number | null | undefined, currency: string): string {
  if (minor === null || minor === undefined) return '';
  return (minor / 10 ** currencyDigits(currency)).toFixed(currencyDigits(currency));
}

/** What they typed back to minor units. Empty means "no price"; anything unparseable means the same. */
export function toMinor(major: string, currency: string): number | null {
  const trimmed = major.trim();
  if (trimmed === '') return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < 0) return null;
  // Rounding here rather than truncating: 1500.55 * 100 is 150055.00000000003 in binary floating
  // point, and a truncation would quietly bill a cent less.
  return Math.round(value * 10 ** currencyDigits(currency));
}
