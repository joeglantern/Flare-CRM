/**
 * The stack's half of the owner console link.
 *
 * The console's own suite proves it signs and serves correctly. What matters here is what this
 * stack does with what it is handed: apply it, say so, keep reporting, and refuse anything that
 * does not verify without disturbing what is already in force.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { io as connect, type Socket } from 'socket.io-client';
import type { SupportCommand } from '@crm/shared';
import { newId } from '../../src/lib/ids.js';
import { catchUp } from '../../src/integrations/console/catch-up.js';
import { ConsoleLink, type ConsoleLinkDeps } from '../../src/integrations/console/link.js';
import type { SupportDeps } from '../../src/integrations/console/support.js';
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

  /** The support deps the worker hands the link, so the provider may unstick a person here. */
  function supportDeps(): SupportDeps {
    return { db: ctx.app.db, valkey: ctx.app.valkey, audit: ctx.app.audit, log: ctx.app.log };
  }

  /** The link as the worker builds it, minus the parts that belong to the worker. */
  function buildLink(
    onAnnounce: ConsoleLinkDeps['onAnnounce'] = () => undefined,
    support?: SupportDeps,
  ): ConsoleLink {
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
      ...(support === undefined ? {} : { support }),
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

  describe('what the provider may do here, at a customer’s request', () => {
    /** Somebody with a second factor set up, which is the thing support has to be able to clear. */
    async function enrolled(): Promise<{ id: string; email: string }> {
      const user = await ctx.createUser({ role: 'agent', twoFactorEnabled: true });
      await ctx.app.db.twoFactor.create({
        data: {
          id: newId(),
          userId: user.id,
          secret: 'JBSWY3DPEHPK3PXP',
          backupCodes: 'none',
          verified: true,
        },
      });
      return user;
    }

    it('clears one person’s second factor and writes it in this customer’s own audit log', async () => {
      const user = await enrolled();
      buildLink(() => undefined, supportDeps());
      await fake.waitFor('hello');

      const commandId = `cmd_${newId()}`;
      expect(
        fake.command({
          commandId,
          action: 'reset-two-factor',
          email: user.email,
          requestedBy: 'owner@flare.test',
          reason: 'Lost her phone, confirmed by voice',
        }),
      ).toBe(true);

      const result = await fake.waitFor('commandResult', (r) => r.commandId === commandId);
      expect(result.ok).toBe(true);
      expect(await ctx.app.db.twoFactor.count({ where: { userId: user.id } })).toBe(0);
      expect(
        (await ctx.app.db.user.findUniqueOrThrow({ where: { id: user.id } })).twoFactorEnabled,
      ).toBe(false);
      // Sessions go with it: they signed in during createUser, so there is one to lose.
      expect(await ctx.app.db.session.count({ where: { userId: user.id } })).toBe(0);

      // The customer's administrator can see who did it and why, without asking us.
      const row = await ctx.app.db.auditLog.findFirstOrThrow({
        where: { action: 'support.two_factor_reset', entityId: user.id },
      });
      expect(row.actorType).toBe('system');
      expect(row.actorId).toBeNull();
      expect(JSON.stringify(row.after)).toContain('owner@flare.test');
      expect(JSON.stringify(row.after)).toContain('Lost her phone');
    });

    it('says so plainly when the email belongs to nobody here', async () => {
      buildLink(() => undefined, supportDeps());
      await fake.waitFor('hello');

      const commandId = `cmd_${newId()}`;
      fake.command({
        commandId,
        action: 'reset-two-factor',
        email: 'stranger@example.com',
        requestedBy: 'owner@flare.test',
      });
      const result = await fake.waitFor('commandResult', (r) => r.commandId === commandId);
      expect(result.ok).toBe(false);
      expect(result.message).toContain('Nobody here');
    });

    it('lists who can sign in, and nothing else about them', async () => {
      const user = await enrolled();
      buildLink(() => undefined, supportDeps());
      await fake.waitFor('hello');

      const commandId = `cmd_${newId()}`;
      fake.command({ commandId, action: 'list-users', requestedBy: 'owner@flare.test' });
      const result = await fake.waitFor('commandResult', (r) => r.commandId === commandId);
      expect(result.ok).toBe(true);
      const listed = result.users?.find((u) => u.email === user.email);
      expect(listed?.twoFactorEnabled).toBe(true);
      // A support listing carries no phone number, no extension, no team, no last login address.
      expect(Object.keys(listed ?? {}).sort()).toEqual([
        'email',
        'id',
        'isActive',
        'lastSeenAt',
        'name',
        'role',
        'twoFactorEnabled',
      ]);
      expect(await ctx.app.db.auditLog.count({ where: { action: 'support.users_listed' } })).toBe(
        1,
      );
    });

    it('refuses an action that is not one of the three', async () => {
      buildLink(() => undefined, supportDeps());
      await fake.waitFor('hello');
      const before = await ctx.app.db.auditLog.count();

      // Malformed on purpose: the console could only send this if it were compromised.
      fake.command({
        commandId: `cmd_${newId()}`,
        action: 'export-contacts',
        requestedBy: 'owner@flare.test',
      } as unknown as SupportCommand);

      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(fake.commandResults).toHaveLength(0);
      expect(await ctx.app.db.auditLog.count()).toBe(before);
    });

    it('refuses every command when it was never given the support door', async () => {
      const user = await enrolled();
      buildLink();
      await fake.waitFor('hello');

      const commandId = `cmd_${newId()}`;
      fake.command({
        commandId,
        action: 'reset-two-factor',
        email: user.email,
        requestedBy: 'owner@flare.test',
      });
      const result = await fake.waitFor('commandResult', (r) => r.commandId === commandId);
      expect(result.ok).toBe(false);
      expect(await ctx.app.db.twoFactor.count({ where: { userId: user.id } })).toBe(1);
    });
  });
});
