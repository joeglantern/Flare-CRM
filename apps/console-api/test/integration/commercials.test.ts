/**
 * What a customer is agreed to pay, and what the console says is at risk.
 *
 * A trial is not a discount of a hundred percent and an expired plan is not a discount either. They
 * hold the figure down for different reasons, they end on different days, and what is worth chasing
 * about each one is different. These tests are that distinction, in money.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ConsoleOverviewDto, RevenueAnalyticsDto } from '@crm/shared';
import { TestContext, type TestOwner } from '../setup/test-app.js';

interface Envelope<T> {
  data: T;
}

const DAY = 86_400_000;

let ctx: TestContext;
let owner: TestOwner;
let planId: string;

beforeAll(async () => {
  ctx = await TestContext.create();
});

afterAll(async () => {
  await ctx.close();
});

beforeEach(async () => {
  await ctx.reset();
  owner = await ctx.createOwner();
  const plans = await ctx.as(owner, { method: 'GET', url: '/api/v1/plans' });
  planId = plans.json<{ data: { id: string }[] }>().data[0]?.id ?? '';
  await ctx.as(owner, {
    method: 'PATCH',
    url: `/api/v1/plans/${planId}`,
    payload: { priceMonthlyMinor: 150000, currency: 'KES' },
  });
});

async function newCustomer(slug: string): Promise<string> {
  const res = await ctx.as(owner, {
    method: 'POST',
    url: '/api/v1/customers',
    payload: {
      name: `${slug} Ltd`,
      slug,
      contactName: 'Jane',
      contactEmail: `${slug}@example.com`,
    },
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json<Envelope<{ id: string }>>().data.id;
}

async function agree(customerId: string, payload: Record<string, unknown>): Promise<void> {
  const res = await ctx.as(owner, {
    method: 'PUT',
    url: `/api/v1/customers/${customerId}/entitlements`,
    payload,
  });
  expect(res.statusCode, res.body).toBe(200);
}

async function revenue(): Promise<RevenueAnalyticsDto> {
  const res = await ctx.as(owner, { method: 'GET', url: '/api/v1/analytics/revenue' });
  expect(res.statusCode, res.body).toBe(200);
  return res.json<Envelope<RevenueAnalyticsDto>>().data;
}

async function overview(): Promise<ConsoleOverviewDto> {
  const res = await ctx.as(owner, { method: 'GET', url: '/api/v1/analytics/overview?days=7' });
  expect(res.statusCode, res.body).toBe(200);
  return res.json<Envelope<ConsoleOverviewDto>>().data;
}

describe('what a customer is charged', () => {
  it('counts a trial as nothing owed, and says what it would be worth', async () => {
    const id = await newCustomer('trialling');
    await agree(id, { trialEndsAt: new Date(Date.now() + 20 * DAY).toISOString() });

    const money = await revenue();
    expect(money.mrrMinor).toBe(0);
    expect(money.trials).toEqual({ count: 1, minorWhenConverted: 150000 });
    expect((await overview()).now.trials).toBe(1);
    expect(id).not.toBe('');
  });

  it('takes a discount off the list price, and says what it costs us', async () => {
    const id = await newCustomer('discounted');
    await agree(id, { discountPercent: 20, discountNote: 'Two year commitment.' });

    const money = await revenue();
    expect(money.mrrMinor).toBe(120000);
    expect(money.discounts).toEqual({ count: 1, minorGivenAway: 30000 });
    expect(id).not.toBe('');
  });

  it('stops taking it off once the discount has run out', async () => {
    const id = await newCustomer('was-discounted');
    await agree(id, {
      discountPercent: 20,
      discountUntil: new Date(Date.now() - DAY).toISOString(),
    });

    expect((await revenue()).mrrMinor).toBe(150000);
    expect(id).not.toBe('');
  });

  it('keeps the agreement in a snapshot of the day, once it is rolled up', async () => {
    const id = await newCustomer('rolled');
    await agree(id, { discountPercent: 50 });

    const summary = await ctx.app.rollup.run();
    expect(summary.mrrMinor).toBe(75000);
    const today = await ctx.app.db.fleetDay.findFirstOrThrow();
    expect(today.mrrMinor).toBe(75000);
    expect(id).not.toBe('');
  });
});

describe('what is at risk', () => {
  it('splits it by the reason it is at risk', async () => {
    const expiring = await newCustomer('expiring');
    await agree(expiring, { expiresAt: new Date(Date.now() + 10 * DAY).toISOString() });

    const ending = await newCustomer('trial-ending');
    await agree(ending, { trialEndsAt: new Date(Date.now() + 5 * DAY).toISOString() });

    const money = await revenue();
    const reasons = Object.fromEntries(money.atRisk.byReason.map((r) => [r.reason, r]));
    expect(reasons.expiring?.customers).toBe(1);
    expect(reasons.expiring?.minor).toBe(150000);
    // A trial ending risks what they would start paying, not the nothing they pay today.
    expect(reasons.trial_ending?.customers).toBe(1);
    expect(reasons.trial_ending?.minor).toBe(150000);
    expect(money.atRisk.customers).toBe(2);
  });

  it('counts a renewal coming round within the month', async () => {
    const id = await newCustomer('renewing');
    const soon = new Date(Date.now() + 12 * DAY).toISOString().slice(0, 10);
    await agree(id, { renewsOn: soon });

    expect((await overview()).now.renewalsDue30d).toBe(1);
    expect(id).not.toBe('');
  });

  it('hands the agreement back as it was stored', async () => {
    const id = await newCustomer('reading-back');
    const until = new Date(Date.now() + 30 * DAY).toISOString();
    await agree(id, { discountPercent: 15, discountUntil: until, discountNote: 'Intro rate.' });

    const res = await ctx.as(owner, {
      method: 'GET',
      url: `/api/v1/customers/${id}/entitlements`,
    });
    expect(res.statusCode, res.body).toBe(200);
    const agreement = res.json<
      Envelope<{
        discountPercent: number | null;
        discountNote: string;
        effective: { chargedPriceMonthlyMinor: number; priceState: string };
      }>
    >().data;
    expect(agreement.discountPercent).toBe(15);
    expect(agreement.discountNote).toBe('Intro rate.');
    expect(agreement.effective.priceState).toBe('discounted');
    expect(agreement.effective.chargedPriceMonthlyMinor).toBe(127500);
  });
});
