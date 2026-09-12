/**
 * What a customer is charged, which is the one piece of arithmetic in this console that turns into
 * money. Four things can hold the figure down and they do not all mean the same thing, so the order
 * they are applied in matters and is pinned here.
 */
import { describe, expect, it } from 'vitest';
import { RollupService, type Agreement } from './rollup.service.js';

const NOW = new Date('2026-09-12T00:00:00.000Z');
const LATER = new Date('2026-10-12T00:00:00.000Z');
const EARLIER = new Date('2026-08-12T00:00:00.000Z');

function agreement(over: Partial<Agreement> = {}): Agreement {
  return {
    plan: { priceMonthlyMinor: 150000 },
    priceMonthlyMinorOverride: null,
    expiresAt: null,
    trialEndsAt: null,
    discountPercent: null,
    discountUntil: null,
    ...over,
  };
}

describe('what a customer is charged', () => {
  it('bills the plan price when nothing special applies', () => {
    expect(RollupService.effectivePrice(agreement(), NOW)).toEqual({
      listMinor: 150000,
      chargedMinor: 150000,
      state: 'full',
    });
  });

  it('bills what they negotiated instead of what the plan says', () => {
    const charge = RollupService.effectivePrice(
      agreement({ priceMonthlyMinorOverride: 90000 }),
      NOW,
    );
    expect(charge).toEqual({ listMinor: 90000, chargedMinor: 90000, state: 'full' });
  });

  it('charges a trial nothing, while still knowing what it would be worth', () => {
    const charge = RollupService.effectivePrice(agreement({ trialEndsAt: LATER }), NOW);
    expect(charge).toEqual({ listMinor: 150000, chargedMinor: 0, state: 'trial' });
  });

  it('starts charging the moment a trial has run out', () => {
    const charge = RollupService.effectivePrice(agreement({ trialEndsAt: EARLIER }), NOW);
    expect(charge.state).toBe('full');
    expect(charge.chargedMinor).toBe(150000);
  });

  it('takes a percentage off, and rounds to whole minor units', () => {
    // A third off 1,500.00 is 1,000.00 exactly; an odd percentage is where rounding shows.
    expect(RollupService.effectivePrice(agreement({ discountPercent: 20 }), NOW).chargedMinor).toBe(
      120000,
    );
    expect(RollupService.effectivePrice(agreement({ discountPercent: 33 }), NOW).chargedMinor).toBe(
      100500,
    );
    expect(
      RollupService.effectivePrice(
        agreement({ discountPercent: 15, plan: { priceMonthlyMinor: 99 } }),
        NOW,
      ).chargedMinor,
    ).toBe(84);
  });

  it('stops applying a discount once its date has passed', () => {
    const stillOn = RollupService.effectivePrice(
      agreement({ discountPercent: 20, discountUntil: LATER }),
      NOW,
    );
    expect(stillOn.state).toBe('discounted');
    const over = RollupService.effectivePrice(
      agreement({ discountPercent: 20, discountUntil: EARLIER }),
      NOW,
    );
    expect(over).toEqual({ listMinor: 150000, chargedMinor: 150000, state: 'full' });
  });

  it('earns nothing from an expired plan, whatever else is set', () => {
    // Expired wins over a trial and over a discount: their CRM is read only, so nothing is owed.
    const charge = RollupService.effectivePrice(
      agreement({ expiresAt: EARLIER, trialEndsAt: LATER, discountPercent: 50 }),
      NOW,
    );
    expect(charge).toEqual({ listMinor: 150000, chargedMinor: 0, state: 'expired' });
  });

  it('treats a plan with no price, and no plan at all, as nothing owed', () => {
    expect(
      RollupService.effectivePrice(agreement({ plan: { priceMonthlyMinor: null } }), NOW)
        .chargedMinor,
    ).toBe(0);
    expect(RollupService.effectivePrice(agreement({ plan: null }), NOW).chargedMinor).toBe(0);
  });

  it('ignores a discount of nothing rather than calling it a discount', () => {
    const charge = RollupService.effectivePrice(agreement({ discountPercent: 0 }), NOW);
    expect(charge.state).toBe('full');
    expect(charge.chargedMinor).toBe(150000);
  });
});
