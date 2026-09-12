/**
 * The alert inbox: what an owner does about a finding, and what the next sweep makes of that.
 *
 * The rule worth pinning down is that none of these make the underlying thing untrue. Acknowledging
 * says somebody has seen it, muting says stop telling me, and closing says it is dealt with; if the
 * cause is still there the next sweep opens a fresh alert rather than quietly reopening the closed
 * one, so the decision to close stays on the record.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TestContext, type TestOwner } from '../setup/test-app.js';

interface Envelope<T> {
  data: T;
}

interface Paged<T> {
  data: T[];
  page: { total: number };
}

interface AlertShape {
  id: string;
  kind: string;
  state: string;
  summary: string;
  acknowledgedByName: string | null;
  closeReason: string | null;
}

const HOUR = 3_600_000;

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
  owner = await ctx.createOwner({ name: 'The owner' });
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

/** A stack registered long enough ago that never having connected is a fault. */
async function silentStack(): Promise<string> {
  const res = await ctx.as(owner, {
    method: 'POST',
    url: `/api/v1/customers/${customerId}/stacks`,
    payload: {},
  });
  expect(res.statusCode, res.body).toBe(201);
  const stackId = res.json<Envelope<{ stackId: string }>>().data.stackId;
  await ctx.app.db.stack.update({
    where: { id: stackId },
    data: { createdAt: new Date(Date.now() - 48 * HOUR) },
  });
  return stackId;
}

async function alerts(query = ''): Promise<Paged<AlertShape>> {
  const res = await ctx.as(owner, { method: 'GET', url: `/api/v1/alerts${query}` });
  expect(res.statusCode, res.body).toBe(200);
  return res.json<Paged<AlertShape>>();
}

describe('a stack that was never started', () => {
  it('is noticed, which is the whole point of the check', async () => {
    await silentStack();
    const swept = await ctx.app.alerts.sweep();
    expect(swept.opened).toBeGreaterThanOrEqual(1);

    const open = await alerts('?state=open');
    const found = open.data.find((a) => a.kind === 'stack_never_connected');
    expect(found).toBeDefined();
    expect(found?.summary).toContain('never reported in');
  });

  it('is not opened twice, however often the sweep runs', async () => {
    await silentStack();
    await ctx.app.alerts.sweep();
    const second = await ctx.app.alerts.sweep();
    expect(second.opened).toBe(0);
    expect(await ctx.app.db.consoleAlert.count({ where: { kind: 'stack_never_connected' } })).toBe(
      1,
    );
  });
});

