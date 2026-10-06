import { describe, expect, it } from 'vitest';
import { presetRange, rangeLabel } from './FilterBar';

describe('the report and call list date range', () => {
  it('has a last 24 hours preset that ends now', () => {
    const r = presetRange('24h');
    const span = Date.parse(r.to) - Date.parse(r.from);
    expect(span).toBe(24 * 3_600_000);
    expect(Math.abs(Date.parse(r.to) - Date.now())).toBeLessThan(5_000);
  });

  it('reads whole days as dates, and shows the time of day only when one is set', () => {
    const whole = rangeLabel({
      from: new Date(2026, 9, 1, 0, 0).toISOString(),
      to: new Date(2026, 9, 7, 23, 59, 59, 999).toISOString(),
    });
    expect(whole).not.toMatch(/\d:\d\d/);

    const timed = rangeLabel({
      from: new Date(2026, 9, 7, 8, 30).toISOString(),
      to: new Date(2026, 9, 7, 17, 0).toISOString(),
    });
    expect(timed).toMatch(/30/);
    expect(timed.split('→')).toHaveLength(2);
  });

  it('labels the day in local time, not the UTC date', () => {
    const local = new Date(2026, 9, 7, 0, 0);
    const label = rangeLabel({ from: local.toISOString(), to: local.toISOString() });
    expect(label).toContain(
      local.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }),
    );
  });
});
