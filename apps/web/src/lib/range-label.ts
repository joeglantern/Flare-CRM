import type { DateRange } from '@/components/filters/FilterBar';
import { formatDate, formatTime } from './format/date';
import { zonedParts } from './format/zoned';

/**
 * A range as people read it, on the CRM's clock, with the time of day only when it is not a
 * whole day. The ISO text sliced to ten characters used to stand in for this, which is the UTC
 * date: in Nairobi a range starting at local midnight read as the day before.
 */
export function rangeLabel(range: DateRange, tz: string): string {
  const at = (iso: string, endOfDay: boolean) => {
    const p = zonedParts(new Date(iso), tz);
    const whole = endOfDay ? p.hours === 23 && p.minutes === 59 : p.hours === 0 && p.minutes === 0;
    const date = formatDate(iso, tz);
    return whole ? date : `${date} ${formatTime(iso, tz)}`;
  };
  return `${at(range.from, false)} → ${at(range.to, true)}`;
}
