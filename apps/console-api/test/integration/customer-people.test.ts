/**
 * The people at a customer, and what happened with them.
 *
 * Two rules are worth pinning down. Only one contact at a time is the person to call, because two
 * of those is the same as none. And a support account can write a note without being able to change
 * anything else about the customer, which is the whole reason that permission exists separately.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TestContext, type TestOwner } from '../setup/test-app.js';

interface Envelope<T> {
  data: T;
}

interface Paged<T> {
  data: T[];
  page: { total: number };
}

interface Contact {
  id: string;
  name: string;
  isPrimary: boolean;
}

interface Note {
  id: string;
  body: string;
  authorName: string | null;
  pinned: boolean;
}

let ctx: TestContext;
let owner: TestOwner;
let support: TestOwner;
let customerId: string;

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
  const res = await ctx.as(owner, {
    method: 'POST',
    url: '/api/v1/customers',
    payload: {
      name: 'Kilimani Auto Parts',
      slug: 'kilimani',
      contactName: 'Grace',
      contactEmail: 'grace@kilimani.example',
    },
  });
  expect(res.statusCode, res.body).toBe(201);
  customerId = res.json<Envelope<{ id: string }>>().data.id;
});

async function addContact(name: string, isPrimary = false): Promise<Contact> {
  const res = await ctx.as(owner, {
    method: 'POST',
    url: `/api/v1/customers/${customerId}/contacts`,
    payload: { name, email: `${name.toLowerCase()}@kilimani.example`, isPrimary },
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json<Envelope<Contact>>().data;
}

describe('the people at a customer', () => {
  it('keeps exactly one of them as the person to call', async () => {
    await addContact('Grace', true);
    const second = await addContact('Wanjiru', true);

    const res = await ctx.as(owner, {
      method: 'GET',
      url: `/api/v1/customers/${customerId}/contacts`,
    });
    const contacts = res.json<Envelope<Contact[]>>().data;
    expect(contacts).toHaveLength(2);
    expect(contacts.filter((c) => c.isPrimary).map((c) => c.id)).toEqual([second.id]);
    // The primary is first, so a screen can show the right one without sorting it itself.
    expect(contacts[0]?.id).toBe(second.id);
  });

  it('records adding, changing and removing one', async () => {
    const contact = await addContact('Grace');
    await ctx.as(owner, {
      method: 'PATCH',
      url: `/api/v1/customers/${customerId}/contacts/${contact.id}`,
      payload: { role: 'Operations manager' },
    });
    const removed = await ctx.as(owner, {
      method: 'DELETE',
      url: `/api/v1/customers/${customerId}/contacts/${contact.id}`,
    });
    expect(removed.statusCode, removed.body).toBe(200);

    const actions = (await ctx.app.db.auditLog.findMany()).map((a) => a.action);
    expect(actions).toContain('customer.contact_add');
    expect(actions).toContain('customer.contact_update');
    expect(actions).toContain('customer.contact_delete');
  });

  it('will not touch a contact belonging to somebody else', async () => {
    const contact = await addContact('Grace');
    const other = await ctx.as(owner, {
      method: 'POST',
      url: '/api/v1/customers',
      payload: {
        name: 'Thika Road Logistics',
        slug: 'thika',
        contactName: 'Sam',
        contactEmail: 'sam@thika.example',
      },
    });
    const otherId = other.json<Envelope<{ id: string }>>().data.id;

    const res = await ctx.as(owner, {
      method: 'DELETE',
      url: `/api/v1/customers/${otherId}/contacts/${contact.id}`,
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('notes about a customer', () => {
  it('keeps them newest first, with pinned ones above', async () => {
    await ctx.as(owner, {
      method: 'POST',
      url: `/api/v1/customers/${customerId}/notes`,
      payload: { body: 'Called about the July invoice.' },
    });
    const pinned = await ctx.as(owner, {
      method: 'POST',
      url: `/api/v1/customers/${customerId}/notes`,
      payload: { body: 'Pays late every quarter. Chase early.', pinned: true },
    });
    expect(pinned.statusCode, pinned.body).toBe(201);

    const res = await ctx.as(owner, {
      method: 'GET',
      url: `/api/v1/customers/${customerId}/notes`,
    });
    const list = res.json<Paged<Note>>();
    expect(list.page.total).toBe(2);
    expect(list.data[0]?.pinned).toBe(true);
    // Whoever wrote it is named, so a note is never anonymous advice.
    expect(list.data[0]?.authorName).toBe('The owner');
  });

  it('lets a support account write one without letting them change the customer', async () => {
    const wrote = await ctx.as(support, {
      method: 'POST',
      url: `/api/v1/customers/${customerId}/notes`,
      payload: { body: 'They rang about a locked out user.' },
    });
    expect(wrote.statusCode, wrote.body).toBe(201);

    const refused = await ctx.as(support, {
      method: 'PATCH',
      url: `/api/v1/customers/${customerId}`,
      payload: { name: 'Renamed by support' },
    });
    expect(refused.statusCode).toBe(403);

    // And they cannot remove one either: writing is not the same as editing the record.
    const noteId = wrote.json<Envelope<Note>>().data.id;
    const deletion = await ctx.as(support, {
      method: 'DELETE',
      url: `/api/v1/customers/${customerId}/notes/${noteId}`,
    });
    expect(deletion.statusCode).toBe(403);
  });
});
