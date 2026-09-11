/**
 * What a support account may and may not do here.
 *
 * The point of the second role is that somebody can answer a locked-out customer without also being
 * able to change what that customer pays or who else may sign in. These tests are that sentence,
 * checked: a refusal for every writing route, an allowance for every reading one, and an audit row
 * behind each refusal so a denial is never silent.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TestContext, type TestOwner } from '../setup/test-app.js';

let ctx: TestContext;
let owner: TestOwner;
let support: TestOwner;

beforeAll(async () => {
  ctx = await TestContext.create();
});

afterAll(async () => {
  await ctx.close();
});

beforeEach(async () => {
  await ctx.reset();
  owner = await ctx.createOwner({ name: 'The owner' });
  support = await ctx.createOwner({ name: 'The helper', role: 'support' });
});

describe('a support account', () => {
  it('is told what it may do, and the list stops short of the console itself', async () => {
    const res = await ctx.as(support, { method: 'GET', url: '/api/v1/me' });
    expect(res.statusCode, res.body).toBe(200);
    const me = res.json<{ data: { role: string; permissions: string[] } }>().data;
    expect(me.role).toBe('support');
    for (const allowed of ['customer:read', 'support:run', 'analytics:read', 'stack:operate']) {
      expect(me.permissions).toContain(allowed);
    }
    for (const refused of [
      'plan:write',
      'entitlement:issue',
      'owner:manage',
      'settings:manage',
      'customer:write',
      'customer:archive',
      'stack:manage',
      'alert:manage',
      'audit:export',
    ]) {
      expect(me.permissions).not.toContain(refused);
    }
  });

  it('may read the fleet, the plans, the alerts screen data and the log', async () => {
    for (const url of [
      '/api/v1/fleet',
      '/api/v1/plans',
      '/api/v1/analytics/overview',
      '/api/v1/audit',
    ]) {
      const res = await ctx.as(support, { method: 'GET', url });
      expect(res.statusCode, `${url}: ${res.body}`).toBe(200);
    }
  });

  it('is refused everything that changes what a customer is sold, and the refusal is recorded', async () => {
    const refusals = [
      {
        method: 'POST' as const,
        url: '/api/v1/owners',
        payload: { name: 'Nobody', email: 'nobody@example.com' },
      },
      {
        method: 'PUT' as const,
        url: '/api/v1/console/settings',
        payload: { ownerContact: { name: 'Support', email: 'help@example.com' } },
      },
      {
        method: 'POST' as const,
        url: '/api/v1/customers',
        payload: {
          name: 'New customer',
          slug: 'new-customer',
          contactName: 'A',
          contactEmail: 'a@example.com',
        },
      },
    ];
    for (const refusal of refusals) {
      const res = await ctx.as(support, refusal);
      expect(res.statusCode, `${refusal.url}: ${res.body}`).toBe(403);
    }
    const denials = await ctx.app.db.auditLog.findMany({ where: { action: 'access.denied' } });
    expect(denials.length).toBeGreaterThanOrEqual(refusals.length);
    expect(denials.every((d) => d.actorId === support.id)).toBe(true);
  });
});

describe('the door into Better Auth’s admin surface', () => {
  it('is not there, for an owner as much as for anybody else', async () => {
    for (const account of [owner, support]) {
      const res = await ctx.as(account, {
        method: 'POST',
        url: '/api/auth/admin/set-role',
        payload: { userId: support.id, role: 'owner' },
      });
      expect(res.statusCode, res.body).toBe(404);
    }
    const denials = await ctx.app.db.auditLog.findMany({
      where: { action: 'access.denied', entity: 'auth' },
    });
    expect(denials.length).toBe(2);
  });
});

describe('changing what somebody may do', () => {
  it('takes effect at once, because it ends their sessions', async () => {
    expect((await ctx.as(support, { method: 'GET', url: '/api/v1/me' })).statusCode).toBe(200);

    const res = await ctx.as(owner, {
      method: 'POST',
      url: `/api/v1/owners/${support.id}/role`,
      payload: { role: 'owner' },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json<{ data: { role: string } }>().data.role).toBe('owner');

    // The cookie they were holding is gone, which is the observable half of the change.
    expect((await ctx.as(support, { method: 'GET', url: '/api/v1/me' })).statusCode).toBe(401);

    const row = await ctx.app.db.auditLog.findFirstOrThrow({
      where: { action: 'owner.role_change' },
    });
    expect(row.entityId).toBe(support.id);
    expect(JSON.stringify(row.before)).toContain('support');
    expect(JSON.stringify(row.after)).toContain('owner');
  });

  it('refuses to let somebody change their own', async () => {
    const res = await ctx.as(owner, {
      method: 'POST',
      url: `/api/v1/owners/${owner.id}/role`,
      payload: { role: 'support' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.body).toContain('your own role');
  });

  it('invites a support account as support, not as an owner', async () => {
    const res = await ctx.as(owner, {
      method: 'POST',
      url: '/api/v1/owners',
      payload: { name: 'Second helper', email: 'helper2@example.com', role: 'support' },
    });
    expect(res.statusCode, res.body).toBe(201);
    const created = await ctx.app.db.user.findUniqueOrThrow({
      where: { email: 'helper2@example.com' },
    });
    expect(created.role).toBe('support');
  });
});
