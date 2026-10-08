import { describe, expect, it } from 'vitest';
import { rangeLabel } from '@/lib/range-label';
import { presetRange } from './FilterBar';

const NBO = 'Africa/Nairobi';
const NOW = new Date('2026-10-08T22:30:00Z'); // already the 9th in Nairobi

describe('the report and call list date range, on the CRM clock', () => {
  it('has a last 24 hours preset that ends now', () => {
    const r = presetRange('24h', NBO, NOW);
    expect(Date.parse(r.to) - Date.parse(r.from)).toBe(24 * 3_600_000);
    expect(r.to).toBe(NOW.toISOString());
  });

  it('starts today at the CRM midnight, not the computer one', () => {
    const r = presetRange('today', NBO, NOW);
    expect(r.from).toBe('2026-10-08T21:00:00.000Z');
    expect(r.to).toBe('2026-10-09T20:59:59.999Z');
    expect(presetRange('month', NBO, NOW).from).toBe('2026-09-30T21:00:00.000Z');
  });

  it('reads whole days as dates, and shows the time of day only when one is set', () => {
    expect(rangeLabel(presetRange('today', NBO, NOW), NBO)).toBe('9 Oct 2026 → 9 Oct 2026');
    expect(
      rangeLabel({ from: '2026-10-09T05:30:00.000Z', to: '2026-10-09T14:00:00.000Z' }, NBO),
    ).toBe('9 Oct 2026 08:30 → 9 Oct 2026 17:00');
  });
});
