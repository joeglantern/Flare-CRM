import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SYSTEM_AUDIT } from '../../src/modules/entitlements/entitlements.service.js';
import {
  consoleEnv,
  createSigner,
  issueId,
  TEST_STACK_ID,
  type TestSigner,
} from '../setup/signing.js';
import { TestContext, type TestUser } from '../setup/test-app.js';

interface Envelope<T> {
  data: T;
}
interface ErrorBody {
  error: { code: string; message: string; details?: Record<string, unknown> };
}

// 1x1 transparent PNG; the sniffer only needs the signature bytes.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);
function multipart(field: string, fileName: string, mimeType: string, body: Buffer) {
  const boundary = `----crm-test-${String(Date.now())}`;
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="${field}"; filename="${fileName}"\r\nContent-Type: ${mimeType}\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return {
    payload: Buffer.concat([head, body, tail]),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
}

describe('entitlements: the plan is enforced next to permissions', () => {
  let ctx: TestContext;
  let signer: TestSigner;
  let admin: TestUser;

  beforeAll(async () => {
    signer = createSigner();
    ctx = await TestContext.create(consoleEnv(signer));
  });
  beforeEach(async () => {
    await ctx.reset();
    await ctx.app.valkey.del('entitlements:usage:storage');
    admin = await ctx.createUser({ role: 'admin' });
  });
  afterAll(async () => {
    await ctx.close();
  });

  async function apply(doc: ReturnType<TestSigner['document']>, id = issueId()) {
    const out = await ctx.app.entitlements.apply(signer.sign(doc), {
      issueId: id,
      source: 'console',
      ctx: SYSTEM_AUDIT,
    });
    return { id, out };
  }

  it('reports standalone defaults when nothing has been applied, and every route works', async () => {
    const res = await ctx.as(admin, { method: 'GET', url: '/api/v1/entitlements' });
    expect(res.statusCode, res.body).toBe(200);
    const dto = res.json<
      Envelope<{
        source: string;
        features: Record<string, boolean>;
        limits: Record<string, number | null>;
        usage: { seats: { used: number; max: number | null } };
        link: { configured: boolean; connected: boolean };
      }>
    >().data;
    expect(dto.source).toBe('default');
    expect(Object.values(dto.features).every(Boolean)).toBe(true);
    expect(Object.values(dto.limits).every((v) => v === null)).toBe(true);
    expect(dto.usage.seats).toEqual({ used: 1, max: null });
    expect(dto.link).toEqual({ configured: true, connected: false, lastHeartbeatAt: null });
    for (const url of ['/api/v1/calls', '/api/v1/leads', '/api/v1/deals', '/api/v1/backups']) {
      const r = await ctx.as(admin, { method: 'GET', url });
      expect(r.statusCode, `${url}: ${r.body}`).toBe(200);
    }
  });

  it('refuses a feature that is off with FEATURE_NOT_IN_PLAN, audits it, and leaves the rest alone', async () => {
    const changed: unknown[] = [];
    ctx.app.events.on('entitlements.changed', (e) => {
      changed.push(e);
    });
    const { out } = await apply(signer.document({ features: { telephony: false } }));
    expect(out.result).toBe('applied');
    expect(changed).toHaveLength(1);

    const calls = await ctx.as(admin, { method: 'GET', url: '/api/v1/calls' });
    expect(calls.statusCode).toBe(403);
    const body = calls.json<ErrorBody>();
    expect(body.error.code).toBe('FEATURE_NOT_IN_PLAN');
    expect(body.error.details?.feature).toBe('telephony');
    const denied = await ctx.app.db.auditLog.findFirst({
      where: { action: 'access.denied', requestId: calls.headers['x-request-id'] as string },
    });
    expect(denied).not.toBeNull();
    expect((denied?.after as { reason: string }).reason).toBe('FEATURE_NOT_IN_PLAN');

    // recordings and softphone require telephony, so they went with it
    const dto = await ctx.as(admin, { method: 'GET', url: '/api/v1/entitlements' });
    const features = dto.json<Envelope<{ features: Record<string, boolean> }>>().data.features;
    expect(features.recordings).toBe(false);
    expect(features.softphone).toBe(false);
    expect(features.messaging).toBe(true);

    expect((await ctx.as(admin, { method: 'GET', url: '/api/v1/contacts' })).statusCode).toBe(200);
    expect((await ctx.as(admin, { method: 'GET', url: '/api/v1/leads' })).statusCode).toBe(200);
    // the audit trail itself is core, but change details are a feature
    await apply(signer.document({ features: { audit_diff: false } }));
    const audit = await ctx.as(admin, { method: 'GET', url: '/api/v1/audit' });
    const rows =
      audit.json<Envelope<{ before: unknown; after: unknown; diffAvailable: boolean }[]>>().data;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.before === null && r.after === null && !r.diffAvailable)).toBe(true);
  });

  it('turns read-only once expired: reads and own-account routes work, writes are refused', async () => {
    await apply(signer.document({ expiresAt: '2020-01-01T00:00:00.000Z' }));
    expect((await ctx.as(admin, { method: 'GET', url: '/api/v1/contacts' })).statusCode).toBe(200);
    const create = await ctx.as(admin, {
      method: 'POST',
      url: '/api/v1/contacts',
      payload: { firstName: 'Blocked' },
    });
    expect(create.statusCode).toBe(403);
    expect(create.json<ErrorBody>().error.code).toBe('PLAN_EXPIRED');
    const me = await ctx.as(admin, {
      method: 'PATCH',
      url: '/api/v1/users/me',
      payload: { name: 'Still me' },
    });
    expect(me.statusCode, me.body).toBe(200);
    expect(await ctx.signIn(admin.email, admin.password)).toContain('session_token');
    const dto = await ctx.as(admin, { method: 'GET', url: '/api/v1/entitlements' });
    expect(dto.json<Envelope<{ expired: boolean }>>().data.expired).toBe(true);
  });

  it('hard-caps seats on create and on reactivate', async () => {
    const agent = await ctx.createUser({ role: 'agent' });
    const off = await ctx.as(admin, {
      method: 'POST',
      url: `/api/v1/users/${agent.id}/deactivate`,
    });
    expect(off.statusCode, off.body).toBe(200);
    expect(await ctx.app.db.user.count({ where: { isActive: true } })).toBe(1);
    await apply(signer.document({ limits: { seats: 1 } }));

    const created = await ctx.as(admin, {
      method: 'POST',
      url: '/api/v1/users',
      payload: { name: 'One too many', email: 'extra@example.com' },
    });
    expect(created.statusCode).toBe(409);
    const body = created.json<ErrorBody>();
    expect(body.error.code).toBe('LIMIT_REACHED');
    expect(body.error.details).toMatchObject({ limit: 'seats', used: 1, max: 1 });

    const reactivated = await ctx.as(admin, {
      method: 'POST',
      url: `/api/v1/users/${agent.id}/reactivate`,
    });
    expect(reactivated.statusCode).toBe(409);
    expect(
      await ctx.app.db.auditLog.count({ where: { action: 'entitlements.limit_reached' } }),
    ).toBe(2);
  });

  it('caps pipelines, channels, recording retention and storage', async () => {
    await apply(
      signer.document({
        limits: { pipelines: 1, channels: 0, recording_retention_days: 30, storage_gb: 1 },
      }),
    );
    const pipeline = await ctx.as(admin, {
      method: 'POST',
      url: '/api/v1/pipelines',
      payload: { name: 'Second' },
    });
    expect(pipeline.statusCode, pipeline.body).toBe(409);
    expect(pipeline.json<ErrorBody>().error.details?.limit).toBe('pipelines');

    const channel = await ctx.as(admin, {
      method: 'POST',
      url: '/api/v1/channels',
      payload: { type: 'whatsapp', name: 'Line' },
    });
    expect(channel.statusCode, channel.body).toBe(409);
    expect(channel.json<ErrorBody>().error.details?.limit).toBe('channels');

    const current = (await ctx.as(admin, { method: 'GET', url: '/api/v1/settings' })).json<
      Envelope<{ recording: Record<string, unknown> }>
    >().data.recording;
    const retention = await ctx.as(admin, {
      method: 'PATCH',
      url: '/api/v1/settings',
      payload: { recording: { ...current, retentionDays: 60 } },
    });
    expect(retention.statusCode, retention.body).toBe(409);
    expect(retention.json<ErrorBody>().error.details?.limit).toBe('recording_retention_days');
    const ok = await ctx.as(admin, {
      method: 'PATCH',
      url: '/api/v1/settings',
      payload: { recording: { ...current, retentionDays: 30 } },
    });
    expect(ok.statusCode, ok.body).toBe(200);

    // the running total says the store is already at the 1 GB ceiling
    await ctx.app.valkey.hset('entitlements:usage:storage', {
      attachments: String(1024 ** 3),
      recordings: '0',
      backups: '0',
      refreshedAt: new Date().toISOString(),
    });
    const upload = await ctx.as(admin, {
      method: 'POST',
      url: '/api/v1/attachments',
      ...multipart('file', 'dot.png', 'image/png', PNG),
    });
    expect(upload.statusCode, upload.body).toBe(409);
    expect(upload.json<ErrorBody>().error.details?.limit).toBe('storage_gb');
    const usage = (await ctx.as(admin, { method: 'GET', url: '/api/v1/entitlements' })).json<
      Envelope<{ usage: { storage: { usedBytes: number; maxBytes: number | null } } }>
    >().data.usage.storage;
    expect(usage).toMatchObject({ usedBytes: 1024 ** 3, maxBytes: 1024 ** 3 });
  });

  it('rejects a tampered, foreign, misaddressed or stale document without changing what is in force', async () => {
    const { id } = await apply(signer.document({ features: { exports: false } }));
    const before = await ctx.app.entitlements.getState();
    expect(before.issueId).toBe(id);

    const good = signer.sign(signer.document({ features: { exports: true } }));
    const flipped = good.payload.slice(0, -1) + (good.payload.endsWith('A') ? 'B' : 'A');
    const tampered = await ctx.app.entitlements.apply(
      { ...good, payload: flipped },
      { issueId: issueId(), source: 'console', ctx: SYSTEM_AUDIT },
    );
    expect(tampered.result).toBe('rejected');

    const other = createSigner();
    const foreign = await ctx.app.entitlements.apply(other.sign(other.document()), {
      issueId: issueId(),
      source: 'console',
      ctx: SYSTEM_AUDIT,
    });
    expect(foreign).toMatchObject({
      result: 'rejected',
      reason: expect.stringContaining('unknown'),
    });

    const misaddressed = await apply(signer.document({ audience: 'stk_zzzzzzzzzzzzzzzzzzzz' }));
    expect(misaddressed.out.result).toBe('rejected');
    const addressed = await apply(
      signer.document({ audience: TEST_STACK_ID, features: { exports: false } }),
    );
    expect(addressed.out.result).toBe('applied');

    const stale = await apply(signer.document({ issuedAt: '2020-01-01T00:00:00.000Z' }));
    expect(stale.out).toMatchObject({
      result: 'rejected',
      reason: expect.stringContaining('older'),
    });

    expect(await ctx.app.entitlements.has('exports')).toBe(false);
    expect(await ctx.app.db.auditLog.count({ where: { action: 'entitlements.rejected' } })).toBe(4);
    expect(await ctx.app.db.entitlementHistory.count()).toBe(2);
  });

  it('keeps the applied history append-only', async () => {
    await apply(signer.document());
    const row = await ctx.app.db.entitlementHistory.findFirstOrThrow();
    await expect(ctx.app.db.entitlementHistory.delete({ where: { id: row.id } })).rejects.toThrow(
      /append-only/,
    );
  });
});

