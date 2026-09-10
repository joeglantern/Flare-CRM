/**
 * The stack's half of the owner console link.
 *
 * The console's own suite proves it signs and serves correctly. What matters here is what this
 * stack does with what it is handed: apply it, say so, keep reporting, and refuse anything that
 * does not verify without disturbing what is already in force.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { io as connect, type Socket } from 'socket.io-client';
import { catchUp } from '../../src/integrations/console/catch-up.js';
import { ConsoleLink, type ConsoleLinkDeps } from '../../src/integrations/console/link.js';
import { startFakeConsole, type FakeConsole } from '../setup/fake-console.js';
import {
  consoleEnv,
  createSigner,
  issueId,
  TEST_STACK_ID,
  TEST_STACK_SECRET,
  type TestSigner,
} from '../setup/signing.js';
import { TestContext, type TestUser } from '../setup/test-app.js';

describe('the console link, from the stack side', () => {
  let ctx: TestContext;
  let fake: FakeConsole;
  let signer: TestSigner;
  let admin: TestUser;
  let url: string;
  const links: ConsoleLink[] = [];
  const sockets: Socket[] = [];

  beforeAll(async () => {
    signer = createSigner();
    fake = await startFakeConsole();
    ctx = await TestContext.create({ ...consoleEnv(signer), CONSOLE_URL: fake.url });
    url = await ctx.app.listen({ host: '127.0.0.1', port: 0 });
    admin = await ctx.createUser({ role: 'admin' });
  });

  beforeEach(async () => {
    await ctx.app.valkey.del('console:leader');
    fake.reset();
  });

  afterEach(async () => {
    for (const link of links.splice(0)) await link.stop();
    for (const socket of sockets.splice(0)) socket.disconnect();
  });

  afterAll(async () => {
    await fake.close();
    await ctx.close();
  });

  /** The link as the worker builds it, minus the parts that belong to the worker. */
  function buildLink(onAnnounce: ConsoleLinkDeps['onAnnounce'] = () => undefined): ConsoleLink {
    const link = new ConsoleLink({
      valkey: ctx.app.valkey,
      entitlements: ctx.app.entitlements,
      readiness: ctx.app.readiness,
      storage: ctx.app.storage,
      log: ctx.app.log,
      config: {
        CONSOLE_URL: fake.url,
        CONSOLE_STACK_ID: TEST_STACK_ID,
        CONSOLE_STACK_SECRET: TEST_STACK_SECRET,
        APP_URL: 'https://acme.example.com',
        APP_VERSION: 'abc1234',
      },
      onAnnounce,
    });
    links.push(link);
    link.start();
    return link;
  }

  it('introduces itself with what it is running and what it is running under', async () => {
    buildLink();
    const hello = await fake.waitFor('hello');
    expect(hello.stackId).toBe(TEST_STACK_ID);
    expect(hello.protocol).toBe(1);
    expect(hello.version).toBe('abc1234');
    expect(hello.domain).toBe('acme.example.com');
    // Standalone until told otherwise, so it holds no document yet.
    expect(hello.entitlements.issueId).toBeNull();
  });

  it('reports usage and health without being asked', async () => {
    buildLink();
    const beat = await fake.waitFor('heartbeat');
    expect(beat.version).toBe('abc1234');
    expect(beat.ready.ok).toBe(true);
    expect(Object.keys(beat.ready.checks)).toContain('database');
    // One admin exists, so a seat is in use; nothing is claimed about storage that is not measured.
    expect(beat.usage.seatsActive).toBeGreaterThanOrEqual(1);
    expect(beat.usage.storageBytes).toBeGreaterThanOrEqual(0);

    const status = await ctx.app.entitlements.linkStatus();
    expect(status).toMatchObject({ configured: true, connected: true });
    expect(status.lastHeartbeatAt).not.toBeNull();
  });

  it('applies what the console pushes and acknowledges it', async () => {
    buildLink();
    await fake.waitFor('hello');

    const id = issueId();
    const document = signer.document({
      audience: TEST_STACK_ID,
      features: { exports: false },
      customerName: 'Acme Ltd',
    });
    expect(fake.push(signer.sign(document), id)).toBe(true);

    const ack = await fake.waitFor('ack', (a) => a.issueId === id);
    expect(ack.result).toBe('applied');

    const state = await ctx.app.entitlements.getState();
    expect(state.source).toBe('console');
    expect(state.issueId).toBe(id);
    expect(state.doc.customerName).toBe('Acme Ltd');
    expect(await ctx.app.entitlements.has('exports')).toBe(false);
  });

  it('reaches an open browser as soon as the plan changes', async () => {
    buildLink();
    await fake.waitFor('hello');

    const socket = connect(url, {
      transports: ['websocket'],
      extraHeaders: { cookie: admin.cookie },
      reconnection: false,
    });
    sockets.push(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', () => {
        resolve();
      });
      socket.once('connect_error', reject);
    });

    const changed = new Promise<{ plan: string; features: Record<string, boolean> }>(
      (resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error('no entitlements:changed arrived'));
        }, 8000);
        socket.once(
          'entitlements:changed',
          (payload: { plan: string; features: Record<string, boolean> }) => {
            clearTimeout(timer);
            resolve(payload);
          },
        );
      },
    );

    const id = issueId();
    fake.push(
      signer.sign(
        signer.document({ audience: TEST_STACK_ID, plan: { id: 'plan_big', name: 'Bigger plan' } }),
      ),
      id,
    );
    expect((await changed).plan).toBe('Bigger plan');
  });

  it('refuses a document it cannot verify, and keeps the one in force', async () => {
    buildLink();
    await fake.waitFor('hello');

    // Something real first, so there is a document to protect.
    const good = issueId();
    fake.push(
      signer.sign(signer.document({ audience: TEST_STACK_ID, customerName: 'Acme Ltd' })),
      good,
    );
    await fake.waitFor('ack', (a) => a.issueId === good && a.result === 'applied');

    const envelope = signer.sign(signer.document({ audience: TEST_STACK_ID }));
    const document = JSON.parse(
      Buffer.from(envelope.payload, 'base64url').toString('utf8'),
    ) as Record<string, unknown>;
    document.customerName = 'Somebody Else Ltd';
    const tampered = {
      ...envelope,
      payload: Buffer.from(JSON.stringify(document), 'utf8').toString('base64url'),
    };

    const bad = issueId();
    fake.push(tampered, bad);
    const ack = await fake.waitFor('ack', (a) => a.issueId === bad);
    expect(ack.result).toBe('rejected');
    expect(ack.reason).toContain('signature');

    const state = await ctx.app.entitlements.getState();
    expect(state.doc.customerName).toBe('Acme Ltd');
    expect(state.issueId).toBe(good);
  });

  it('refuses a document addressed to another stack', async () => {
    buildLink();
    await fake.waitFor('hello');
    const id = issueId();
    fake.push(signer.sign(signer.document({ audience: 'stk_zzzzzzzzzzzzzzzzzzzz' })), id);
    const ack = await fake.waitFor('ack', (a) => a.issueId === id);
    expect(ack.result).toBe('rejected');
    expect(ack.reason).toContain('addressed to a different stack');
  });

  it('passes an announcement on to whoever is signed in', async () => {
    const heard: { message: string; level: string }[] = [];
    buildLink((announcement) => heard.push(announcement));
    await fake.waitFor('hello');

    fake.announce({ message: 'Maintenance at 22:00', level: 'warning' });
    await expect.poll(() => heard.length).toBe(1);
    expect(heard[0]).toEqual({ message: 'Maintenance at 22:00', level: 'warning' });
  });

  it('lets only one worker hold the connection', async () => {
    buildLink();
    await fake.waitFor('hello');
    const second = buildLink();
    // The lock is held, so the second replica waits rather than opening a rival connection.
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(second.isLeader).toBe(false);
    expect(second.connected).toBe(false);
    expect(fake.connectedStacks()).toEqual([TEST_STACK_ID]);
  });

  it('catches up over HTTP before any socket is open', async () => {
    const id = issueId();
    fake.setWaiting({
      issueId: id,
      envelope: signer.sign(
        signer.document({ audience: TEST_STACK_ID, customerName: 'Caught Up Ltd' }),
      ),
    });

    const outcome = await catchUp({
      entitlements: ctx.app.entitlements,
      log: ctx.app.log,
      config: {
        CONSOLE_URL: fake.url,
        CONSOLE_STACK_ID: TEST_STACK_ID,
        CONSOLE_STACK_SECRET: TEST_STACK_SECRET,
      },
    });
    expect(outcome).toEqual({ result: 'applied', issueId: id });

    const state = await ctx.app.entitlements.getState();
    expect(state.doc.customerName).toBe('Caught Up Ltd');
    expect(fake.acks.some((a) => a.issueId === id && a.result === 'applied')).toBe(true);
    expect(
      fake.restCalls.some(
        (c) =>
          c.path === '/api/link/entitlements' &&
          c.authorization === `Bearer ${TEST_STACK_ID}.${TEST_STACK_SECRET}`,
      ),
    ).toBe(true);
  });

  it('says nothing is waiting rather than inventing something', async () => {
    fake.setWaiting(null);
    const outcome = await catchUp({
      entitlements: ctx.app.entitlements,
      log: ctx.app.log,
      config: {
        CONSOLE_URL: fake.url,
        CONSOLE_STACK_ID: TEST_STACK_ID,
        CONSOLE_STACK_SECRET: TEST_STACK_SECRET,
      },
    });
    expect(outcome).toEqual({ result: 'nothing-waiting' });
  });

  it('carries on when the console cannot be reached at all', async () => {
    const before = await ctx.app.entitlements.getState();
    const outcome = await catchUp({
      entitlements: ctx.app.entitlements,
      log: ctx.app.log,
      // Nothing listens here.
      config: {
        CONSOLE_URL: 'http://127.0.0.1:1',
        CONSOLE_STACK_ID: TEST_STACK_ID,
        CONSOLE_STACK_SECRET: TEST_STACK_SECRET,
      },
    });
    expect(outcome.result).toBe('unreachable');
    const after = await ctx.app.entitlements.getState();
    expect(after.issueId).toBe(before.issueId);
    expect(after.doc.customerName).toBe(before.doc.customerName);
  });

  it('is turned away when its secret is wrong', async () => {
    const outcome = await catchUp({
      entitlements: ctx.app.entitlements,
      log: ctx.app.log,
      config: {
        CONSOLE_URL: fake.url,
        CONSOLE_STACK_ID: TEST_STACK_ID,
        CONSOLE_STACK_SECRET: 'not-the-secret',
      },
    });
    expect(outcome).toEqual({ result: 'unreachable', reason: 'console answered 401' });
  });
});
