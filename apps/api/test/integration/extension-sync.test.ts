/**
 * Extension matching against the fake PBX (docs/06 §18).
 *
 * The unit tests cover the rule. These cover what the rule is for: a person whose email is on a
 * PBX extension gets that extension without anyone typing it, the extension map the popup reads
 * is refreshed in the same run, and an extension somebody set by hand is never touched.
 */
import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import { lastExtensionSyncReport, runExtensionSync } from '../../src/jobs/extension-sync.js';
import { FakePbx } from '../setup/fake-pbx.js';
import { TestContext, type TestUser } from '../setup/test-app.js';

interface Envelope<T> {
  data: T;
}

describe('extension matching by email (fake PBX)', () => {
  let pbx: FakePbx;
  let ctx: TestContext;
  let admin: TestUser;

  beforeAll(async () => {
    pbx = new FakePbx();
    const pbxUrl = await pbx.start();
    ctx = await TestContext.create({
      YEASTAR_ENABLED: 'true',
      YEASTAR_BASE_URL: pbxUrl,
      YEASTAR_CLIENT_ID: 'client-id',
      YEASTAR_CLIENT_SECRET: 'client-secret',
      YEASTAR_EVENT_SOURCE: 'webhook',
      YEASTAR_WEBHOOK_SECRET: 'whsec-0123456789abcdef0123456789ab',
      YEASTAR_TIMEZONE: 'Africa/Nairobi',
    });
  }, 60_000);

  beforeEach(async () => {
    await ctx.reset();
    admin = await ctx.createUser({ role: 'admin', extension: '1000' });
    pbx.extensions = [{ number: '1000', email_addr: admin.email }];
    pbx.requests.length = 0;
  });

  afterAll(async () => {
    await ctx.close();
    await pbx.stop();
  });

  it('fills in the extension of a user whose email is on the PBX, and refreshes the map', async () => {
    const liban = await ctx.createUser({ role: 'agent', name: 'Liban' });
    pbx.extensions.push({ number: '205', caller_id_name: 'Liban', email_addr: liban.email });

    const report = await runExtensionSync(ctx.app);

    expect(report?.assigned).toEqual([{ userId: liban.id, userName: 'Liban', extension: '205' }]);
    const row = await ctx.app.db.user.findUniqueOrThrow({ where: { id: liban.id } });
    expect(row.extension).toBe('205');
    // The lookup the ringing popup uses, not only the row.
    await ctx.app.cti.extMap.refresh();
    expect((await ctx.app.cti.extMap.lookup('205'))?.userId).toBe(liban.id);
  });

  it('leaves an extension somebody set by hand alone, and says so', async () => {
    const liban = await ctx.createUser({ role: 'agent', extension: '300' });
    pbx.extensions.push({ number: '205', email_addr: liban.email });

    const report = await runExtensionSync(ctx.app);

    expect(report?.assigned).toEqual([]);
    expect(report?.conflicts).toEqual([
      expect.objectContaining({ kind: 'extension_differs', userId: liban.id, pbxExtension: '205' }),
    ]);
    expect((await ctx.app.db.user.findUniqueOrThrow({ where: { id: liban.id } })).extension).toBe(
      '300',
    );
  });

  it('lists a user with no extension and no matching email, since they get no popups', async () => {
    const nobody = await ctx.createUser({ role: 'agent', name: 'Nobody Yet' });

    const report = await runExtensionSync(ctx.app);

    expect(report?.usersWithoutExtension).toEqual([
      { userId: nobody.id, userName: 'Nobody Yet', email: nobody.email },
    ]);
  });

  it('keeps the last report where the settings screen reads it', async () => {
    await runExtensionSync(ctx.app);

    const stored = await lastExtensionSyncReport(ctx.app.valkey);
    expect(stored?.matched).toBe(1);
    const res = await ctx.as(admin, { method: 'GET', url: '/api/v1/cti/extension-links' });
    expect(res.statusCode).toBe(200);
    expect(res.json<Envelope<{ matched: number }>>().data.matched).toBe(1);
  });

  it('runs on demand from the settings screen and audits it', async () => {
    const liban = await ctx.createUser({ role: 'agent' });
    pbx.extensions.push({ number: '205', email_addr: liban.email });

    const res = await ctx.as(admin, { method: 'POST', url: '/api/v1/cti/extension-links/sync' });

    expect(res.statusCode).toBe(200);
    expect(res.json<Envelope<{ assigned: unknown[] }>>().data.assigned).toHaveLength(1);
    expect(await ctx.app.db.auditLog.count({ where: { action: 'user.extension_matched' } })).toBe(
      1,
    );
    expect(await ctx.app.db.auditLog.count({ where: { action: 'pbx.extension_links' } })).toBe(1);
  });

  it('does nothing when switched off', async () => {
    await ctx.app.settings.patch({ extensionSync: { enabled: false } }, null);
    const liban = await ctx.createUser({ role: 'agent' });
    pbx.extensions.push({ number: '205', email_addr: liban.email });

    expect(await runExtensionSync(ctx.app)).toBeNull();
    expect((await ctx.app.db.user.findUniqueOrThrow({ where: { id: liban.id } })).extension).toBe(
      null,
    );
  });
});
