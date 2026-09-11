import { newId } from '../../src/lib/ids.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TestContext } from '../setup/test-app.js';

describe('auth & authorization', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await TestContext.create();
  });
  beforeEach(async () => {
    await ctx.reset();
  });
  afterAll(async () => {
    await ctx.close();
  });

  it('signs in with email + password and returns the profile with permissions', async () => {
    const agent = await ctx.createUser({ role: 'agent', extension: '1001' });
    const res = await ctx.as(agent, { method: 'GET', url: '/api/v1/users/me' });
    expect(res.statusCode).toBe(200);
    const me = res.json<{
      data: { email: string; role: string; extension: string; permissions: string[] };
    }>().data;
    expect(me.email).toBe(agent.email);
    expect(me.role).toBe('agent');
    expect(me.extension).toBe('1001');
    expect(me.permissions).toContain('contact:read');
    expect(me.permissions).not.toContain('settings:manage');
  });

  it('rejects wrong passwords and audits the failure', async () => {
    const agent = await ctx.createUser({ role: 'agent' });
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/email',
      headers: { 'content-type': 'application/json', origin: ctx.env.APP_URL },
      payload: { email: agent.email, password: 'definitely-wrong-password' },
    });
    expect(res.statusCode).toBe(401);
    const audit = await ctx.app.db.auditLog.findFirst({ where: { action: 'auth.sign_in_failed' } });
    expect(audit).not.toBeNull();
    const ok = await ctx.app.db.auditLog.findFirst({
      where: { action: 'auth.sign_in', actorId: agent.id },
    });
    expect(ok).not.toBeNull();
  });

  it('public sign-up is disabled', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/sign-up/email',
      headers: { 'content-type': 'application/json', origin: ctx.env.APP_URL },
      payload: { email: 'new@example.com', password: 'Str0ng-Passw0rd-xyz', name: 'New' },
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
  });

  it('enforces role permissions: agents cannot manage settings, admins can', async () => {
    const agent = await ctx.createUser({ role: 'agent' });
    const admin = await ctx.createUser({ role: 'admin' });
    const denied = await ctx.as(agent, {
      method: 'PATCH',
      url: '/api/v1/settings',
      payload: { currency: 'USD' },
    });
    expect(denied.statusCode).toBe(403);
    expect(
      denied.json<{ error: { code: string; details: { required: string[] } } }>().error.details
        .required,
    ).toEqual(['settings:manage']);
    const allowed = await ctx.as(admin, {
      method: 'PATCH',
      url: '/api/v1/settings',
      payload: { currency: 'USD' },
    });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.json<{ data: { currency: string } }>().data.currency).toBe('USD');
  });

  it('deactivated users cannot use existing sessions or sign in again', async () => {
    const admin = await ctx.createUser({ role: 'admin' });
    const agent = await ctx.createUser({ role: 'agent' });
    const off = await ctx.as(admin, {
      method: 'POST',
      url: `/api/v1/users/${agent.id}/deactivate`,
    });
    expect(off.statusCode, off.body).toBe(200);
    const me = await ctx.as(agent, { method: 'GET', url: '/api/v1/users/me' });
    expect(me.statusCode).toBe(401);
    await expect(ctx.signIn(agent.email, agent.password)).rejects.toThrow(/sign-in failed/);
  });

  it('requires 2FA for privileged roles when the setting is on', async () => {
    await ctx.app.settings.set(
      'security',
      { require2FAForPrivileged: true, require2FAForAll: false, sessionIdleMinutes: 60 },
      null,
    );
    const manager = await ctx.createUser({ role: 'manager' });
    const blocked = await ctx.as(manager, { method: 'GET', url: '/api/v1/users' });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json<{ error: { code: string } }>().error.code).toBe('TWO_FACTOR_REQUIRED');
    // profile stays reachable so the user can enrol
    const me = await ctx.as(manager, { method: 'GET', url: '/api/v1/users/me' });
    expect(me.statusCode).toBe(200);
    // enrolment happens after sign-in (password + TOTP flow is Better Auth's); flip the flag and re-sign-in
    const enrolled = await ctx.createUser({ role: 'manager' });
    await ctx.app.db.user.update({ where: { id: enrolled.id }, data: { twoFactorEnabled: true } });
    const ok = await ctx.as(enrolled, { method: 'GET', url: '/api/v1/users' });
    expect(ok.statusCode).toBe(200);
  });

  it('admin creates a user, who receives a welcome email and can set a password', async () => {
    const admin = await ctx.createUser({ role: 'admin' });
    const res = await ctx.as(admin, {
      method: 'POST',
      url: '/api/v1/users',
      payload: {
        name: 'New Agent',
        email: 'new.agent@example.com',
        role: 'agent',
        extension: '1002',
        phone: '0712345678',
      },
    });
    expect(res.statusCode).toBe(201);
    const created = res.json<{
      data: { id: string; phone: string; extension: string; role: string };
    }>().data;
    expect(created.phone).toBe('+254712345678');
    expect(created.extension).toBe('1002');

    const mail = ctx.app.mailer.outbox.find((m) => m.to === 'new.agent@example.com');
    expect(mail?.subject).toMatch(/Welcome/);
    // Better Auth links look like {APP_URL}/api/auth/reset-password/{token}?callbackURL=...
    const link = /reset-password\/([A-Za-z0-9_-]+)/.exec(mail?.text ?? '');
    expect(link).not.toBeNull();
    const token = link?.[1] ?? '';

    const reset = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/reset-password',
      headers: { 'content-type': 'application/json', origin: ctx.env.APP_URL },
      payload: { newPassword: 'Brand-New-Passw0rd-42', token },
    });
    expect(reset.statusCode).toBe(200);
    const cookie = await ctx.signIn('new.agent@example.com', 'Brand-New-Passw0rd-42');
    expect(cookie).toContain('session_token');
    const user = await ctx.app.db.user.findUnique({ where: { id: created.id } });
    expect(user?.emailVerified).toBe(true);

    const audit = await ctx.app.db.auditLog.findFirst({
      where: { action: 'user.create', entityId: created.id },
    });
    expect(audit?.actorId).toBe(admin.id);
  });

  it('rejects duplicate extensions and self role change', async () => {
    const admin = await ctx.createUser({ role: 'admin' });
    await ctx.createUser({ role: 'agent', extension: '2001' });
    const dup = await ctx.as(admin, {
      method: 'POST',
      url: '/api/v1/users',
      payload: { name: 'Dup', email: 'dup@example.com', extension: '2001' },
    });
    expect(dup.statusCode).toBe(409);
    const self = await ctx.as(admin, {
      method: 'POST',
      url: `/api/v1/users/${admin.id}/role`,
      payload: { role: 'agent' },
    });
    expect(self.statusCode).toBe(409);
  });

  it('role change revokes the target user sessions', async () => {
    const admin = await ctx.createUser({ role: 'admin' });
    const agent = await ctx.createUser({ role: 'agent' });
    const res = await ctx.as(admin, {
      method: 'POST',
      url: `/api/v1/users/${agent.id}/role`,
      payload: { role: 'manager' },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(await ctx.app.db.session.count({ where: { userId: agent.id } })).toBe(0);
    expect(res.json<{ data: { role: string } }>().data.role).toBe('manager');
    const me = await ctx.as(agent, { method: 'GET', url: '/api/v1/users/me' });
    expect(me.statusCode).toBe(401);
  });

  it('audit log rows cannot be updated or deleted', async () => {
    const admin = await ctx.createUser({ role: 'admin' });
    await ctx.as(admin, { method: 'POST', url: '/api/v1/teams', payload: { name: 'Sales' } });
    const row = await ctx.app.db.auditLog.findFirstOrThrow({ where: { action: 'team.create' } });
    await expect(ctx.app.db.auditLog.delete({ where: { id: row.id } })).rejects.toThrow(
      /append-only/,
    );
  });

  it('an admin can reset a locked-out user two-factor, and it is audited', async () => {
    const admin = await ctx.createUser({ role: 'admin' });
    // Created without a second factor so the sign-in in createUser actually yields a session,
    // then switched on: a user who already had 2FA would be redirected to verify and never get
    // one, which is not the state a locked-out person is in.
    const stuck = await ctx.createUser({ role: 'manager' });
    await ctx.app.db.user.update({ where: { id: stuck.id }, data: { twoFactorEnabled: true } });
    await ctx.app.db.twoFactor.create({
      data: { id: newId(), userId: stuck.id, secret: 'JBSWY3DPEHPK3PXP', backupCodes: 'x' },
    });
    // Sessions live in Valkey, not a table, so the guarantee is checked the way it is felt:
    // the cookie they are holding right now stops working.
    const before = await ctx.as(stuck, { method: 'GET', url: '/api/v1/users/me' });
    expect(before.statusCode, before.body).toBe(200);

    const res = await ctx.as(admin, {
      method: 'POST',
      url: `/api/v1/users/${stuck.id}/two-factor/reset`,
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json<{ data: { twoFactorEnabled: boolean } }>().data.twoFactorEnabled).toBe(false);
    expect(await ctx.app.db.twoFactor.count({ where: { userId: stuck.id } })).toBe(0);
    // signed out everywhere: a second factor they cannot prove must not keep old sessions alive
    const after = await ctx.as(stuck, { method: 'GET', url: '/api/v1/users/me' });
    expect(after.statusCode).toBe(401);

    const entry = await ctx.app.db.auditLog.findFirst({
      where: { action: 'user.two_factor_reset', entityId: stuck.id },
    });
    expect(entry?.actorId).toBe(admin.id);

    // handing out a way in is not something an agent or a manager may do
    for (const role of ['agent', 'manager'] as const) {
      const other = await ctx.createUser({ role });
      const denied = await ctx.as(other, {
        method: 'POST',
        url: `/api/v1/users/${stuck.id}/two-factor/reset`,
      });
      expect(denied.statusCode, `${role} should not reset two-factor`).toBe(403);
    }
  });

  it('sends a person a link to set or reset their own password, and never sets one for them', async () => {
    const admin = await ctx.createUser({ role: 'admin' });
    const fresh = await ctx.createUser({ role: 'agent' });
    // Nobody has finished a first link yet, so this is a welcome rather than a reset.
    await ctx.app.db.user.update({ where: { id: fresh.id }, data: { emailVerified: false } });

    const first = await ctx.as(admin, {
      method: 'POST',
      url: `/api/v1/users/${fresh.id}/password-link`,
    });
    expect(first.statusCode, first.body).toBe(200);
    expect(first.json<{ data: { sent: string } }>().data.sent).toBe('welcome');

    // Once they have proved the mailbox, the same button is a reset.
    await ctx.app.db.user.update({ where: { id: fresh.id }, data: { emailVerified: true } });
    const second = await ctx.as(admin, {
      method: 'POST',
      url: `/api/v1/users/${fresh.id}/password-link`,
    });
    expect(second.statusCode, second.body).toBe(200);
    expect(second.json<{ data: { sent: string } }>().data.sent).toBe('reset');

    const entry = await ctx.app.db.auditLog.findFirst({
      where: { action: 'user.password_link_sent', entityId: fresh.id },
    });
    expect(entry?.actorId).toBe(admin.id);

    for (const role of ['agent', 'manager'] as const) {
      const other = await ctx.createUser({ role });
      const denied = await ctx.as(other, {
        method: 'POST',
        url: `/api/v1/users/${fresh.id}/password-link`,
      });
      expect(denied.statusCode, `${role} should not send password links`).toBe(403);
    }
  });

  it('deletes an account that has done nothing and refuses one that has', async () => {
    const admin = await ctx.createUser({ role: 'admin' });
    const mistake = await ctx.createUser({ role: 'agent' });

    // Nobody may delete themselves, whatever their role.
    const self = await ctx.as(admin, { method: 'DELETE', url: `/api/v1/users/${admin.id}` });
    expect(self.statusCode, self.body).toBe(409);

    const gone = await ctx.as(admin, { method: 'DELETE', url: `/api/v1/users/${mistake.id}` });
    expect(gone.statusCode, gone.body).toBe(204);
    expect(await ctx.app.db.user.count({ where: { id: mistake.id } })).toBe(0);
    // The log has to say whose account it was; afterwards there is nothing left to ask.
    const entry = await ctx.app.db.auditLog.findFirst({
      where: { action: 'user.delete', entityId: mistake.id },
    });
    expect((entry?.before as { email?: string } | null)?.email).toBe(mistake.email);

    // Somebody who has written anything keeps their history, and is told to deactivate instead.
    const worked = await ctx.createUser({ role: 'agent' });
    const contact = await ctx.as(worked, {
      method: 'POST',
      url: '/api/v1/contacts',
      payload: { firstName: 'Amina', lastName: 'Hassan' },
    });
    expect(contact.statusCode, contact.body).toBe(201);
    await ctx.as(worked, {
      method: 'POST',
      url: '/api/v1/notes',
      payload: {
        body: 'Rang about the invoice.',
        contactId: contact.json<{ data: { id: string } }>().data.id,
      },
    });

    const refused = await ctx.as(admin, { method: 'DELETE', url: `/api/v1/users/${worked.id}` });
    expect(refused.statusCode, refused.body).toBe(409);
    expect(refused.body).toContain('deactivated');
    expect(await ctx.app.db.user.count({ where: { id: worked.id } })).toBe(1);

    for (const role of ['agent', 'manager'] as const) {
      const other = await ctx.createUser({ role });
      const spare = await ctx.createUser({ role: 'agent' });
      const denied = await ctx.as(other, { method: 'DELETE', url: `/api/v1/users/${spare.id}` });
      expect(denied.statusCode, `${role} should not delete users`).toBe(403);
    }
  });

  it("audit list resolves the actor's name rather than a bare id", async () => {
    const admin = await ctx.createUser({ role: 'admin' });
    await ctx.as(admin, { method: 'POST', url: '/api/v1/teams', payload: { name: 'Support' } });

    const list = await ctx.as(admin, { method: 'GET', url: '/api/v1/audit?action=team.create' });
    expect(list.statusCode, list.body).toBe(200);
    const rows = list.json<{
      data: { actorId: string | null; actor: { id: string; name: string } | null }[];
    }>().data;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.actorId).toBe(admin.id);
    // createUser names the row "Test <role>" when no name is given; the resolved actor carries
    // that same name, not just the id the endpoint used to return on its own.
    expect(rows[0]?.actor).toEqual({ id: admin.id, name: 'Test admin' });

    // a signature rejection is written with no actor at all; it must come back null, not
    // crash the caller the way a bare, unresolved id previously did on the frontend
    await ctx.app.audit.write(
      { actorId: null, actorType: 'webhook' },
      { action: 'webhook.signature_rejected', entity: 'whatsapp' },
    );
    const system = await ctx.as(admin, {
      method: 'GET',
      url: '/api/v1/audit?action=webhook.signature_rejected',
    });
    const systemRows = system.json<{ data: { actorId: string | null; actor: unknown }[] }>().data;
    expect(systemRows[0]?.actorId).toBeNull();
    expect(systemRows[0]?.actor).toBeNull();

    const denied = await ctx.as(await ctx.createUser({ role: 'agent' }), {
      method: 'GET',
      url: '/api/v1/audit',
    });
    expect(denied.statusCode).toBe(403);
  });
});
