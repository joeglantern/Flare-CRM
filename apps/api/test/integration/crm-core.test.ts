import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TestContext, type TestUser } from '../setup/test-app.js';

interface Envelope<T> {
  data: T;
}

describe('core CRM: contacts, companies, custom fields, visibility', () => {
  let ctx: TestContext;
  let admin: TestUser;
  let agent: TestUser;
  beforeAll(async () => {
    ctx = await TestContext.create();
  });
  beforeEach(async () => {
    await ctx.reset();
    admin = await ctx.createUser({ role: 'admin' });
    agent = await ctx.createUser({ role: 'agent', extension: '1001' });
  });
  afterAll(async () => {
    await ctx.close();
  });

  it('creates a contact with normalized phones, writes timeline + audit, and dedupes', async () => {
    const res = await ctx.as(agent, {
      method: 'POST',
      url: '/api/v1/contacts',
      payload: {
        firstName: 'Jane',
        lastName: 'Doe',
        phones: [{ number: '0712 345 678' }],
        emails: [{ email: 'Jane@Example.com' }],
        tags: ['vip'],
      },
    });
    expect(res.statusCode, res.body).toBe(201);
    const contact = res.json<
      Envelope<{
        id: string;
        displayName: string;
        phones: { e164: string; isPrimary: boolean }[];
        emails: { email: string }[];
        ownerId: string;
      }>
    >().data;
    expect(contact.displayName).toBe('Jane Doe');
    expect(contact.phones[0]).toMatchObject({ e164: '+254712345678', isPrimary: true });
    expect(contact.emails[0]?.email).toBe('jane@example.com');
    expect(contact.ownerId).toBe(agent.id);

    const dup = await ctx.as(agent, {
      method: 'POST',
      url: '/api/v1/contacts',
      payload: { firstName: 'Other', phones: [{ number: '+254712345678' }] },
    });
    expect(dup.statusCode).toBe(409);
    expect(
      dup.json<{ error: { code: string; details: { matches: unknown[] } } }>().error.details
        .matches,
    ).toHaveLength(1);

    const check = await ctx.as(agent, {
      method: 'GET',
      url: '/api/v1/contacts/duplicates?phone=0712345678',
    });
    expect(check.json<Envelope<{ matchedOn: string }[]>>().data[0]?.matchedOn).toBe('phone');

    const timeline = await ctx.as(agent, {
      method: 'GET',
      url: `/api/v1/contacts/${contact.id}/timeline`,
    });
    expect(timeline.statusCode).toBe(200);
    expect(timeline.json<Envelope<{ type: string }[]>>().data.map((a) => a.type)).toContain(
      'contact_created',
    );

    const audit = await ctx.app.db.auditLog.findFirst({
      where: { action: 'contact.create', entityId: contact.id },
    });
    expect(audit?.actorId).toBe(agent.id);

    // search by partial phone digits and by name
    const search = await ctx.as(agent, { method: 'GET', url: '/api/v1/contacts?q=712345' });
    expect(search.json<Envelope<unknown[]>>().data).toHaveLength(1);
    const byName = await ctx.as(agent, { method: 'GET', url: '/api/v1/contacts?q=jane' });
    expect(byName.json<Envelope<unknown[]>>().data).toHaveLength(1);
  });

  it('enforces agent visibility (owned) and manager visibility (team)', async () => {
    const team = await ctx.as(admin, {
      method: 'POST',
      url: '/api/v1/teams',
      payload: { name: 'Sales' },
    });
    const teamId = team.json<Envelope<{ id: string }>>().data.id;
    const manager = await ctx.createUser({ role: 'manager', teamId });
    const agentB = await ctx.createUser({ role: 'agent', teamId });
    const outsider = await ctx.createUser({ role: 'agent' });

    const mine = await ctx.as(agentB, {
      method: 'POST',
      url: '/api/v1/contacts',
      payload: { firstName: 'Mine', phones: [{ number: '0722000001' }] },
    });
    const mineId = mine.json<Envelope<{ id: string }>>().data.id;
    const theirs = await ctx.as(outsider, {
      method: 'POST',
      url: '/api/v1/contacts',
      payload: { firstName: 'Theirs', phones: [{ number: '0722000002' }] },
    });
    const theirsId = theirs.json<Envelope<{ id: string }>>().data.id;

    // agent sees only own
    const list = await ctx.as(agentB, { method: 'GET', url: '/api/v1/contacts' });
    expect(list.json<Envelope<{ id: string }[]>>().data.map((c) => c.id)).toEqual([mineId]);
    const hidden = await ctx.as(agentB, { method: 'GET', url: `/api/v1/contacts/${theirsId}` });
    expect(hidden.statusCode).toBe(404);
    // agent cannot assign to others without permission
    const assign = await ctx.as(agentB, {
      method: 'PATCH',
      url: `/api/v1/contacts/${mineId}`,
      payload: { ownerId: outsider.id },
    });
    expect(assign.statusCode).toBe(403);

    // manager sees the team member's record but not the outsider's
    const managerList = await ctx.as(manager, { method: 'GET', url: '/api/v1/contacts' });
    expect(managerList.json<Envelope<{ id: string }[]>>().data.map((c) => c.id)).toEqual([mineId]);

    // admin sees everything
    const adminList = await ctx.as(admin, { method: 'GET', url: '/api/v1/contacts' });
    expect(adminList.json<Envelope<unknown[]>>().data).toHaveLength(2);

    // switching the setting to "all" opens visibility for agents
    await ctx.as(admin, {
      method: 'PATCH',
      url: '/api/v1/settings',
      payload: { agentVisibility: 'all' },
    });
    const open = await ctx.as(agentB, { method: 'GET', url: '/api/v1/contacts' });
    expect(open.json<Envelope<unknown[]>>().data).toHaveLength(2);
  });

  it('validates configurable custom fields', async () => {
    const def = await ctx.as(admin, {
      method: 'POST',
      url: '/api/v1/custom-fields',
      payload: {
        entity: 'contact',
        key: 'segment',
        label: 'Segment',
        type: 'select',
        options: [
          { value: 'smb', label: 'SMB' },
          { value: 'ent', label: 'Enterprise' },
        ],
      },
    });
    expect(def.statusCode, def.body).toBe(201);
    const bad = await ctx.as(agent, {
      method: 'POST',
      url: '/api/v1/contacts',
      payload: { firstName: 'X', customFields: { segment: 'nope' } },
    });
    expect(bad.statusCode).toBe(422);
    const unknown = await ctx.as(agent, {
      method: 'POST',
      url: '/api/v1/contacts',
      payload: { firstName: 'X', customFields: { other: 1 } },
    });
    expect(unknown.statusCode).toBe(422);
    const ok = await ctx.as(agent, {
      method: 'POST',
      url: '/api/v1/contacts',
      payload: { firstName: 'X', customFields: { segment: 'smb' } },
    });
    expect(ok.statusCode, ok.body).toBe(201);
    expect(
      ok.json<Envelope<{ customFields: Record<string, unknown> }>>().data.customFields,
    ).toEqual({ segment: 'smb' });
  });

  it('merges duplicates, moving history to the survivor and freeing identifiers', async () => {
    const a = (
      await ctx.as(agent, {
        method: 'POST',
        url: '/api/v1/contacts',
        payload: { firstName: 'A', phones: [{ number: '0733000001' }], tags: ['x'] },
      })
    ).json<Envelope<{ id: string }>>().data;
    const b = (
      await ctx.as(agent, {
        method: 'POST',
        url: '/api/v1/contacts',
        payload: { firstName: 'B', phones: [{ number: '0733000002' }], tags: ['y'] },
      })
    ).json<Envelope<{ id: string }>>().data;
    await ctx.as(agent, {
      method: 'POST',
      url: '/api/v1/notes',
      payload: { body: 'note on B', contactId: b.id },
    });
    const manager = await ctx.createUser({ role: 'manager' });
    await ctx.as(admin, {
      method: 'PATCH',
      url: '/api/v1/settings',
      payload: { agentVisibility: 'all' },
    });
    const merged = await ctx.as(manager, {
      method: 'POST',
      url: `/api/v1/contacts/${a.id}/merge`,
      payload: { sourceId: b.id },
    });
    expect(merged.statusCode, merged.body).toBe(200);
    const dto = merged.json<Envelope<{ phones: { e164: string }[]; tags: string[] }>>().data;
    expect(dto.phones.map((p) => p.e164).sort()).toEqual(['+254733000001', '+254733000002']);
    expect(dto.tags.sort()).toEqual(['x', 'y']);
    const gone = await ctx.as(manager, { method: 'GET', url: `/api/v1/contacts/${b.id}` });
    expect(gone.statusCode).toBe(404);
    const timeline = await ctx.as(manager, {
      method: 'GET',
      url: `/api/v1/contacts/${a.id}/timeline?types=note`,
    });
    expect(timeline.json<Envelope<{ summary: string }[]>>().data[0]?.summary).toBe('note on B');
  });

  it('soft-deletes and restores a contact, releasing the phone number in between', async () => {
    const c = (
      await ctx.as(admin, {
        method: 'POST',
        url: '/api/v1/contacts',
        payload: { firstName: 'Del', phones: [{ number: '0744000001' }] },
      })
    ).json<Envelope<{ id: string }>>().data;
    const del = await ctx.as(admin, { method: 'DELETE', url: `/api/v1/contacts/${c.id}` });
    expect(del.statusCode).toBe(204);
    const reuse = await ctx.as(admin, {
      method: 'POST',
      url: '/api/v1/contacts',
      payload: { firstName: 'New', phones: [{ number: '0744000001' }] },
    });
    expect(reuse.statusCode, reuse.body).toBe(201);
    const restore = await ctx.as(admin, {
      method: 'POST',
      url: `/api/v1/contacts/${c.id}/restore`,
    });
    expect(restore.statusCode).toBe(409); // number now belongs to "New"
  });

  it('companies: CRUD with ownership and contact count', async () => {
    const created = await ctx.as(agent, {
      method: 'POST',
      url: '/api/v1/companies',
      payload: { name: 'Acme Ltd', phone: '020 123 4567', website: 'https://acme.example' },
    });
    expect(created.statusCode, created.body).toBe(201);
    const company = created.json<Envelope<{ id: string; phone: string }>>().data;
    expect(company.phone).toBe('+254201234567');
    await ctx.as(agent, {
      method: 'POST',
      url: '/api/v1/contacts',
      payload: { firstName: 'Emp', companyId: company.id },
    });
    const got = await ctx.as(agent, { method: 'GET', url: `/api/v1/companies/${company.id}` });
    expect(got.json<Envelope<{ contactCount: number }>>().data.contactCount).toBe(1);
    const stale = await ctx.as(agent, {
      method: 'PATCH',
      url: `/api/v1/companies/${company.id}`,
      payload: { name: 'Acme', expectedUpdatedAt: '2020-01-01T00:00:00.000Z' },
    });
    expect(stale.statusCode).toBe(409);
  });
});