describe('what an owner does about one', () => {
  it('acknowledges it, and it stays open with a name against it', async () => {
    await silentStack();
    await ctx.app.alerts.sweep();
    const [alert] = (await alerts('?state=open')).data;

    const res = await ctx.as(owner, {
      method: 'POST',
      url: `/api/v1/alerts/${alert?.id ?? ''}/ack`,
      payload: { note: 'Waiting for them to bring the server up.' },
    });
    expect(res.statusCode, res.body).toBe(200);
    const acked = res.json<Envelope<AlertShape>>().data;
    expect(acked.state).toBe('acked');
    expect(acked.acknowledgedByName).toBe('The owner');

    // Still a fact, still listed, simply no longer asking for attention.
    expect((await alerts('?state=open')).data).toHaveLength(0);
    expect((await alerts('?state=acked')).data).toHaveLength(1);
    const summary = await ctx.as(owner, { method: 'GET', url: '/api/v1/alerts/summary' });
    expect(summary.json<Envelope<{ open: number; acked: number }>>().data).toMatchObject({
      open: 0,
      acked: 1,
    });
  });

  it('sets one aside, and it comes back by itself', async () => {
    await silentStack();
    await ctx.app.alerts.sweep();
    const [alert] = (await alerts('?state=open')).data;

    await ctx.as(owner, {
      method: 'POST',
      url: `/api/v1/alerts/${alert?.id ?? ''}/snooze`,
      payload: { hours: 24 },
    });
    expect((await alerts('?state=snoozed')).data).toHaveLength(1);

    // Time passes: the alert was set aside, not dealt with.
    await ctx.app.db.consoleAlert.update({
      where: { id: alert?.id ?? '' },
      data: { snoozedUntil: new Date(Date.now() - HOUR) },
    });
    expect((await alerts('?state=open')).data).toHaveLength(1);
  });

  it('closes one by hand, and the next sweep opens a new one if it is still true', async () => {
    await silentStack();
    await ctx.app.alerts.sweep();
    const [alert] = (await alerts('?state=open')).data;

    const closed = await ctx.as(owner, {
      method: 'POST',
      url: `/api/v1/alerts/${alert?.id ?? ''}/close`,
      payload: { reason: 'Spoke to them, the server is being rebuilt.' },
    });
    expect(closed.statusCode, closed.body).toBe(200);
    expect(closed.json<Envelope<AlertShape>>().data.state).toBe('closed');

    const again = await ctx.app.alerts.sweep();
    expect(again.opened).toBe(1);
    const rows = await ctx.app.db.consoleAlert.findMany({
      where: { kind: 'stack_never_connected' },
      orderBy: { openedAt: 'asc' },
    });
    // Two rows: the closed decision, and the fresh finding that says so.
    expect(rows).toHaveLength(2);
    expect(rows[0]?.closeReason).toContain('being rebuilt');
    expect(JSON.stringify(rows[1]?.context)).toContain('reopenedFrom');
  });
});

describe('muting', () => {
  it('stops an alert opening at all, and says why', async () => {
    await silentStack();
    const muted = await ctx.as(owner, {
      method: 'POST',
      url: '/api/v1/alerts/mutes',
      payload: {
        kind: 'stack_never_connected',
        customerId,
        reason: 'They are not going live until November.',
      },
    });
    expect(muted.statusCode, muted.body).toBe(201);

    const swept = await ctx.app.alerts.sweep();
    expect(swept.opened).toBe(0);
    expect(swept.muted).toBeGreaterThanOrEqual(1);
    expect(await ctx.app.db.consoleAlert.count()).toBe(0);

    const mutes = await ctx.as(owner, { method: 'GET', url: '/api/v1/alerts/mutes' });
    expect(mutes.json<Envelope<{ customerName: string | null }[]>>().data[0]?.customerName).toBe(
      'Kilimani Auto Parts',
    );
  });

  it('lets the alert through again once the mute is lifted', async () => {
    await silentStack();
    const muted = await ctx.as(owner, {
      method: 'POST',
      url: '/api/v1/alerts/mutes',
      payload: { kind: 'stack_never_connected', customerId, reason: 'Not yet.' },
    });
    const muteId = muted.json<Envelope<{ id: string }>>().data.id;
    await ctx.app.alerts.sweep();

    await ctx.as(owner, { method: 'DELETE', url: `/api/v1/alerts/mutes/${muteId}` });
    const swept = await ctx.app.alerts.sweep();
    expect(swept.opened).toBe(1);
  });
});

describe('what the sweep is told to look for', () => {
  it('uses the thresholds an owner set, not the ones it shipped with', async () => {
    const stackId = await silentStack();
    // Two hours old is not a fault by default; it is once the threshold says one hour.
    await ctx.app.db.stack.update({
      where: { id: stackId },
      data: { createdAt: new Date(Date.now() - 2 * HOUR) },
    });
    expect((await ctx.app.alerts.sweep()).opened).toBe(0);

    const saved = await ctx.as(owner, {
      method: 'PUT',
      url: '/api/v1/alerts/settings',
      payload: { thresholds: { neverConnectedHours: 1 } },
    });
    expect(saved.statusCode, saved.body).toBe(200);
    ctx.app.settings.forget();

    expect((await ctx.app.alerts.sweep()).opened).toBe(1);
    const actions = (await ctx.app.db.auditLog.findMany()).map((a) => a.action);
    expect(actions).toContain('alert.settings_update');
  });
});
