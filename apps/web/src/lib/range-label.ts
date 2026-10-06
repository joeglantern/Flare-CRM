import type { DateRange } from '@/components/filters/FilterBar';

/**
 * A range as people read it, in local time and with the time of day when it is not a whole day.
 * The ISO text sliced to ten characters used to stand in for this, which is the UTC date: in
 * Nairobi a range starting at local midnight read as the day before.
 */
export function rangeLabel(range: DateRange): string {
  const at = (iso: string, endOfDay: boolean) => {
    const d = new Date(iso);
    const date = d.toLocaleDateString(undefined, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
    const whole = endOfDay
      ? d.getHours() === 23 && d.getMinutes() === 59
      : d.getHours() === 0 && d.getMinutes() === 0;
    return whole
      ? date
      : `${date} ${d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
  };
  return `${at(range.from, false)} → ${at(range.to, true)}`;
}
