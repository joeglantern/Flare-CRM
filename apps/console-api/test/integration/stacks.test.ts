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
