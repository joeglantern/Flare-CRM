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

async function newCustomer(slug = 'acme', name = 'Acme Ltd'): Promise<string> {
  const res = await ctx.as(owner, {
    method: 'POST',
    url: '/api/v1/customers',
    payload: { name, slug, contactName: 'Jane', contactEmail: 'jane@acme.example' },
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json<Envelope<{ id: string }>>().data.id;
}

interface Paged<T> {
  data: T[];
  page: { page: number; pageSize: number; total: number };
}

interface FleetShape {
  customer: CustomerShape & { name: string };
}

async function fleet(query = ''): Promise<Paged<FleetShape>> {
  const res = await ctx.as(owner, { method: 'GET', url: `/api/v1/fleet${query}` });
  expect(res.statusCode, res.body).toBe(200);
  return res.json<Paged<FleetShape>>();
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

describe('the fleet, narrowed', () => {
  it('leaves archived customers out of the way, and hands them back when asked', async () => {
    const staying = await newCustomer('staying', 'Staying Ltd');
    const gone = await newCustomer('gone', 'Gone Ltd');
    await ctx.as(owner, {
      method: 'POST',
      url: `/api/v1/customers/${gone}/archive`,
      payload: { reason: 'closed_business' },
    });

    const byDefault = await fleet();
    expect(byDefault.data.map((r) => r.customer.id)).toEqual([staying]);
    expect(byDefault.page.total).toBe(1);

    const only = await fleet('?archived=only');
    expect(only.data.map((r) => r.customer.id)).toEqual([gone]);

    const both = await fleet('?archived=include');
    expect(both.page.total).toBe(2);
  });

  it('searches by name and filters by status on the server', async () => {
    await newCustomer('kilimani', 'Kilimani Auto Parts');
    const other = await newCustomer('thika', 'Thika Road Logistics');

    const searched = await fleet('?q=thika');
    expect(searched.data.map((r) => r.customer.id)).toEqual([other]);

    await ctx.as(owner, {
      method: 'PATCH',
      url: `/api/v1/customers/${other}`,
      payload: { status: 'suspended' },
    });
    const suspended = await fleet('?status=suspended');
    expect(suspended.data.map((r) => r.customer.id)).toEqual([other]);
    expect((await fleet('?status=active')).data.map((r) => r.customer.id)).not.toContain(other);
  });

  it('hands back one page at a time, and says how many there are altogether', async () => {
    await newCustomer('one', 'One Ltd');
    await newCustomer('two', 'Two Ltd');
    await newCustomer('three', 'Three Ltd');

    const first = await fleet('?pageSize=2&page=1');
    expect(first.data).toHaveLength(2);
    expect(first.page.total).toBe(3);

    const second = await fleet('?pageSize=2&page=2');
    expect(second.data).toHaveLength(1);
    // No customer appears on both pages, which is what makes the count worth printing.
    const ids = [...first.data, ...second.data].map((r) => r.customer.id);
    expect(new Set(ids).size).toBe(3);
  });
});

describe('doing something to a selection', () => {
  it('archives several, and records each one as well as the batch', async () => {
    const ids = [
      await newCustomer('alpha', 'Alpha Ltd'),
      await newCustomer('bravo', 'Bravo Ltd'),
      await newCustomer('charlie', 'Charlie Ltd'),
    ];

    const res = await ctx.as(owner, {
      method: 'POST',
      url: '/api/v1/customers/bulk/archive',
      payload: { ids, reason: 'price' },
    });
    expect(res.statusCode, res.body).toBe(200);
    const outcome = res.json<Envelope<{ ok: number; failed: number }>>().data;
    expect(outcome).toMatchObject({ ok: 3, failed: 0 });
    expect(await ctx.app.db.customer.count({ where: { archivedAt: null } })).toBe(0);

    const actions = (await ctx.app.db.auditLog.findMany()).map((a) => a.action);
    expect(actions.filter((a) => a === 'customer.archive')).toHaveLength(3);
    expect(actions).toContain('customer.bulk_archive');
  });

  it('holds every one of them read only when the status changes', async () => {
    const ids = [await newCustomer('delta', 'Delta Ltd'), await newCustomer('echo', 'Echo Ltd')];

    const res = await ctx.as(owner, {
      method: 'POST',
      url: '/api/v1/customers/bulk/status',
      payload: { ids, status: 'suspended' },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json<Envelope<{ ok: number }>>().data.ok).toBe(2);

    const entitlements = await ctx.app.db.customerEntitlement.findMany({
      where: { customerId: { in: ids } },
    });
    expect(entitlements).toHaveLength(2);
    for (const entitlement of entitlements) {
      expect(entitlement.expiresAt).not.toBeNull();
    }
  });

  it('carries on past the one that fails, and says which it was', async () => {
    const withStack = await newCustomer('has-stack', 'Has Stack Ltd');
    const without = await newCustomer('no-stack', 'No Stack Ltd');
    await ctx.as(owner, {
      method: 'POST',
      url: `/api/v1/customers/${withStack}/stacks`,
      payload: {},
    });

    const res = await ctx.as(owner, {
      method: 'POST',
      url: '/api/v1/customers/bulk/issue',
      payload: { ids: [without, withStack] },
    });
    expect(res.statusCode, res.body).toBe(200);
    const outcome =
      res.json<
        Envelope<{
          ok: number;
          failed: number;
          results: { customerId: string; ok: boolean; error?: string }[];
        }>
      >().data;
    expect(outcome).toMatchObject({ ok: 1, failed: 1 });
    const failure = outcome.results.find((r) => !r.ok);
    expect(failure?.customerId).toBe(without);
    expect(failure?.error).toContain('No stack');
    // The one that could be issued to still was, which is the point of not stopping.
    expect(await ctx.app.db.entitlementIssue.count({ where: { customerId: withStack } })).toBe(1);
  });

  it('refuses a selection larger than it will do in one go', async () => {
    const ids = Array.from({ length: 101 }, () => crypto.randomUUID());
    const res = await ctx.as(owner, {
      method: 'POST',
      url: '/api/v1/customers/bulk/status',
      payload: { ids, status: 'suspended' },
    });
    // The schema refuses it before a single document is signed.
    expect(res.statusCode).toBe(422);
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
