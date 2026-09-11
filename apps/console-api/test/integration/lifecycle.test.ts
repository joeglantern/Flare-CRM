/**
 * Filing a customer away, and getting them back.
 *
 * The rule these tests exist for is that nothing is ever deleted here. A customer who left is a
 * customer we can still answer questions about a year later, so archiving hides them and the
 * database refuses the alternative outright.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TestContext, type TestOwner } from '../setup/test-app.js';

interface Envelope<T> {
  data: T;
}

interface CustomerShape {
  id: string;
  status: string;
  archivedAt: string | null;
  archiveReason: string | null;
  churnReason: string | null;
  churnedAt: string | null;
  onboardingStage: string;
  onboardingChecklist: Record<string, boolean>;
}

let ctx: TestContext;
let owner: TestOwner;

beforeAll(async () => {
  ctx = await TestContext.create();
});

afterAll(async () => {
  await ctx.close();
});

beforeEach(async () => {
  await ctx.reset();
  owner = await ctx.createOwner();
});

async function newCustomer(slug = 'acme'): Promise<string> {
  const res = await ctx.as(owner, {
    method: 'POST',
    url: '/api/v1/customers',
    payload: { name: 'Acme Ltd', slug, contactName: 'Jane', contactEmail: 'jane@acme.example' },
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json<Envelope<{ id: string }>>().data.id;
}

describe('archiving a customer', () => {
  it('files them away, says why, and holds their CRM read only', async () => {
    const id = await newCustomer();
    await ctx.as(owner, { method: 'POST', url: `/api/v1/customers/${id}/stacks`, payload: {} });

    const res = await ctx.as(owner, {
      method: 'POST',
      url: `/api/v1/customers/${id}/archive`,
      payload: { reason: 'price', note: 'Went with a cheaper system in August.' },
    });
    expect(res.statusCode, res.body).toBe(200);
    const customer = res.json<Envelope<CustomerShape>>().data;
    expect(customer.archivedAt).not.toBeNull();
    expect(customer.churnReason).toBe('price');
    expect(customer.churnedAt).not.toBeNull();
    expect(customer.status).toBe('churned');

    // Read only is not a word in a column: it is an expiry their own server already understands.
    const entitlement = await ctx.app.db.customerEntitlement.findUniqueOrThrow({
      where: { customerId: id },
    });
    expect(entitlement.expiresAt).not.toBeNull();
    expect(entitlement.expiresAt?.getTime()).toBeLessThanOrEqual(Date.now());

    // And a signed document carrying it is already on its way to the stack.
    const issues = await ctx.app.db.entitlementIssue.findMany({ where: { customerId: id } });
    expect(issues.length).toBeGreaterThan(0);

    const row = await ctx.app.db.auditLog.findFirstOrThrow({
      where: { action: 'customer.archive' },
    });
    expect(row.entityId).toBe(id);
    expect(JSON.stringify(row.after)).toContain('price');
  });

  it('refuses to archive the same customer twice', async () => {
    const id = await newCustomer();
    await ctx.as(owner, {
      method: 'POST',
      url: `/api/v1/customers/${id}/archive`,
      payload: { reason: 'went_quiet' },
    });
    const again = await ctx.as(owner, {
      method: 'POST',
      url: `/api/v1/customers/${id}/archive`,
      payload: { reason: 'went_quiet' },
    });
    expect(again.statusCode).toBe(409);
    expect(again.body).toContain('already archived');
  });

  it('brings them back without pretending their plan is live again', async () => {
    const id = await newCustomer();
    await ctx.as(owner, {
      method: 'POST',
      url: `/api/v1/customers/${id}/archive`,
      payload: { reason: 'closed_business' },
    });

    const res = await ctx.as(owner, { method: 'POST', url: `/api/v1/customers/${id}/unarchive` });
    expect(res.statusCode, res.body).toBe(200);
    const customer = res.json<Envelope<CustomerShape>>().data;
    expect(customer.archivedAt).toBeNull();
    // Still churned: taking them out of the drawer is not the same as selling to them again.
    expect(customer.status).toBe('churned');
    expect(customer.churnReason).toBe('closed_business');

    const actions = (await ctx.app.db.auditLog.findMany()).map((a) => a.action);
    expect(actions).toContain('customer.unarchive');
  });

  it('will not let anything delete a customer, whatever asks', async () => {
    const id = await newCustomer();
    await expect(ctx.app.db.customer.delete({ where: { id } })).rejects.toThrow(/never deleted/);
    expect(await ctx.app.db.customer.count({ where: { id } })).toBe(1);
  });
});

describe('how far along a customer is', () => {
  it('records the stage and merges the checklist rather than replacing it', async () => {
    const id = await newCustomer();

    await ctx.as(owner, {
      method: 'PATCH',
      url: `/api/v1/customers/${id}`,
      payload: { onboardingStage: 'provisioning', onboardingChecklist: { agreement_signed: true } },
    });
    const second = await ctx.as(owner, {
      method: 'PATCH',
      url: `/api/v1/customers/${id}`,
      payload: { onboardingChecklist: { training_done: true } },
    });

    expect(second.statusCode, second.body).toBe(200);
    const customer = second.json<Envelope<CustomerShape>>().data;
    expect(customer.onboardingStage).toBe('provisioning');
    // Ticking one box does not clear the one somebody else ticked last week.
    expect(customer.onboardingChecklist).toEqual({ agreement_signed: true, training_done: true });
  });
});
