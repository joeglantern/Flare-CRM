/**
 * An admin entering and changing the owner console link in the CRM (docs/21 section 4).
 *
 * What matters is that the secret and the console's address never come back out, that nothing is
 * saved until the console itself accepts the details, and that pointing a linked stack at a
 * different console takes an explicit confirmation and, for a new key, proof of that key.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readConsoleConfig } from '../../src/modules/console-link/config.js';
import { startFakeConsole, type FakeConsole } from '../setup/fake-console.js';
import {
  consoleEnv,
  createSigner,
  TEST_STACK_ID,
  TEST_STACK_SECRET,
  type TestSigner,
} from '../setup/signing.js';
import { TestContext, type TestUser } from '../setup/test-app.js';

interface Envelope<T> {
  data: T;
}
interface Status {
  managedBy: 'server' | 'admin' | null;
  stackId: string | null;
  secretSet: boolean;
  publicKeys: string[];
  trustedKeyIds: string[];
  locked: boolean;
  serverLinkAvailable: boolean;
  keyVerified?: boolean;
}

// Each request from its own address: the routes allow five a minute, keyed before sign-in.
let lane = 0;
const fromOwnAddress = () => ({
  'x-forwarded-for': `10.88.${String(++lane >> 8)}.${String(lane & 255)}`,
});

describe('owner console link entered by an admin', () => {
  let fake: FakeConsole;
  let signer: TestSigner;
  let ctx: TestContext;
  let admin: TestUser;

  const save = (by: TestUser, overrides: Record<string, string | boolean | undefined> = {}) =>
    ctx.as(by, {
      method: 'PUT',
      url: '/api/v1/console-link',
      headers: fromOwnAddress(),
      payload: {
        consoleUrl: fake.url,
        stackId: TEST_STACK_ID,
        stackSecret: TEST_STACK_SECRET,
        publicKey: signer.publicKeyBase64,
        ...overrides,
      },
    });
  const waitingPlan = (by: TestSigner) => ({
    issueId: `iss_${crypto.randomUUID()}`,
    envelope: by.sign(by.document({ audience: TEST_STACK_ID })),
  });

  beforeAll(async () => {
    fake = await startFakeConsole();
    signer = createSigner();
    // Standalone: nothing about the console in the environment.
    ctx = await TestContext.create();
  });
  beforeEach(async () => {
    await ctx.reset();
    fake.reset();
    admin = await ctx.createUser({ role: 'admin' });
    await ctx.app.entitlements.refreshConsoleConfig();
  });
  afterAll(async () => {
    await ctx.close();
    await fake.close();
  });

  it('checks the details with the console, stores the secret encrypted, returns neither secret nor address', async () => {
    const res = await save(admin);

    expect(res.statusCode, res.body).toBe(200);
    expect(res.body).not.toContain(TEST_STACK_SECRET);
    expect(res.body).not.toContain(fake.url);
    expect(res.json<Envelope<Status>>().data).toMatchObject({
      managedBy: 'admin',
      stackId: TEST_STACK_ID,
      secretSet: true,
      trustedKeyIds: [signer.keyId],
      locked: false,
      serverLinkAvailable: false,
      // Nothing was waiting at the console, so the key could not be proven yet.
      keyVerified: false,
    });
    expect(fake.restCalls.some((c) => c.path === '/api/link/entitlements')).toBe(true);

    const row = await ctx.app.db.consoleLinkConfig.findUniqueOrThrow({ where: { id: 1 } });
    expect(Buffer.from(row.secretEncrypted).toString('utf8')).not.toContain(TEST_STACK_SECRET);

    const audit = await ctx.app.db.auditLog.findFirstOrThrow({
      where: { action: 'console.link_configured' },
    });
    expect(JSON.stringify(audit)).not.toContain(TEST_STACK_SECRET);
    expect(JSON.stringify(audit)).not.toContain(fake.url);

    const again = await ctx.as(admin, { method: 'GET', url: '/api/v1/console-link' });
    expect(again.body).not.toContain(TEST_STACK_SECRET);
    expect(again.body).not.toContain(fake.url);
  });

  it('says the key was proven when the console has a plan signed with it', async () => {
    fake.setWaiting(waitingPlan(signer));

    const res = await save(admin);

    expect(res.statusCode, res.body).toBe(200);
    expect(res.json<Envelope<Status>>().data.keyVerified).toBe(true);
  });

  it('trusts the key it was given, in the api, without a restart', async () => {
    await save(admin);
    await ctx.app.entitlements.refreshConsoleConfig();

    const outcome = await ctx.app.entitlements.apply(
      signer.sign(signer.document({ audience: TEST_STACK_ID, features: { deals: false } })),
      { issueId: 'iss_admin', source: 'console', ctx: { actorId: null, actorType: 'system' } },
    );
    expect(outcome.result).toBe('applied');
  });

  it('needs the address and the secret on a first link', async () => {
    const res = await save(admin, { consoleUrl: '', stackSecret: undefined });

    expect(res.statusCode).toBe(422);
    expect(res.body).toMatch(/Enter the console address/);
    expect(res.body).toMatch(/Enter the stack secret/);
    expect(fake.restCalls).toHaveLength(0);
  });

  it('saves nothing when the console refuses the secret', async () => {
    const res = await save(admin, { stackSecret: 'x'.repeat(43) });

    expect(res.statusCode).toBe(422);
    expect(res.body).toMatch(/did not accept this stack id and secret/);
    expect(await ctx.app.db.consoleLinkConfig.count()).toBe(0);
  });

  it('saves nothing when the console signs with a different key', async () => {
    const other = createSigner();
    fake.setWaiting(waitingPlan(signer));

    const res = await save(admin, { publicKey: other.publicKeyBase64 });

    expect(res.statusCode).toBe(422);
    expect(res.body).toMatch(/signs its plans with a different key/);
    expect(await ctx.app.db.consoleLinkConfig.count()).toBe(0);
  });

  it('refuses an address that is not a web address', async () => {
    const res = await save(admin, { consoleUrl: 'file:///etc/passwd' });

    expect(res.statusCode).toBe(422);
    expect(fake.restCalls).toHaveLength(0);
  });

  it('keeps the address and the secret in use when both are left blank', async () => {
    expect((await save(admin)).statusCode).toBe(200);
    fake.reset();

    const res = await save(admin, { consoleUrl: '', stackSecret: '' });

    expect(res.statusCode, res.body).toBe(200);
    // Checked again with the console, using the secret it already held.
    expect(fake.restCalls.at(-1)?.authorization).toBe(
      `Bearer ${TEST_STACK_ID}.${TEST_STACK_SECRET}`,
    );
    const effective = await readConsoleConfig(ctx.app.db, ctx.app.config);
    expect(effective.credentials).toEqual({
      CONSOLE_URL: fake.url,
      CONSOLE_STACK_ID: TEST_STACK_ID,
      CONSOLE_STACK_SECRET: TEST_STACK_SECRET,
    });
  });

  it('lets an admin replace the secret after a rotation, without a confirmation', async () => {
    expect((await save(admin)).statusCode).toBe(200);
    const before = await ctx.app.db.consoleLinkConfig.findUniqueOrThrow({ where: { id: 1 } });

    const res = await save(admin, { consoleUrl: '' });

    expect(res.statusCode, res.body).toBe(200);
    const after = await ctx.app.db.consoleLinkConfig.findUniqueOrThrow({ where: { id: 1 } });
    // Encrypted afresh with a new IV, so the stored bytes differ even for the same secret.
    expect(Buffer.from(after.secretEncrypted).equals(Buffer.from(before.secretEncrypted))).toBe(
      false,
    );
  });

  it('will not move to another address until the change is confirmed', async () => {
    expect((await save(admin)).statusCode).toBe(200);
    const second = await startFakeConsole();
    try {
      const unconfirmed = await save(admin, { consoleUrl: second.url });
      expect(unconfirmed.statusCode).toBe(422);
      expect(unconfirmed.body).toMatch(/confirmChange/);
      expect(second.restCalls).toHaveLength(0);
      const kept = await ctx.app.db.consoleLinkConfig.findUniqueOrThrow({ where: { id: 1 } });
      expect(kept.consoleUrl).toBe(fake.url);

      const confirmed = await save(admin, { consoleUrl: second.url, confirmChange: true });
      expect(confirmed.statusCode, confirmed.body).toBe(200);
      const moved = await ctx.app.db.consoleLinkConfig.findUniqueOrThrow({ where: { id: 1 } });
      expect(moved.consoleUrl).toBe(second.url);

      const audit = await ctx.app.db.auditLog.findFirstOrThrow({
        where: { action: 'console.link_configured' },
        orderBy: { createdAt: 'desc' },
      });
      expect(JSON.stringify(audit)).toContain('"addressChanged":true');
      expect(JSON.stringify(audit)).not.toContain(second.url);
    } finally {
      await second.close();
    }
  });

  it('will not swap the trusted key without a confirmation, nor without proof of the new key', async () => {
    expect((await save(admin)).statusCode).toBe(200);
    const other = createSigner();
    const keys = async () =>
      (await ctx.app.db.consoleLinkConfig.findUniqueOrThrow({ where: { id: 1 } })).publicKeys;

    const unconfirmed = await save(admin, { publicKey: other.publicKeyBase64 });
    expect(unconfirmed.statusCode).toBe(422);
    expect(unconfirmed.body).toMatch(/confirmChange/);
    expect(await keys()).toEqual([signer.publicKeyBase64]);

    // Confirmed, but the console has nothing signed with the new key to prove it.
    const unproven = await save(admin, { publicKey: other.publicKeyBase64, confirmChange: true });
    expect(unproven.statusCode).toBe(422);
    expect(unproven.body).toMatch(/no plan waiting to prove this key/);
    expect(await keys()).toEqual([signer.publicKeyBase64]);

    fake.setWaiting(waitingPlan(other));
    const proven = await save(admin, { publicKey: other.publicKeyBase64, confirmChange: true });
    expect(proven.statusCode, proven.body).toBe(200);
    expect(proven.json<Envelope<Status>>().data).toMatchObject({
      trustedKeyIds: [other.keyId],
      keyVerified: true,
    });
    expect(await keys()).toEqual([other.publicKeyBase64]);
  });

  it('has no server link to go back to on a standalone stack', async () => {
    expect((await save(admin)).statusCode).toBe(200);

    const res = await ctx.as(admin, {
      method: 'DELETE',
      url: '/api/v1/console-link',
      headers: fromOwnAddress(),
    });

    expect(res.statusCode).toBe(409);
    expect(await ctx.app.db.consoleLinkConfig.count()).toBe(1);
  });

  it('is for admins only', async () => {
    const manager = await ctx.createUser({ role: 'manager' });
    const agent = await ctx.createUser({ role: 'agent' });

    expect((await save(manager)).statusCode).toBe(403);
    expect((await save(agent)).statusCode).toBe(403);
    expect((await ctx.as(agent, { method: 'GET', url: '/api/v1/console-link' })).statusCode).toBe(
      403,
    );
    expect(
      (
        await ctx.as(manager, {
          method: 'DELETE',
          url: '/api/v1/console-link',
          headers: fromOwnAddress(),
        })
      ).statusCode,
    ).toBe(403);
  });

  it('refuses a malformed stack id before calling anything', async () => {
    const res = await save(admin, { stackId: 'not-a-stack' });

    expect(res.statusCode).toBe(422);
    expect(fake.restCalls).toHaveLength(0);
  });
});

describe('owner console link set on the server', () => {
  let fake: FakeConsole;
  let signer: TestSigner;

  beforeAll(async () => {
    fake = await startFakeConsole();
    signer = createSigner();
  });
  beforeEach(() => {
    fake.reset();
  });
  afterAll(async () => {
    await fake.close();
  });

  it('can be edited in the CRM without retyping the address or the secret, and put back', async () => {
    const ctx = await TestContext.create({ ...consoleEnv(signer), CONSOLE_URL: fake.url });
    try {
      const admin = await ctx.createUser({ role: 'admin' });

      const status = await ctx.as(admin, { method: 'GET', url: '/api/v1/console-link' });
      expect(status.json<Envelope<Status>>().data).toMatchObject({
        managedBy: 'server',
        locked: false,
        serverLinkAvailable: true,
        publicKeys: [signer.publicKeyBase64],
      });
      expect(status.body).not.toContain(TEST_STACK_SECRET);
      expect(status.body).not.toContain(fake.url);

      const saved = await ctx.as(admin, {
        method: 'PUT',
        url: '/api/v1/console-link',
        headers: fromOwnAddress(),
        payload: { stackId: TEST_STACK_ID, publicKey: signer.publicKeyBase64 },
      });
      expect(saved.statusCode, saved.body).toBe(200);
      expect(saved.json<Envelope<Status>>().data.managedBy).toBe('admin');
      expect(saved.body).not.toContain(fake.url);
      const row = await ctx.app.db.consoleLinkConfig.findUniqueOrThrow({ where: { id: 1 } });
      expect(row.consoleUrl).toBe(fake.url);

      const back = await ctx.as(admin, {
        method: 'DELETE',
        url: '/api/v1/console-link',
        headers: fromOwnAddress(),
      });
      expect(back.statusCode, back.body).toBe(200);
      expect(back.json<Envelope<Status>>().data.managedBy).toBe('server');
      expect(await ctx.app.db.consoleLinkConfig.count()).toBe(0);
    } finally {
      await ctx.close();
    }
  });

  it('asks for a confirmation before leaving the console the server names', async () => {
    const ctx = await TestContext.create({ ...consoleEnv(signer), CONSOLE_URL: fake.url });
    const second = await startFakeConsole();
    try {
      const admin = await ctx.createUser({ role: 'admin' });
      const payload = {
        consoleUrl: second.url,
        stackId: TEST_STACK_ID,
        publicKey: signer.publicKeyBase64,
      };

      const unconfirmed = await ctx.as(admin, {
        method: 'PUT',
        url: '/api/v1/console-link',
        headers: fromOwnAddress(),
        payload,
      });
      expect(unconfirmed.statusCode).toBe(422);
      expect(await ctx.app.db.consoleLinkConfig.count()).toBe(0);

      const confirmed = await ctx.as(admin, {
        method: 'PUT',
        url: '/api/v1/console-link',
        headers: fromOwnAddress(),
        payload: { ...payload, confirmChange: true },
      });
      expect(confirmed.statusCode, confirmed.body).toBe(200);
      const effective = await readConsoleConfig(ctx.app.db, ctx.app.config);
      expect(effective.managedBy).toBe('admin');
      expect(effective.credentials?.CONSOLE_URL).toBe(second.url);
    } finally {
      await second.close();
      await ctx.close();
    }
  });

  it('is read-only when the server locks it, and a saved link is ignored', async () => {
    const ctx = await TestContext.create({ ...consoleEnv(signer), CONSOLE_LINK_LOCKED: 'true' });
    try {
      const admin = await ctx.createUser({ role: 'admin' });
      await ctx.app.db.consoleLinkConfig.create({
        data: {
          id: 1,
          consoleUrl: fake.url,
          stackId: 'stk_zzzzzzzzzzzzzzzzzzzz',
          secretEncrypted: Buffer.from('ignored'),
          publicKeys: [],
        },
      });

      const status = await ctx.as(admin, { method: 'GET', url: '/api/v1/console-link' });
      expect(status.json<Envelope<Status>>().data).toMatchObject({
        managedBy: 'server',
        stackId: TEST_STACK_ID,
        locked: true,
      });

      const res = await ctx.as(admin, {
        method: 'PUT',
        url: '/api/v1/console-link',
        headers: fromOwnAddress(),
        payload: {
          consoleUrl: fake.url,
          stackId: TEST_STACK_ID,
          stackSecret: TEST_STACK_SECRET,
          publicKey: signer.publicKeyBase64,
          confirmChange: true,
        },
      });
      expect(res.statusCode).toBe(409);
      expect(fake.restCalls).toHaveLength(0);
    } finally {
      await ctx.close();
    }
  });
});