describe('entitlements: a signed file for a stack with no console', () => {
  let ctx: TestContext;
  let signer: TestSigner;
  let file: string;

  beforeAll(async () => {
    signer = createSigner();
    file = join(await mkdtemp(join(tmpdir(), 'crm-ent-')), 'entitlements.json');
    await writeFile(
      file,
      JSON.stringify(signer.sign(signer.document({ features: { deals: false } }))),
    );
    ctx = await TestContext.create({
      ENTITLEMENTS_FILE: file,
      CONSOLE_PUBLIC_KEY: signer.publicKeyBase64,
    });
  });
  afterAll(async () => {
    await ctx.close();
  });

  it('loads the file at boot and re-reads it on request', async () => {
    await ctx.reset();
    const admin = await ctx.createUser({ role: 'admin' });
    // reset() truncated the table; the service re-reads the file when asked
    const reload = await ctx.as(admin, { method: 'POST', url: '/api/v1/entitlements/reload' });
    expect(reload.statusCode, reload.body).toBe(200);
    expect(reload.json<Envelope<{ result: string }>>().data.result).toBe('applied');
    const dto = await ctx.as(admin, { method: 'GET', url: '/api/v1/entitlements' });
    const data = dto.json<
      Envelope<{
        source: string;
        features: Record<string, boolean>;
        link: { configured: boolean };
      }>
    >().data;
    expect(data.source).toBe('file');
    expect(data.features.deals).toBe(false);
    expect(data.link.configured).toBe(false);
    expect((await ctx.as(admin, { method: 'GET', url: '/api/v1/deals' })).statusCode).toBe(403);

    await writeFile(
      file,
      JSON.stringify(signer.sign(signer.document({ features: { deals: true } }))),
    );
    await ctx.as(admin, { method: 'POST', url: '/api/v1/entitlements/reload' });
    expect((await ctx.as(admin, { method: 'GET', url: '/api/v1/deals' })).statusCode).toBe(200);
  });
});
