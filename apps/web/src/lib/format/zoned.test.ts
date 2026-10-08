import { describe, expect, it } from 'vitest';
import {
  endOfZonedDay,
  fromZonedInput,
  sameZonedDay,
  startOfZonedDay,
  toZonedInput,
  zonedAt,
} from './zoned';

const NBO = 'Africa/Nairobi'; // UTC+3, no daylight saving
const NOW = new Date('2026-10-08T22:30:00Z'); // 01:30 on the 9th in Nairobi

describe('times in the CRM zone, whatever the computer is set to', () => {
  it('shows and reads a datetime field in the zone', () => {
    expect(toZonedInput('2026-10-08T06:00:00Z', NBO)).toBe('2026-10-08T09:00');
    expect(fromZonedInput('2026-10-08T09:00', NBO)).toBe('2026-10-08T06:00:00.000Z');
    expect(fromZonedInput('', NBO)).toBeNull();
  });

  it('starts and ends the day at the zone midnight', () => {
    // Already the 9th in Nairobi, though still the 8th in UTC.
    expect(startOfZonedDay(NBO, 0, NOW).toISOString()).toBe('2026-10-08T21:00:00.000Z');
    expect(endOfZonedDay(NBO, 0, NOW).toISOString()).toBe('2026-10-09T20:59:59.999Z');
    expect(startOfZonedDay(NBO, -6, NOW).toISOString()).toBe('2026-10-02T21:00:00.000Z');
  });

  it('puts tomorrow at nine on the zone clock', () => {
    expect(zonedAt(NBO, 1, 9, NOW).toISOString()).toBe('2026-10-10T06:00:00.000Z');
  });

  it('tells days apart on the zone calendar', () => {
    expect(
      sameZonedDay(new Date('2026-10-08T22:00:00Z'), new Date('2026-10-09T10:00:00Z'), NBO),
    ).toBe(true);
    expect(
      sameZonedDay(new Date('2026-10-08T20:00:00Z'), new Date('2026-10-08T22:00:00Z'), NBO),
    ).toBe(false);
  });
});
