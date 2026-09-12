/**
 * What happens to the documents a stack was holding when that stack is refused for good.
 *
 * A revoked stack never connects again. Anything still waiting for it would otherwise sit on the
 * customer's history looking like something an owner ought to chase, and go on being counted as a
 * document in flight, which is a number nobody can ever bring back down.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ConsoleOverviewDto } from '@crm/shared';
import { TestContext, type TestOwner } from '../setup/test-app.js';

interface Envelope<T> {
  data: T;
}

let ctx: TestContext;
let owner: TestOwner;
let customerId: string;

beforeAll(async () => {
  ctx = await TestContext.create();
});

afterAll(async () => {
  await ctx.close();
});

beforeEach(async () => {
  await ctx.reset();
  owner = await ctx.createOwner();
  const created = await ctx.as(owner, {
    method: 'POST',
    url: '/api/v1/customers',
    payload: {
      name: 'Kilimani Auto Parts',
      slug: 'kilimani',
      contactName: 'Grace',
      contactEmail: 'grace@kilimani.example',
    },
  });
  expect(created.statusCode, created.body).toBe(201);
  customerId = created.json<Envelope<{ id: string }>>().data.id;
});

async function newStack(): Promise<string> {
  const res = await ctx.as(owner, {
    method: 'POST',
    url: `/api/v1/customers/${customerId}/stacks`,
    payload: {},
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json<Envelope<{ stackId: string }>>().data.stackId;
}

async function overview(): Promise<ConsoleOverviewDto> {
  const res = await ctx.as(owner, { method: 'GET', url: '/api/v1/analytics/overview?days=7' });
  expect(res.statusCode, res.body).toBe(200);
  return res.json<Envelope<ConsoleOverviewDto>>().data;
}

describe('revoking a stack', () => {
  it('closes the documents that were waiting for it', async () => {
    const stackId = await newStack();
    const issued = await ctx.as(owner, {
      method: 'POST',
      url: `/api/v1/customers/${customerId}/issue`,
    });
    expect(issued.statusCode, issued.body).toBe(200);

    // Nothing is connected, so the document sits there waiting, and is counted as outstanding.
    expect(await ctx.app.db.entitlementIssue.count({ where: { stackId, status: 'pending' } })).toBe(
      1,
    );
    expect((await overview()).delivery.pending).toBe(1);

    const revoked = await ctx.as(owner, { method: 'DELETE', url: `/api/v1/stacks/${stackId}` });
    expect(revoked.statusCode, revoked.body).toBe(204);

    expect(
      await ctx.app.db.entitlementIssue.count({
        where: { stackId, status: { in: ['pending', 'delivered'] } },
      }),
    ).toBe(0);
    expect(
      await ctx.app.db.entitlementIssue.count({ where: { stackId, status: 'superseded' } }),
    ).toBe(1);
    // And the console stops claiming something is in flight that never will be.
    expect((await overview()).delivery.pending).toBe(0);

    const row = await ctx.app.db.auditLog.findFirstOrThrow({ where: { action: 'stack.revoke' } });
    expect(JSON.stringify(row.after)).toContain('documentsClosed');
  });

  it('leaves another stack of the same customer alone', async () => {
    const kept = await newStack();
    const revoked = await newStack();
    await ctx.as(owner, { method: 'POST', url: `/api/v1/customers/${customerId}/issue` });
    expect(await ctx.app.db.entitlementIssue.count({ where: { status: 'pending' } })).toBe(2);

    await ctx.as(owner, { method: 'DELETE', url: `/api/v1/stacks/${revoked}` });

    expect(
      await ctx.app.db.entitlementIssue.count({ where: { stackId: kept, status: 'pending' } }),
    ).toBe(1);
    expect((await overview()).delivery.pending).toBe(1);
  });

  it('says when each stack came up, so an owner can see one that keeps restarting', async () => {
    const stackId = await newStack();
    await ctx.app.db.stack.update({
      where: { id: stackId },
      data: { startedAt: new Date('2026-09-11T06:00:00.000Z'), notes: 'Runs on the old box.' },
    });

    const res = await ctx.as(owner, { method: 'GET', url: `/api/v1/customers/${customerId}` });
    expect(res.statusCode, res.body).toBe(200);
    const stack =
      res.json<Envelope<{ stacks: { startedAt: string | null; notes: string }[] }>>().data
        .stacks[0];
    expect(stack?.startedAt).toBe('2026-09-11T06:00:00.000Z');
    expect(stack?.notes).toBe('Runs on the old box.');
  });
});

interface StackRow {
  id: string;
  label: string;
  notes: string;
  customer: { name: string };
  revokedAt: string | null;
}

interface Paged<T> {
  data: T[];
  page: { total: number };
}

async function stacks(query = ''): Promise<Paged<StackRow>> {
  const res = await ctx.as(owner, { method: 'GET', url: `/api/v1/stacks${query}` });
  expect(res.statusCode, res.body).toBe(200);
  return res.json<Paged<StackRow>>();
}

describe('every stack, across every customer', () => {
  it('leaves revoked ones out until they are asked for', async () => {
    const kept = await newStack();
    const gone = await newStack();
    await ctx.as(owner, { method: 'DELETE', url: `/api/v1/stacks/${gone}` });

    expect((await stacks()).data.map((s) => s.id)).toEqual([kept]);
    expect((await stacks('?revoked=only')).data.map((s) => s.id)).toEqual([gone]);
    expect((await stacks('?revoked=include')).page.total).toBe(2);
  });

  it('counts a stack that has never reported in as a stale one', async () => {
    const stackId = await newStack();
    // Never heard from is the case most worth finding, so it is included rather than skipped.
    expect((await stacks('?staleMinutes=10')).data.map((s) => s.id)).toEqual([stackId]);

    await ctx.app.db.stack.update({ where: { id: stackId }, data: { lastSeenAt: new Date() } });
    expect((await stacks('?staleMinutes=10')).data).toHaveLength(0);
  });

  it('finds one by the customer it belongs to', async () => {
    const stackId = await newStack();
    const found = await stacks('?q=Kilimani');
    expect(found.data.map((s) => s.id)).toEqual([stackId]);
    expect(found.data[0]?.customer.name).toBe('Kilimani Auto Parts');
  });

  it('takes a label and a note about the server it runs on', async () => {
    const stackId = await newStack();
    const res = await ctx.as(owner, {
      method: 'PATCH',
      url: `/api/v1/stacks/${stackId}`,
      payload: { label: 'nairobi-box-2', notes: 'Old hardware, due to move in October.' },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json<Envelope<StackRow>>().data.label).toBe('nairobi-box-2');

    const row = await ctx.app.db.auditLog.findFirstOrThrow({ where: { action: 'stack.update' } });
    expect(JSON.stringify(row.after)).toContain('nairobi-box-2');
  });
});

describe('handing a stack its document again', () => {
  it('puts the newest one back in the queue without signing anything new', async () => {
    const stackId = await newStack();
    await ctx.as(owner, { method: 'POST', url: `/api/v1/customers/${customerId}/issue` });
    const issue = await ctx.app.db.entitlementIssue.findFirstOrThrow({ where: { stackId } });
    // Pretend the stack applied it and then lost it, which is what a restored backup looks like.
    await ctx.app.db.entitlementIssue.update({
      where: { id: issue.id },
      data: { status: 'acked', ackedAt: new Date() },
    });

    const res = await ctx.as(owner, {
      method: 'POST',
      url: `/api/v1/stacks/${stackId}/redeliver`,
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json<Envelope<{ issueId: string }>>().data.issueId).toBe(issue.id);

    const after = await ctx.app.db.entitlementIssue.findUniqueOrThrow({ where: { id: issue.id } });
    expect(after.status).toBe('pending');
    // The same document, not a new one: what was agreed has not changed.
    expect(await ctx.app.db.entitlementIssue.count({ where: { stackId } })).toBe(1);

    const actions = (await ctx.app.db.auditLog.findMany()).map((a) => a.action);
    expect(actions).toContain('stack.redeliver');
  });

  it('says plainly when there is nothing to send again', async () => {
    const stackId = await newStack();
    const res = await ctx.as(owner, {
      method: 'POST',
      url: `/api/v1/stacks/${stackId}/redeliver`,
    });
    expect(res.statusCode).toBe(409);
    expect(res.body).toContain('never been issued');
  });

  it('refuses to send anything to a stack that was revoked', async () => {
    const stackId = await newStack();
    await ctx.as(owner, { method: 'POST', url: `/api/v1/customers/${customerId}/issue` });
    await ctx.as(owner, { method: 'DELETE', url: `/api/v1/stacks/${stackId}` });

    const res = await ctx.as(owner, {
      method: 'POST',
      url: `/api/v1/stacks/${stackId}/redeliver`,
    });
    expect(res.statusCode).toBe(409);
    expect(res.body).toContain('revoked');
  });

  it('lists what that one stack has been sent, newest first', async () => {
    const stackId = await newStack();
    await ctx.as(owner, { method: 'POST', url: `/api/v1/customers/${customerId}/issue` });
    await ctx.as(owner, { method: 'POST', url: `/api/v1/customers/${customerId}/issue` });

    const res = await ctx.as(owner, { method: 'GET', url: `/api/v1/stacks/${stackId}/issues` });
    expect(res.statusCode, res.body).toBe(200);
    const list = res.json<Paged<{ status: string; issuedAt: string }>>();
    expect(list.page.total).toBe(2);
    // The newer one supersedes the older, and the newest is at the top.
    expect(list.data[0]?.status).toBe('pending');
    expect(list.data[1]?.status).toBe('superseded');
  });
});
