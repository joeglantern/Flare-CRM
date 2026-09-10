/**
 * What the console measures, and what it does about what it measures.
 *
 * The dashboard is only worth having if the numbers behind it are real, so these tests drive
 * heartbeats through the actual link, roll them up with the actual service, and read the actual
 * endpoints. Nothing here fabricates a sample.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import { LINK_PROTOCOL, type ConsoleOverviewDto, type CustomerAnalyticsDto } from '@crm/shared';
import { TestContext, type TestOwner } from '../setup/test-app.js';

interface Envelope<T> {
  data: T;
}

let ctx: TestContext;
let owner: TestOwner;
let port = 0;
const clients: ClientSocket[] = [];

beforeAll(async () => {
  ctx = await TestContext.create();
  await ctx.app.listen({ port: 0, host: '127.0.0.1' });
  const address = ctx.app.server.address();
  port = typeof address === 'object' && address !== null ? address.port : 0;
});

beforeEach(async () => {
  for (const client of clients.splice(0)) client.disconnect();
  await ctx.reset();
  owner = await ctx.createOwner();
});

afterEach(() => {
  for (const client of clients.splice(0)) client.disconnect();
});

afterAll(async () => {
  await ctx.close();
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

async function newStack(customerId: string): Promise<{ stackId: string; secret: string }> {
  const res = await ctx.as(owner, {
    method: 'POST',
    url: `/api/v1/customers/${customerId}/stacks`,
    payload: {},
  });
  return res.json<Envelope<{ stackId: string; secret: string }>>().data;
}

function connectStack(stackId: string, secret: string): Promise<ClientSocket> {
  const socket = ioClient(`http://127.0.0.1:${String(port)}/link`, {
    transports: ['websocket'],
    reconnection: false,
    forceNew: true,
    auth: { stackId, secret, protocol: LINK_PROTOCOL },
  });
  clients.push(socket);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('the stack never connected'));
    }, 10_000);
    socket.once('connect', () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once('connect_error', (err: Error) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

function heartbeat(over: { seats?: number; storage?: number; ready?: boolean } = {}) {
  return {
    at: new Date().toISOString(),
    version: 'abc1234',
    ready: { ok: over.ready ?? true, checks: { database: { ok: over.ready ?? true } } },
    usage: {
      seatsActive: over.seats ?? 4,
      storageBytes: over.storage ?? 5 * 1024 ** 3,
      attachmentsBytes: 1024,
      recordingsBytes: 2048,
      backupsBytes: 4096,
    },
    lastBackupAt: new Date().toISOString(),
    entitlements: { issueId: null, issuedAt: null, keyId: null },
  };
}

describe('what the console records about a fleet', () => {
  it('keeps one sample in five minutes, however often a stack reports', async () => {
    const customerId = await newCustomer();
    const { stackId, secret } = await newStack(customerId);
    const stack = await connectStack(stackId, secret);

    stack.emit('heartbeat', heartbeat({ seats: 4 }));
    await expect.poll(() => ctx.app.db.stackSample.count()).toBe(1);

    // Thirty seconds later a real stack beats again; the console keeps its powder dry.
    stack.emit('heartbeat', heartbeat({ seats: 9 }));
    stack.emit('heartbeat', heartbeat({ seats: 9 }));
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(await ctx.app.db.stackSample.count()).toBe(1);

    const sample = await ctx.app.db.stackSample.findFirstOrThrow();
    expect(sample.seatsActive).toBe(4);
    expect(Number(sample.storageBytes)).toBe(5 * 1024 ** 3);
    expect(sample.readyOk).toBe(true);
    expect(sample.version).toBe('abc1234');
  });

  it('folds samples into a day and the fleet into a row', async () => {
    const customerId = await newCustomer();
    const { stackId, secret } = await newStack(customerId);
    const stack = await connectStack(stackId, secret);
    stack.emit('heartbeat', heartbeat({ seats: 7, storage: 1024 }));
    await expect.poll(() => ctx.app.db.stackSample.count()).toBe(1);

    const summary = await ctx.app.rollup.run();
    expect(summary.stackDays).toBeGreaterThan(0);

    const day = await ctx.app.db.stackDay.findFirstOrThrow();
    expect(day.samples).toBe(1);
    // One sample stands for the five minutes it gated.
    expect(day.connectedMinutes).toBe(5);
    expect(day.seatsMax).toBe(7);
    expect(day.versions).toEqual(['abc1234']);

    const fleet = await ctx.app.db.fleetDay.findFirstOrThrow();
    expect(fleet.customers).toBe(1);
    expect(fleet.customersLive).toBe(1);
    expect(fleet.seatsUsed).toBe(7);
  });

  it('counts revenue from the plan, and the override when there is one', async () => {
    const plans = await ctx.as(owner, { method: 'GET', url: '/api/v1/plans' });
    const planId = plans.json<Envelope<{ id: string }[]>>().data[0]?.id ?? '';
    await ctx.as(owner, {
      method: 'PATCH',
      url: `/api/v1/plans/${planId}`,
      payload: { priceMonthlyMinor: 150000, currency: 'KES' },
    });

    const first = await newCustomer('acme');
    const second = await newCustomer('beta');
    await ctx.as(owner, {
      method: 'PUT',
      url: `/api/v1/customers/${second}/entitlements`,
      payload: { priceMonthlyMinorOverride: 90000 },
    });

    await ctx.app.rollup.run();
    const res = await ctx.as(owner, { method: 'GET', url: '/api/v1/analytics/overview?days=7' });
    expect(res.statusCode, res.body).toBe(200);
    const overview = res.json<Envelope<ConsoleOverviewDto>>().data;

    // 1,500 for the one on the plan plus 900 for the one that negotiated.
    expect(overview.now.mrrMinor).toBe(240000);
    expect(overview.now.arpuMinor).toBe(120000);
    expect(overview.now.currency).toBe('KES');
    expect(overview.planMix.find((p) => p.planId === planId)?.customers).toBe(2);
    expect(first).not.toBe(second);
  });

  it('hands back a dense series even on a console that has seen nothing', async () => {
    const res = await ctx.as(owner, { method: 'GET', url: '/api/v1/analytics/overview?days=14' });
    const overview = res.json<Envelope<ConsoleOverviewDto>>().data;
    expect(overview.hasData).toBe(false);
    expect(overview.series.customers).toHaveLength(14);
    expect(overview.series.customers.every((p) => p.v === 0)).toBe(true);
    // A screen can trust the dates: no gaps, ascending, one per day.
    const days = overview.series.customers.map((p) => p.t);
    expect([...days].sort((a, b) => a.localeCompare(b))).toEqual(days);
  });

  it('reports one customer with its caps, its uptime and its events', async () => {
    const customerId = await newCustomer();
    const { stackId, secret } = await newStack(customerId);
    const stack = await connectStack(stackId, secret);
    stack.emit('heartbeat', heartbeat({ seats: 3 }));
    await expect.poll(() => ctx.app.db.stackSample.count()).toBe(1);
    await ctx.app.rollup.run();

    const res = await ctx.as(owner, {
      method: 'GET',
      url: `/api/v1/analytics/customers/${customerId}?days=7`,
    });
    expect(res.statusCode, res.body).toBe(200);
    const analytics = res.json<Envelope<CustomerAnalyticsDto>>().data;
    expect(analytics.hasData).toBe(true);
    expect(analytics.seats.series).toHaveLength(7);
    expect(analytics.seats.latest).toBe(3);
    // The seeded plan sells ten seats and twenty gigabytes.
    expect(analytics.seats.cap).toBe(10);
    expect(analytics.storage.capBytes).toBe(20 * 1024 ** 3);
    expect(analytics.uptime.days).toHaveLength(7);
    expect(analytics.events.some((e) => e.kind === 'stack')).toBe(true);
    // Seven days of one sample is not enough to promise anybody a date.
    expect(analytics.storage.projection).toBeNull();
  });

  it('refuses analytics to a browser without a session', async () => {
    const res = await ctx.as(null, { method: 'GET', url: '/api/v1/analytics/overview' });
    expect(res.statusCode).toBe(401);
  });
});

describe('what the console does about what it finds', () => {
  it('opens an alert once, leaves it open, and closes it when the fault clears', async () => {
    const customerId = await newCustomer();
    const { stackId } = await newStack(customerId);
    // A stack that reported in yesterday and has said nothing since.
    await ctx.app.db.stack.update({
      where: { id: stackId },
      data: {
        lastSeenAt: new Date(Date.now() - 60 * 60_000),
        connected: false,
        lastBackupAt: new Date(),
      },
    });

    const first = await ctx.app.alerts.sweep();
    expect(first.opened).toBeGreaterThanOrEqual(1);
    const open = await ctx.app.db.consoleAlert.findMany({ where: { resolvedAt: null } });
    expect(open.some((a) => a.kind === 'stack_offline')).toBe(true);

    // A second sweep must not tell anybody twice.
    const second = await ctx.app.alerts.sweep();
    expect(second.opened).toBe(0);
    expect(await ctx.app.db.consoleAlert.count({ where: { kind: 'stack_offline' } })).toBe(1);

    await ctx.app.db.stack.update({
      where: { id: stackId },
      data: { lastSeenAt: new Date(), connected: true },
    });
    const third = await ctx.app.alerts.sweep();
    expect(third.resolved).toBeGreaterThanOrEqual(1);
    const closed = await ctx.app.db.consoleAlert.findFirstOrThrow({
      where: { kind: 'stack_offline' },
    });
    expect(closed.resolvedAt).not.toBeNull();
  });

  it('notices a plan about to run out, and one that already has', async () => {
    const soon = await newCustomer('soon');
    const gone = await newCustomer('gone');
    await ctx.as(owner, {
      method: 'PUT',
      url: `/api/v1/customers/${soon}/entitlements`,
      payload: { expiresAt: new Date(Date.now() + 3 * 86_400_000).toISOString() },
    });
    await ctx.as(owner, {
      method: 'PUT',
      url: `/api/v1/customers/${gone}/entitlements`,
      payload: { expiresAt: new Date(Date.now() - 86_400_000).toISOString() },
    });

    await ctx.app.alerts.sweep();
    const kinds = (await ctx.app.db.consoleAlert.findMany({ where: { resolvedAt: null } })).map(
      (a) => a.kind,
    );
    expect(kinds).toContain('plan_expiring');
    expect(kinds).toContain('plan_expired');

    const res = await ctx.as(owner, { method: 'GET', url: '/api/v1/analytics/overview?days=7' });
    const overview = res.json<Envelope<ConsoleOverviewDto>>().data;
    expect(overview.now.openAlerts).toBeGreaterThanOrEqual(2);
    expect(overview.expiring.map((e) => e.customerId)).toContain(soon);
    // An expired plan earns nothing, whatever the price says.
    expect(overview.alerts.some((a) => a.kind === 'plan_expired')).toBe(true);
  });

  it('says a seat cap is close before it is reached', async () => {
    const customerId = await newCustomer();
    const { stackId } = await newStack(customerId);
    await ctx.app.db.stack.update({
      where: { id: stackId },
      data: {
        connected: true,
        lastSeenAt: new Date(),
        lastBackupAt: new Date(),
        usage: {
          seatsActive: 9,
          storageBytes: 1024,
          attachmentsBytes: 0,
          recordingsBytes: 0,
          backupsBytes: 0,
        },
      },
    });

    await ctx.app.alerts.sweep();
    const alert = await ctx.app.db.consoleAlert.findFirstOrThrow({ where: { kind: 'cap_near' } });
    expect((alert.context as { summary?: string }).summary).toContain('90 percent');
  });
});
