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
import { runCsvImport } from '../../src/jobs/csv-import.js';
import { QUEUES } from '../../src/jobs/queues.js';
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
      { contactSync: { enabled: true, phonebookName: 'Flare CRM', pollSeconds: 30 } },
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
      { contactSync: { enabled: false, phonebookName: 'Flare CRM', pollSeconds: 30 } },
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

  it('uses the all-contacts phonebook a PBX already has, rather than failing on a second', async () => {
    // What the live PBX had: its own all-contacts book, and one from Yeastar's CRM integration.
    pbx.phonebooks.push(
      { id: 3, name: 'All Company Contacts_Phonebook', member_select: 'sel_all' },
      { id: 4, name: 'CRM_Synchronization', member_select: 'sel_specific' },
    );
    await addContact('Jane', '0712000001');

    const summary = await runContactSync(ctx.app);

    expect(summary?.created).toBe(1);
    expect(pbx.phonebooks).toHaveLength(2);
    const audit = await ctx.app.db.auditLog.findFirst({
      where: { action: 'contact.sync' },
      orderBy: { createdAt: 'desc' },
    });
    expect((audit?.after as { phonebookId?: number } | null)?.phonebookId).toBe(3);
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
    expect(contact).toMatchObject({ lastName: 'Kamau', source: 'import', ownerId: null });
    expect(contact?.phones[0]?.e164).toBe('+254722000002');
    expect(contact?.emails[0]?.email).toBe('wanjiru@example.com');

    // Read back through the API, which checks every field against the contact schema: an imported
    // contact that could be stored but not read is what this used to produce.
    const res = await ctx.as(admin, {
      method: 'GET',
      url: `/api/v1/contacts/${contact?.id ?? ''}`,
    });
    expect(res.statusCode, res.body).toBe(200);
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

  const nudged = async () => {
    const queue = ctx.app.queues.get(QUEUES.contactSync);
    const pending = [...(await queue.getDelayed()), ...(await queue.getWaiting())];
    return pending.some((j) => j.id?.startsWith('contact-sync-nudge') === true);
  };
  const clearNudges = async () => {
    await ctx.app.queues.get(QUEUES.contactSync).obliterate({ force: true });
  };

  it('asks for a prompt sync when a contact is saved, so a caller reaches the phonebook soon', async () => {
    await addContact('Jane', '0712000001');
    expect(await nudged()).toBe(true);
  });

  it('asks for a prompt sync when a CSV import brings in contacts', async () => {
    const csv = 'First Name,Phone\nAmina,0712111111\n';
    const boundary = '----crmtest';
    const mapping = JSON.stringify({
      columns: { 'First Name': 'firstName', Phone: 'phone' },
      onDuplicate: 'skip',
    });
    const payload = [
      `--${boundary}\r\nContent-Disposition: form-data; name="entity"\r\n\r\ncontact\r\n`,
      `--${boundary}\r\nContent-Disposition: form-data; name="mapping"\r\n\r\n${mapping}\r\n`,
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="c.csv"\r\nContent-Type: text/csv\r\n\r\n${csv}\r\n`,
      `--${boundary}--\r\n`,
    ].join('');
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/imports',
      headers: {
        cookie: admin.cookie,
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload,
    });
    expect(res.statusCode, res.body).toBe(202);
    await clearNudges();

    await runCsvImport(ctx.app, res.json<Envelope<{ id: string }>>().data.id);

    expect(await ctx.app.db.contact.count({ where: { firstName: 'Amina' } })).toBe(1);
    expect(await nudged()).toBe(true);
  });

  it('asks for a prompt sync when a lead is converted into a contact', async () => {
    const lead = await ctx.as(admin, {
      method: 'POST',
      url: '/api/v1/leads',
      payload: { firstName: 'Lee', lastName: 'Der', phone: '0711000001', source: 'manual' },
    });
    expect(lead.statusCode, lead.body).toBe(201);
    await clearNudges();

    const conv = await ctx.as(admin, {
      method: 'POST',
      url: `/api/v1/leads/${lead.json<Envelope<{ id: string }>>().data.id}/convert`,
      payload: {},
    });
    expect(conv.statusCode, conv.body).toBe(200);
    expect(await nudged()).toBe(true);
  });

  describe('edits made on the PBX', () => {
    /** Synced once, so both sides agree and the link holds both fingerprints. */
    const synced = async () => {
      const contact = await addContact('Jane', '0712000001');
      await runContactSync(ctx.app);
      const link = await ctx.app.db.pbxContactLink.findUniqueOrThrow({
        where: { contactId: contact.id },
      });
      expect(link.pbxFingerprint).not.toBe('');
      return { contact, pbxId: link.pbxContactId };
    };
    const row = (id: number) => pbx.contacts.get(id) ?? {};
    const loaded = (id: string) =>
      ctx.app.db.contact.findUniqueOrThrow({
        where: { id },
        include: {
          company: true,
          phones: { where: { deletedAt: null }, orderBy: { isPrimary: 'desc' } },
          emails: { where: { deletedAt: null } },
        },
      });

    it('makes no writes at all on a poll when nothing has changed', async () => {
      await synced();
      await runContactSync(ctx.app);
      const linksBefore = await ctx.app.db.pbxContactLink.findMany();
      const auditBefore = await ctx.app.db.auditLog.count();
      const contactBefore = await ctx.app.db.contact.findFirstOrThrow();
      pbx.requests.length = 0;

      const summary = await runContactSync(ctx.app);

      // One read of the PBX side and nothing else: no PBX write, and no phonebook call either.
      expect(pbx.requests.map((r) => r.path)).toEqual(['/openapi/v1.0/company_contact/list']);
      expect(summary).toMatchObject({ created: 0, updated: 0, pulled: 0, imported: 0 });
      expect(await ctx.app.db.pbxContactLink.findMany()).toEqual(linksBefore);
      expect(await ctx.app.db.auditLog.count()).toBe(auditBefore);
      expect((await ctx.app.db.contact.findFirstOrThrow()).updatedAt).toEqual(
        contactBefore.updatedAt,
      );
    });

    it('brings a name, company, email and number changed on a handset into the CRM', async () => {
      const { contact, pbxId } = await synced();
      pbx.contacts.set(pbxId, {
        ...row(pbxId),
        contact_name: 'Jane Wanjiru Mwangi',
        company: 'Kamau Holdings',
        email: 'jane@kamau.example',
        mobile: '0733000003',
      });
      pbx.requests.length = 0;

      const summary = await runContactSync(ctx.app);

      expect(summary).toMatchObject({ pulled: 1, updated: 0, conflicts: 0 });
      const after = await loaded(contact.id);
      expect(after).toMatchObject({
        firstName: 'Jane',
        lastName: 'Wanjiru Mwangi',
        displayName: 'Jane Wanjiru Mwangi',
      });
      expect(after.company?.name).toBe('Kamau Holdings');
      expect(after.emails.map((e) => e.email)).toEqual(['jane@kamau.example']);
      expect(after.phones.map((p) => [p.e164, p.isPrimary])).toEqual([['+254733000003', true]]);
      // Nothing was sent back: the CRM took the PBX's version.
      expect(pbx.requestsTo('/openapi/v1.0/company_contact/update')).toHaveLength(0);
      expect(await ctx.app.db.auditLog.count({ where: { action: 'contact.sync.pull' } })).toBe(1);

      // And it has settled: the next poll finds nothing to do.
      expect(await runContactSync(ctx.app)).toMatchObject({ pulled: 0, updated: 0 });
    });

    it('keeps the CRM version when both sides changed, and audits the one it overwrote', async () => {
      const { contact, pbxId } = await synced();
      await ctx.as(admin, {
        method: 'PATCH',
        url: `/api/v1/contacts/${contact.id}`,
        payload: { lastName: 'Otieno' },
      });
      pbx.contacts.set(pbxId, { ...row(pbxId), contact_name: 'Jane Handset' });

      const summary = await runContactSync(ctx.app);

      expect(summary).toMatchObject({ updated: 1, pulled: 0, conflicts: 1 });
      expect(row(pbxId).contact_name).toBe('Jane Otieno');
      expect((await loaded(contact.id)).lastName).toBe('Otieno');
      const audit = await ctx.app.db.auditLog.findFirstOrThrow({
        where: { action: 'contact.sync.conflict', entityId: contact.id },
      });
      expect(audit.before).toMatchObject({ onPbx: { name: 'Jane Handset' } });
      expect(audit.after).toMatchObject({ kept: { name: 'Jane Otieno' } });
    });

    it('clears on the PBX a field that was cleared in the CRM', async () => {
      const res = await ctx.as(admin, {
        method: 'POST',
        url: '/api/v1/contacts',
        payload: {
          firstName: 'Jane',
          lastName: 'Test',
          phones: [{ number: '0712000001' }],
          emails: [{ email: 'jane@example.com' }],
        },
      });
      const contact = res.json<Envelope<{ id: string }>>().data;
      await runContactSync(ctx.app);
      const pbxId = [...pbx.contacts.keys()][0] ?? 0;
      expect(row(pbxId)).toMatchObject({ email: 'jane@example.com', contact_name: 'Jane Test' });

      await ctx.as(admin, {
        method: 'PATCH',
        url: `/api/v1/contacts/${contact.id}`,
        payload: { lastName: null },
      });
      await ctx.app.db.contactEmail.updateMany({
        where: { contactId: contact.id },
        data: { deletedAt: new Date(), isPrimary: false },
      });

      const summary = await runContactSync(ctx.app);

      expect(summary).toMatchObject({ updated: 1, pulled: 0 });
      expect(row(pbxId)).toMatchObject({ email: '', contact_name: 'Jane' });
      // What the PBX holds now is what was sent, so nothing is pulled back over the edit.
      expect(await runContactSync(ctx.app)).toMatchObject({ pulled: 0, updated: 0 });
      expect((await loaded(contact.id)).lastName).toBeNull();
    });

    it('carries a company from the CRM to the PBX and from the PBX to the CRM', async () => {
      const created = await ctx.as(admin, {
        method: 'POST',
        url: '/api/v1/companies',
        payload: { name: 'Acme' },
      });
      expect(created.statusCode, created.body).toBe(201);
      const company = created.json<Envelope<{ id: string }>>().data;
      const res = await ctx.as(admin, {
        method: 'POST',
        url: '/api/v1/contacts',
        payload: { firstName: 'Jane', companyId: company.id, phones: [{ number: '0712000001' }] },
      });
      expect(res.statusCode, res.body).toBe(201);
      // Typed on handsets: a company the CRM has under another case, and one it has never seen.
      pbx.contacts.set(90, {
        id: 90,
        contact_name: 'Ann Acme',
        company: 'ACME',
        mobile: '0722000002',
      });
      pbx.contacts.set(91, {
        id: 91,
        contact_name: 'Bob New',
        company: 'Newco',
        mobile: '0722000003',
      });

      const first = await runContactSync(ctx.app);
      expect(first).toMatchObject({ created: 1, imported: 2 });

      const jane = [...pbx.contacts.values()].find((r) => r.contact_name === 'Jane');
      expect(jane?.company).toBe('Acme');
      const ann = await ctx.app.db.contact.findFirstOrThrow({ where: { firstName: 'Ann' } });
      expect(ann.companyId).toBe(company.id);
      const bob = await ctx.app.db.contact.findFirstOrThrow({
        where: { firstName: 'Bob' },
        include: { company: true },
      });
      expect(bob.company?.name).toBe('Newco');
      expect(await ctx.app.db.company.count({ where: { deletedAt: null } })).toBe(2);

      // Ann's company is spelt the CRM's way on the PBX after the next run, then everything rests.
      await runContactSync(ctx.app);
      expect(row(90).company).toBe('Acme');
      expect(await runContactSync(ctx.app)).toMatchObject({ updated: 0, pulled: 0, imported: 0 });
    });

    it('does not take a number from the contact that already holds it', async () => {
      const { contact, pbxId } = await synced();
      const other = await addContact('Other', '0712000009');
      await runContactSync(ctx.app);
      pbx.contacts.set(pbxId, { ...row(pbxId), business: '0712000009' });

      await runContactSync(ctx.app);

      const holders = await ctx.app.db.contactPhone.findMany({
        where: { deletedAt: null, e164: '+254712000009' },
      });
      expect(holders.map((p) => p.contactId)).toEqual([other.id]);
      // The PBX is put back to what the CRM can hold, so the two sides still end up the same.
      await runContactSync(ctx.app);
      expect(row(pbxId).business).toBe('');
      expect((await loaded(contact.id)).phones.map((p) => p.e164)).toEqual(['+254712000001']);
    });
  });
});
