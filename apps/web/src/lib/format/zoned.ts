/**
 * Wall-clock time in the CRM's own time zone, not the zone of the computer the page runs on.
 *
 * Date pickers, "today", "tomorrow at 9" and the day a call falls on all used to be worked out
 * with the browser's clock. On a laptop set to another zone that put a task due at 09:00 Nairobi
 * in the form as 06:00, and a "today" filter a few hours off. Everything here takes the zone.
 */
import { TZDate } from '@date-fns/tz';
import { format } from 'date-fns';

/** What a datetime-local field shows for an instant, in the zone: "2026-10-08T09:00". */
export function toZonedInput(value: string | Date | null | undefined, tz: string): string {
  if (value === null || value === undefined || value === '') return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return format(new TZDate(d, tz), "yyyy-MM-dd'T'HH:mm");
}

/** The instant a datetime-local value means in the zone, as ISO. */
export function fromZonedInput(local: string, tz: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(local);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m.map(Number) as [number, number, number, number, number, number];
  return new Date(new TZDate(y, mo - 1, d, h, mi, 0, 0, tz).getTime()).toISOString();
}

/** Midnight at the start of a day in the zone, `offsetDays` from the day `from` falls on. */
export function startOfZonedDay(tz: string, offsetDays = 0, from: Date = new Date()): Date {
  const z = new TZDate(from, tz);
  return new Date(
    new TZDate(z.getFullYear(), z.getMonth(), z.getDate() + offsetDays, 0, 0, 0, 0, tz).getTime(),
  );
}

/** The last millisecond of that day in the zone. */
export function endOfZonedDay(tz: string, offsetDays = 0, from: Date = new Date()): Date {
  return new Date(startOfZonedDay(tz, offsetDays + 1, from).getTime() - 1);
}

/** A given time of day, `offsetDays` days on, in the zone: tomorrow at 09:00 is (1, 9). */
export function zonedAt(
  tz: string,
  offsetDays: number,
  hours: number,
  from: Date = new Date(),
): Date {
  const z = new TZDate(from, tz);
  return new Date(
    new TZDate(
      z.getFullYear(),
      z.getMonth(),
      z.getDate() + offsetDays,
      hours,
      0,
      0,
      0,
      tz,
    ).getTime(),
  );
}

/** The parts of an instant as the zone's clock shows them. */
export function zonedParts(value: Date, tz: string) {
  const z = new TZDate(value, tz);
  return {
    year: z.getFullYear(),
    month: z.getMonth(),
    day: z.getDate(),
    weekday: z.getDay(),
    hours: z.getHours(),
    minutes: z.getMinutes(),
  };
}

/** The same calendar day in the zone. */
export function sameZonedDay(a: Date, b: Date, tz: string): boolean {
  const x = zonedParts(a, tz);
  const y = zonedParts(b, tz);
  return x.year === y.year && x.month === y.month && x.day === y.day;
}
