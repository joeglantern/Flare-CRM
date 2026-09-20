/**
 * Contact sync against the fake PBX (docs/06 §17).
 *
 * The unit tests cover the rules; these cover the promise the customer was made, which is that
 * every contact on one side exists on the other. So they assert convergence from both directions,
 * that running it again is free and changes nothing, and the two asymmetries that matter: deleting
 * in the CRM removes from the PBX, and deleting on the PBX does not remove from the CRM.
 */
import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import { runContactSync } from '../../src/jobs/contact-sync.js';
import { FakePbx } from '../setup/fake-pbx.js';
import { TestContext, type TestUser } from '../setup/test-app.js';

interface Envelope<T> {
  data: T;
}

describe('contact sync (fake PBX)', () => {
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
    pbx.contacts.clear();
    pbx.phonebooks.length = 0;
    pbx.requests.length = 0;
    await ctx.app.settings.patch(
      { contactSync: { enabled: true, phonebookName: 'Flare CRM' } },
      null,
    );
  });

  afterAll(async () => {
    await ctx.close();
    await pbx.stop();
  });

  const addContact = async (firstName: string, number: string) =>
    (
      await ctx.as(admin, {
        method: 'POST',
        url: '/api/v1/contacts',
        payload: { firstName, lastName: 'Test', phones: [{ number }] },
      })
    ).json<Envelope<{ id: string }>>().data;

  const namesOnPbx = () => [...pbx.contacts.values()].map((c) => String(c.contact_name)).sort();

  it('does nothing at all until it is switched on', async () => {
    await ctx.app.settings.patch(
      { contactSync: { enabled: false, phonebookName: 'Flare CRM' } },
      null,
    );
    await addContact('Never', '0712000001');
    pbx.requests.length = 0;

    expect(await runContactSync(ctx.app)).toBeNull();
    expect(pbx.requests).toHaveLength(0);
  });

  it('creates the phonebook once, holding every contact so it cannot drift', async () => {
    await addContact('Jane', '0712000001');
    await runContactSync(ctx.app);

    expect(pbx.phonebooks).toEqual([{ id: 1, name: 'Flare CRM', member_select: 'sel_all' }]);

    await runContactSync(ctx.app);
    expect(pbx.phonebooks).toHaveLength(1);
  });

  it('copies a CRM contact onto the PBX, with its number in a slot', async () => {
    await addContact('Jane', '0712000001');

    const summary = await runContactSync(ctx.app);

    expect(summary).toMatchObject({ created: 1, failed: 0 });
    const row = [...pbx.contacts.values()][0];
    expect(row).toMatchObject({ contact_name: 'Jane Test', mobile: '+254712000001' });
  });

  it('brings a PBX contact into the CRM, and leaves it owned by nobody', async () => {
    pbx.contacts.set(90, {
      id: 90,
      contact_name: 'Wanjiru Kamau',
      mobile: '0722000002',
      email: 'wanjiru@example.com',
    });

    const summary = await runContactSync(ctx.app);

    expect(summary).toMatchObject({ imported: 1, failed: 0 });
    const contact = await ctx.app.db.contact.findFirst({
      where: { firstName: 'Wanjiru' },
      include: { phones: true, emails: true },
    });
    expect(contact).toMatchObject({ lastName: 'Kamau', source: 'yeastar', ownerId: null });
    expect(contact?.phones[0]?.e164).toBe('+254722000002');
    expect(contact?.emails[0]?.email).toBe('wanjiru@example.com');
  });

  it('ends with both sides holding the same people, whichever side they started on', async () => {
    await addContact('Jane', '0712000001');
    pbx.contacts.set(90, { id: 90, contact_name: 'Wanjiru Kamau', mobile: '0722000002' });

    await runContactSync(ctx.app);
    await runContactSync(ctx.app); // the import is pushed back in the second pass

    expect(namesOnPbx()).toEqual(['Jane Test', 'Wanjiru Kamau']);
    const crmNumbers = (
      await ctx.app.db.contactPhone.findMany({ where: { deletedAt: null }, select: { e164: true } })
    )
      .map((p) => p.e164)
      .sort();
    expect(crmNumbers).toEqual(['+254712000001', '+254722000002']);
  });

  /** A sync that rewrites everything every ten minutes is a sync nobody can leave switched on. */
  it('sends nothing on a second run when nothing has changed', async () => {
    await addContact('Jane', '0712000001');
    await runContactSync(ctx.app);

    pbx.requests.length = 0;
    const summary = await runContactSync(ctx.app);

    expect(summary).toMatchObject({ created: 0, updated: 0, imported: 0, removed: 0 });
    expect(pbx.requestsTo('/openapi/v1.0/company_contact/create')).toHaveLength(0);
    expect(pbx.requestsTo('/openapi/v1.0/company_contact/update')).toHaveLength(0);
  });

  it('sends an edit through, and only that one', async () => {
    const contact = await addContact('Jane', '0712000001');
    await addContact('Other', '0712000009');
    await runContactSync(ctx.app);
    pbx.requests.length = 0;

    await ctx.as(admin, {
      method: 'PATCH',
      url: `/api/v1/contacts/${contact.id}`,
      payload: { lastName: 'Married' },
    });
    const summary = await runContactSync(ctx.app);

    expect(summary).toMatchObject({ updated: 1, created: 0 });
    expect(namesOnPbx()).toEqual(['Jane Married', 'Other Test']);
  });

  it('adopts an entry somebody had already typed into the PBX, rather than duplicating them', async () => {
    pbx.contacts.set(90, { id: 90, contact_name: 'Jane Test', mobile: '+254712000001' });
    await addContact('Jane', '0712000001');

    const summary = await runContactSync(ctx.app);

    expect(summary).toMatchObject({ created: 0, imported: 0 });
    expect(pbx.contacts.size).toBe(1);
  });

  it('removes from the PBX what was deleted in the CRM', async () => {
    const contact = await addContact('Jane', '0712000001');
    await runContactSync(ctx.app);
    expect(pbx.contacts.size).toBe(1);

    await ctx.as(admin, { method: 'DELETE', url: `/api/v1/contacts/${contact.id}` });
    const summary = await runContactSync(ctx.app);

    expect(summary).toMatchObject({ removed: 1 });
    expect(pbx.contacts.size).toBe(0);
  });

  /** A handset must not be able to delete the business's own records. */
  it('puts a contact back when the PBX loses it, instead of deleting it in the CRM', async () => {
    const contact = await addContact('Jane', '0712000001');
    await runContactSync(ctx.app);
    pbx.contacts.clear();

    const summary = await runContactSync(ctx.app);

    expect(summary).toMatchObject({ created: 1 });
    expect(pbx.contacts.size).toBe(1);
    expect(await ctx.app.db.contact.count({ where: { id: contact.id, deletedAt: null } })).toBe(1);
  });

  /*
   * A phone system with the same number entered twice used to make the link jump between the two
   * rows on every run, for ever, counting an import and writing an audit row each time. The audit
   * log cannot be pruned, so a quiet no-op became permanent growth.
   */
  it('settles when the PBX holds the same number twice, instead of flip-flopping for ever', async () => {
    await addContact('Jane', '0712000001');
    await runContactSync(ctx.app);
    const linkedTo = await ctx.app.db.pbxContactLink.findFirstOrThrow();

    // Somebody adds the same number again on a handset.
    pbx.contacts.set(900, { id: 900, contact_name: 'Jane Again', mobile: '+254712000001' });

    const first = await runContactSync(ctx.app);
    expect(first).toMatchObject({ imported: 0, duplicatesOnPbx: 1 });

    const second = await runContactSync(ctx.app);
    expect(second).toMatchObject({ imported: 0, duplicatesOnPbx: 1 });

    // The link never moved, so nothing churns and no audit row is written for it.
    const after = await ctx.app.db.pbxContactLink.findFirstOrThrow();
    expect(after.pbxContactId).toBe(linkedTo.pbxContactId);
    expect(await ctx.app.db.contact.count({ where: { deletedAt: null } })).toBe(1);
    expect(await ctx.app.db.auditLog.count({ where: { action: 'contact.sync' } })).toBe(1);
  });

  it('leaves a contact with no phone number alone, since the PBX cannot hold one', async () => {
    await ctx.as(admin, {
      method: 'POST',
      url: '/api/v1/contacts',
      payload: { firstName: 'Emailonly', emails: [{ email: 'e@example.com' }] },
    });

    const summary = await runContactSync(ctx.app);

    expect(summary).toMatchObject({ created: 0, skippedNoNumber: 1 });
    expect(pbx.contacts.size).toBe(0);
  });

  it('keeps going when the PBX refuses one contact, and still syncs the rest', async () => {
    await addContact('Jane', '0712000001');
    await addContact('Mary', '0712000002');
    pbx.refuseContactNames.add('Mary');

    const summary = await runContactSync(ctx.app);

    expect(summary).toMatchObject({ created: 1, failed: 1 });
    expect(namesOnPbx()).toEqual(['Jane Test']);

    // And the one that failed is retried on the next run rather than being left behind.
    pbx.refuseContactNames.clear();
    const second = await runContactSync(ctx.app);
    expect(second).toMatchObject({ created: 1, failed: 0 });
    expect(namesOnPbx()).toEqual(['Jane Test', 'Mary Test']);
  });
});
