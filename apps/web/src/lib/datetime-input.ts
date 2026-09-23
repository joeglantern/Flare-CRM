/**
 * Local wall-clock text for a datetime-local input, and the ISO instant the server stores.
 */
const two = (n: number) => String(n).padStart(2, '0');

/**
 * A datetime field is stored as an ISO instant (the server insists on an offset), but the
 * datetime-local input speaks in local wall-clock time with no offset at all. Passing one to the
 * other unchanged either fails validation on save or shows the UTC time as if it were local.
 */
export function datetimeToLocalInput(value: unknown): string {
  const s = typeof value === 'string' ? value : '';
  if (s === '') return '';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s.slice(0, 16);
  return `${String(d.getFullYear())}-${two(d.getMonth() + 1)}-${two(d.getDate())}T${two(d.getHours())}:${two(d.getMinutes())}`;
}

export function datetimeFromLocalInput(local: string): string | null {
  if (local === '') return null;
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? local : d.toISOString();
}
