/**
 * Wall-clock text for a datetime-local input, and the ISO instant the server stores.
 *
 * A datetime field is stored as an ISO instant (the server insists on an offset), but the
 * datetime-local input speaks in wall-clock time with no offset at all. That wall clock is the
 * CRM's own time zone, not the zone of the computer the form is open on.
 */
import { fromZonedInput, toZonedInput } from './format/zoned';

export function datetimeToLocalInput(value: unknown, tz: string): string {
  const s = typeof value === 'string' ? value : '';
  if (s === '') return '';
  return toZonedInput(s, tz) || s.slice(0, 16);
}

export function datetimeFromLocalInput(local: string, tz: string): string | null {
  if (local === '') return null;
  return fromZonedInput(local, tz) ?? local;
}
