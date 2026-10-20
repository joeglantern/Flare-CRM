/**
 * The address lock (Settings, Security): with it on, only the listed addresses reach the CRM,
 * sign-in included, and an admin cannot switch it on from an address that is not on the list.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TestContext, type TestUser } from '../setup/test-app.js';

describe('locking the CRM to a list of addresses', () => {
  let ctx: TestContext;
  let admin: TestUser;
  const OFFICE = '10.1.1.7';
  const ELSEWHERE = '10.2.2.2';

  const from = (ip: string) => ({ 'x-forwarded-for': ip });
  const lock = (by: TestUser, ip: string, enabled: boolean, entries: { value: string }[]) =>
    ctx.as(by, {
      method: 'PATCH',
      url: '/api/v1/settings',
      headers: from(ip),
      payload: { ipAllowlist: { enabled, entries } },
    });

  beforeAll(async () => {
    ctx = await TestContext.create();
  });
  beforeEach(async () => {
    await ctx.reset();
    admin = await ctx.createUser({ role: 'admin' });
  });
  afterAll(async () => {
    // The next test file's app reads settings as it boots; leave the lock off behind us.
    await ctx.app.db.setting.deleteMany({ where: { key: 'ipAllowlist' } });
    await ctx.close();
  });

  it('tells an admin their own address, as the lock sees it', async () => {
    const res = await ctx.as(admin, {
      method: 'GET',
      url: '/api/v1/settings/my-address',
      headers: from(OFFICE),
    });
    expect(res.json<{ data: { ip: string } }>().data.ip).toBe(OFFICE);
  });

  it('refuses to lock out the admin switching it on', async () => {
    const res = await lock(admin, ELSEWHERE, true, [{ value: '10.1.1.0/24' }]);
    expect(res.statusCode).toBe(422);
    expect(res.body).toContain(ELSEWHERE);
    expect((await ctx.app.settings.get('ipAllowlist')).enabled).toBe(false);
  });

  it('rejects an entry that is not an address or range', async () => {
    const res = await lock(admin, OFFICE, true, [{ value: 'office.example.com' }]);
    expect(res.statusCode).toBe(422);
  });

  it('lets in the listed addresses only, sign-in included, and logs a refusal once', async () => {
    const on = await lock(admin, OFFICE, true, [{ value: '10.1.1.0/24' }]);
    expect(on.statusCode, on.body).toBe(200);
    await new Promise((r) => setTimeout(r, 50));

    const inside = await ctx.as(admin, {
      method: 'GET',
      url: '/api/v1/users/me',
      headers: from(OFFICE),
    });
    expect(inside.statusCode).toBe(200);

    const outside = await ctx.as(admin, {
      method: 'GET',
      url: '/api/v1/users/me',
      headers: from(ELSEWHERE),
    });
    expect(outside.statusCode).toBe(403);
    expect(outside.json<{ error: { code: string } }>().error.code).toBe('IP_NOT_ALLOWED');

    const signIn = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/email',
      headers: { 'content-type': 'application/json', origin: ctx.env.APP_URL, ...from(ELSEWHERE) },
      payload: { email: admin.email, password: admin.password },
    });
    expect(signIn.statusCode).toBe(403);

    // Health checks stay open: the server's own monitoring is not on the office network.
    expect(
      (await ctx.app.inject({ method: 'GET', url: '/health', headers: from(ELSEWHERE) }))
        .statusCode,
    ).toBe(200);

    expect(
      await ctx.app.db.auditLog.count({
        where: { action: 'security.ip_refused', ip: ELSEWHERE },
      }),
    ).toBe(1);

    const off = await lock(admin, OFFICE, false, [{ value: '10.1.1.0/24' }]);
    expect(off.statusCode).toBe(200);
  });

  it('shows the device and filters the audit log by address', async () => {
    await ctx.as(admin, {
      method: 'PATCH',
      url: '/api/v1/settings',
      headers: { ...from(OFFICE), 'user-agent': 'Mozilla/5.0 (Windows NT 10.0) Chrome/130.0' },
      payload: { currency: 'USD' },
    });
    const res = await ctx.as(admin, {
      method: 'GET',
      url: `/api/v1/audit?ip=${OFFICE}`,
      headers: from(OFFICE),
    });
    const rows = res.json<{ data: { ip: string; userAgent: string | null }[] }>().data;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.ip === OFFICE)).toBe(true);
    expect(rows.some((r) => r.userAgent?.includes('Chrome') === true)).toBe(true);
  });
});
