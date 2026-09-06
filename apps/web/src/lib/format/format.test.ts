import { describe, expect, it } from 'vitest';
import { dayLabel, formatDateTime, formatDuration, formatRelative } from './date';
import { formatMoney, formatMoneyCompact } from './money';
import { formatPhone, phoneParts } from './phone';

describe('money', () => {
  it('formats KES with the ISO code and thousands separators', () => {
    expect(formatMoney(1_250_000)).toBe('KES 1,250,000');
    expect(formatMoney('50000')).toBe('KES 50,000');
    expect(formatMoney(1999.5, 'KES', 2)).toBe('KES 1,999.50');
    expect(formatMoney(null)).toBe('');
    expect(formatMoney('abc')).toBe('');
  });
  it('compacts large values for cards', () => {
    expect(formatMoneyCompact(1_250_000)).toBe('KES 1.25M');
    expect(formatMoneyCompact(50_000)).toBe('KES 50K');
    expect(formatMoneyCompact(2_000_000)).toBe('KES 2M');
    expect(formatMoneyCompact(950)).toBe('KES 950');
    expect(formatMoneyCompact(-1_500)).toBe('KES -1.5K');
  });
});

describe('phone', () => {
  it('shows Kenyan numbers in national format with the E.164 alongside', () => {
    expect(phoneParts('+254712345678')).toEqual({
      national: '0712 345678',
      e164: '+254712345678',
      raw: '+254712345678',
    });
    expect(phoneParts('0712345678')?.e164).toBe('+254712345678');
    expect(formatPhone('+254712345678')).toBe('0712 345678');
  });
  it('keeps unparseable values verbatim instead of hiding them', () => {
    expect(phoneParts('anonymous')).toEqual({
      national: 'anonymous',
      e164: null,
      raw: 'anonymous',
    });
    expect(phoneParts('')).toBeNull();
    expect(phoneParts(null)).toBeNull();
  });
});

describe('dates', () => {
  const now = new Date('2026-09-05T12:00:00Z'); // 15:00 in Nairobi
  it('renders in the Nairobi time zone by default', () => {
    expect(formatDateTime('2026-09-05T09:30:00Z', 'Africa/Nairobi', now)).toBe('5 Sep, 12:30');
    expect(formatDateTime('2025-12-24T09:30:00Z', 'Africa/Nairobi', now)).toBe(
      '24 Dec 2025, 12:30',
    );
  });
  it('uses relative labels inside 24 hours', () => {
    expect(formatRelative('2026-09-05T11:59:50Z', 'Africa/Nairobi', now)).toBe('just now');
    expect(formatRelative('2026-09-05T11:55:00Z', 'Africa/Nairobi', now)).toBe('5 min ago');
    expect(formatRelative('2026-09-05T09:00:00Z', 'Africa/Nairobi', now)).toBe('3 h ago');
    expect(formatRelative('2026-09-05T12:20:00Z', 'Africa/Nairobi', now)).toBe('in 20 min');
    expect(formatRelative('2026-09-04T05:00:00Z', 'Africa/Nairobi', now)).toBe('Yesterday 08:00');
    expect(formatRelative('2026-09-06T06:00:00Z', 'Africa/Nairobi', now)).toBe('in 18 h');
    expect(formatRelative('2026-09-06T14:00:00Z', 'Africa/Nairobi', now)).toBe('Tomorrow 17:00');
    expect(formatRelative('2026-08-20T06:00:00Z', 'Africa/Nairobi', now)).toBe('20 Aug, 09:00');
  });
  it('labels timeline days', () => {
    expect(dayLabel('2026-09-05T01:00:00Z', 'Africa/Nairobi', now)).toBe('Today');
    expect(dayLabel('2026-09-04T01:00:00Z', 'Africa/Nairobi', now)).toBe('Yesterday');
    expect(dayLabel('2026-09-01T01:00:00Z', 'Africa/Nairobi', now)).toBe('Tue 1 Sep');
  });
  it('formats call durations', () => {
    expect(formatDuration(45)).toBe('0:45');
    expect(formatDuration(723)).toBe('12:03');
    expect(formatDuration(3723)).toBe('1:02:03');
    expect(formatDuration(null)).toBe('');
  });
});
