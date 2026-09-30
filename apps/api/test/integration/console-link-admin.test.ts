/**
 * An admin entering the owner console link in the CRM (docs/21 section 4).
 *
 * What matters is that the secret never comes back out and is stored encrypted, that nothing is
 * saved until the console itself accepts the credentials, and that the GUI can never swap the key
 * that makes the plan tamper-proof.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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
  consoleUrl: string | null;
  stackId: string | null;
  secretSet: boolean;
  trustedKeyIds: string[];
}

describe('owner console link entered by an admin', () => {
  let fake: FakeConsole;
  let signer: TestSigner;
  let ctx: TestContext;
  let admin: TestUser;

  // Each request from its own address: the route allows five a minute, keyed before sign-in.
  let lane = 0;
  const enroll = (by: TestUser, overrides: Record<string, string> = {}) =>
    ctx.as(by, {
      method: 'PUT',
      url: '/api/v1/console-link',
      headers: { 'x-forwarded-for': `10.88.0.${String(++lane)}` },
      payload: {
        consoleUrl: fake.url,
        stackId: TEST_STACK_ID,
        stackSecret: TEST_STACK_SECRET,
        publicKey: signer.publicKeyBase64,
        ...overrides,
      },
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
    fake.setWaiting(null);
    admin = await ctx.createUser({ role: 'admin' });
    await ctx.app.entitlements.refreshConsoleConfig();
  });
  afterAll(async () => {
    await ctx.close();
    await fake.close();
  });

  it('checks the credentials with the console, stores the secret encrypted, never returns it', async () => {
    const res = await enroll(admin);

    expect(res.statusCode, res.body).toBe(200);
    expect(res.body).not.toContain(TEST_STACK_SECRET);
    expect(res.json<Envelope<Status>>().data).toMatchObject({
      managedBy: 'admin',
      consoleUrl: fake.url,
      stackId: TEST_STACK_ID,
      secretSet: true,
      trustedKeyIds: [signer.keyId],
    });
    expect(fake.restCalls.some((c) => c.path === '/api/link/entitlements')).toBe(true);

    const row = await ctx.app.db.consoleLinkConfig.findUniqueOrThrow({ where: { id: 1 } });
    expect(Buffer.from(row.secretEncrypted).toString('utf8')).not.toContain(TEST_STACK_SECRET);

    const audit = await ctx.app.db.auditLog.findFirstOrThrow({
      where: { action: 'console.link_configured' },
    });
    expect(JSON.stringify(audit)).not.toContain(TEST_STACK_SECRET);

    const again = await ctx.as(admin, { method: 'GET', url: '/api/v1/console-link' });
    expect(again.body).not.toContain(TEST_STACK_SECRET);
  });

  it('trusts the key it was given, in the api, without a restart', async () => {
    await enroll(admin);
    await ctx.app.entitlements.refreshConsoleConfig();

    const outcome = await ctx.app.entitlements.apply(
      signer.sign(signer.document({ audience: TEST_STACK_ID, features: { deals: false } })),
      { issueId: 'iss_admin', source: 'console', ctx: { actorId: null, actorType: 'system' } },
    );
    expect(outcome.result).toBe('applied');
  });

  it('saves nothing when the console refuses the secret', async () => {
    const res = await enroll(admin, { stackSecret: 'x'.repeat(43) });

    expect(res.statusCode).toBe(422);
    expect(res.body).toMatch(/did not accept this stack id and secret/);
    expect(await ctx.app.db.consoleLinkConfig.count()).toBe(0);
  });

  it('saves nothing when the console signs with a different key', async () => {
    const other = createSigner();
    fake.setWaiting({
      issueId: `iss_${crypto.randomUUID()}`,
      envelope: signer.sign(signer.document({ audience: TEST_STACK_ID })),
    });

    const res = await enroll(admin, { publicKey: other.publicKeyBase64 });

    expect(res.statusCode).toBe(422);
    expect(res.body).toMatch(/signs its plans with a different key/);
    expect(await ctx.app.db.consoleLinkConfig.count()).toBe(0);
  });

  it('never lets the GUI swap a trusted key for another', async () => {
    expect((await enroll(admin)).statusCode).toBe(200);
    const other = createSigner();

    const res = await enroll(admin, { publicKey: other.publicKeyBase64 });

    expect(res.statusCode).toBe(409);
    const row = await ctx.app.db.consoleLinkConfig.findUniqueOrThrow({ where: { id: 1 } });
    expect(row.publicKeys).toEqual([signer.publicKeyBase64]);
  });

  it('lets an admin replace the secret after a rotation, with the same key', async () => {
    expect((await enroll(admin)).statusCode).toBe(200);
    const before = await ctx.app.db.consoleLinkConfig.findUniqueOrThrow({ where: { id: 1 } });

    const res = await enroll(admin);

    expect(res.statusCode, res.body).toBe(200);
    const after = await ctx.app.db.consoleLinkConfig.findUniqueOrThrow({ where: { id: 1 } });
    // Encrypted afresh with a new IV, so the stored bytes differ even for the same secret.
    expect(Buffer.from(after.secretEncrypted).equals(Buffer.from(before.secretEncrypted))).toBe(
      false,
    );
  });

  it('is for admins only', async () => {
    const manager = await ctx.createUser({ role: 'manager' });
    const agent = await ctx.createUser({ role: 'agent' });

    expect((await enroll(manager)).statusCode).toBe(403);
    expect((await enroll(agent)).statusCode).toBe(403);
    expect((await ctx.as(agent, { method: 'GET', url: '/api/v1/console-link' })).statusCode).toBe(
      403,
    );
  });

  it('refuses a malformed stack id before calling anything', async () => {
    const res = await enroll(admin, { stackId: 'not-a-stack' });

    expect(res.statusCode).toBe(422);
    expect(fake.restCalls).toHaveLength(0);
  });
});

describe('owner console link set on the server', () => {
  it('is read-only in the CRM', async () => {
    const signer = createSigner();
    const ctx = await TestContext.create(consoleEnv(signer));
    try {
      const admin = await ctx.createUser({ role: 'admin' });

      const status = await ctx.as(admin, { method: 'GET', url: '/api/v1/console-link' });
      expect(status.json<Envelope<Status>>().data.managedBy).toBe('server');
      expect(status.body).not.toContain(TEST_STACK_SECRET);

      const res = await ctx.as(admin, {
        method: 'PUT',
        url: '/api/v1/console-link',
        payload: {
          consoleUrl: 'https://console.example.com',
          stackId: TEST_STACK_ID,
          stackSecret: TEST_STACK_SECRET,
          publicKey: signer.publicKeyBase64,
        },
      });
      expect(res.statusCode).toBe(409);
    } finally {
      await ctx.close();
    }
  });
});
