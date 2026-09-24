/**
 * The rules that decide who gets created, updated, deleted or imported.
 *
 * These are worth testing on their own because every one of them is a decision about somebody
 * else's data, and the expensive mistakes are silent: a second copy of every contact, a person
 * deleted from the CRM because a handset deleted them, or a write on every run for a contact that
 * has not changed.
 */
import { describe, expect, it } from 'vitest';
import {
  fingerprint,
  pbxFingerprint,
  planSync,
  rowE164s,
  splitName,
  toWrite,
  type ContactLink,
  type CrmContact,
} from '../../src/integrations/yeastar/contact-sync.js';
import type { CompanyContactRow } from '../../src/integrations/yeastar/client.js';

const KE = 'KE' as const;

function crm(over: Partial<CrmContact> = {}): CrmContact {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    firstName: 'Jane',
    lastName: 'Doe',
    jobTitle: null,
    companyName: null,
    email: null,
    numbers: ['+254700000001'],
    ...over,
  };
}

function pbxRow(over: Partial<CompanyContactRow> = {}): CompanyContactRow {
  return { id: 1, contact_name: 'Jane Doe', mobile: '+254700000001', ...over };
}

const empty = { crm: [], pbx: [], links: [], deletedContactIds: [], country: KE };

describe('mapping a CRM contact to the PBX', () => {
  it('fills the number slots in order, most useful first', () => {
    const write = toWrite(crm({ numbers: ['+254700000001', '+254700000002', '+254700000003'] }));
    expect(write.number_list).toEqual([
      { num_type: 'mobile_number', number: '+254700000001' },
      { num_type: 'business_number', number: '+254700000002' },
      { num_type: 'home_number', number: '+254700000003' },
    ]);
  });

  it('keeps the first seven numbers rather than failing on the eighth', () => {
    const numbers = Array.from({ length: 9 }, (_, i) => `+25470000000${String(i)}`);
    expect(toWrite(crm({ numbers })).number_list).toHaveLength(7);
  });

  it('always sends a first name, because the PBX refuses a contact without one', () => {
    expect(toWrite(crm({ firstName: '', lastName: 'Mwangi' })).first_name).toBe('Mwangi');
    expect(toWrite(crm({ firstName: '', lastName: null })).first_name).toBe('?');
  });

  it('leaves out what the customer has not filled in', () => {
    const write = toWrite(crm());
    expect(write).not.toHaveProperty('company');
    expect(write).not.toHaveProperty('email');
    expect(write).not.toHaveProperty('job_title');
  });

  it('names every field in an update, so a field cleared in the CRM is cleared on the PBX', () => {
    const write = toWrite(crm({ lastName: null }), 'update');
    expect(write).toMatchObject({ last_name: '', company: '', email: '', job_title: '' });
  });

  it('changes its fingerprint only when something the PBX holds changes', () => {
    const before = fingerprint(toWrite(crm()));
    // A tag or an owner is not a change the phone system can see.
    expect(fingerprint(toWrite(crm()))).toBe(before);
    expect(fingerprint(toWrite(crm({ email: 'jane@example.com' })))).not.toBe(before);
    expect(fingerprint(toWrite(crm({ numbers: ['+254700000009'] })))).not.toBe(before);
  });
});

describe('reading a contact off the PBX', () => {
  it('collects every number slot as E.164 and drops what cannot be read', () => {
    const row = pbxRow({ mobile: '0700000001', business: '020 000 0002', home: 'not a number' });
    expect(rowE164s(row, KE)).toEqual(['+254700000001', '+254200000002']);
  });

  it('splits one name field into a first and last name', () => {
    expect(splitName(pbxRow({ contact_name: 'Jane Wanjiru Doe' }))).toEqual({
      firstName: 'Jane',
      lastName: 'Wanjiru Doe',
    });
    expect(splitName(pbxRow({ contact_name: 'Cher' }))).toEqual({
      firstName: 'Cher',
      lastName: null,
    });
    expect(splitName(pbxRow({ contact_name: '' })).firstName).toBe('Unknown');
  });
});

describe('planning a sync', () => {
  it('creates a CRM contact the PBX has never seen', () => {
    const plan = planSync({ ...empty, crm: [crm()] });
    expect(plan.create).toHaveLength(1);
    expect(plan.importToCrm).toHaveLength(0);
  });

  it('imports a PBX contact the CRM has never seen', () => {
    const plan = planSync({ ...empty, pbx: [pbxRow({ id: 7, mobile: '+254711111111' })] });
    expect(plan.importToCrm.map((r) => r.id)).toEqual([7]);
    expect(plan.create).toHaveLength(0);
  });

  /** The first run against a PBX that was already in use. Getting this wrong doubles everybody. */
  it('adopts a PBX contact that already has the same number, rather than creating a second', () => {
    const plan = planSync({ ...empty, crm: [crm()], pbx: [pbxRow({ id: 5 })] });
    expect(plan.create).toHaveLength(0);
    expect(plan.importToCrm).toHaveLength(0);
    expect(plan.adopt).toEqual([
      expect.objectContaining({
        pbxContactId: 5,
        contact: expect.objectContaining({ id: crm().id }),
      }),
    ]);
  });

  it('updates an adopted contact whose details differ, instead of leaving the two apart', () => {
    const plan = planSync({
      ...empty,
      crm: [crm({ email: 'jane@example.com' })],
      pbx: [pbxRow({ id: 5 })],
    });
    expect(plan.adopt).toHaveLength(0);
    expect(plan.update).toEqual([expect.objectContaining({ pbxContactId: 5 })]);
  });

  it('sends nothing at all when both sides already agree', () => {
    const contact = crm();
    const link: ContactLink = {
      contactId: contact.id,
      pbxContactId: 5,
      fingerprint: fingerprint(toWrite(contact)),
      pbxFingerprint: pbxFingerprint(pbxRow({ id: 5 }), KE),
    };
    const plan = planSync({ ...empty, crm: [contact], pbx: [pbxRow({ id: 5 })], links: [link] });
    expect(plan).toMatchObject({
      create: [],
      update: [],
      pull: [],
      settle: [],
      remove: [],
      importToCrm: [],
    });
  });

  it('updates the PBX when the CRM contact has changed since it was last sent', () => {
    const contact = crm({ email: 'new@example.com' });
    const link: ContactLink = {
      contactId: contact.id,
      pbxContactId: 5,
      fingerprint: 'stale',
      pbxFingerprint: '',
    };
    const plan = planSync({ ...empty, crm: [contact], pbx: [pbxRow({ id: 5 })], links: [link] });
    expect(plan.update).toEqual([expect.objectContaining({ pbxContactId: 5 })]);
  });

  it('deletes from the PBX what the CRM deleted', () => {
    const link: ContactLink = {
      contactId: 'gone',
      pbxContactId: 5,
      fingerprint: 'x',
      pbxFingerprint: '',
    };
    const plan = planSync({
      ...empty,
      pbx: [pbxRow({ id: 5 })],
      links: [link],
      deletedContactIds: ['gone'],
    });
    expect(plan.remove).toEqual([{ contactId: 'gone', pbxContactId: 5 }]);
    // and does not then try to import the contact it is in the middle of removing
    expect(plan.importToCrm).toHaveLength(0);
  });

  /** A handset must not be able to delete the business's own records. */
  it('puts back a contact deleted on the PBX rather than deleting it in the CRM', () => {
    const contact = crm();
    const link: ContactLink = {
      contactId: contact.id,
      pbxContactId: 5,
      fingerprint: 'x',
      pbxFingerprint: '',
    };
    const plan = planSync({ ...empty, crm: [contact], pbx: [], links: [link] });
    expect(plan.create).toEqual([contact]);
  });

  it('skips a contact with no phone number, which the PBX cannot hold', () => {
    const plan = planSync({ ...empty, crm: [crm({ numbers: [] })] });
    expect(plan.create).toHaveLength(0);
    expect(plan.skippedNoNumber).toEqual([crm().id]);
  });

  it('ignores a PBX entry with no usable number rather than importing a blank person', () => {
    const plan = planSync({ ...empty, pbx: [pbxRow({ id: 9, mobile: 'n/a' })] });
    expect(plan.importToCrm).toHaveLength(0);
  });

  it('matches on the number however it was typed on the phone', () => {
    // The same person, entered nationally on the PBX and in E.164 in the CRM.
    const plan = planSync({
      ...empty,
      crm: [crm()],
      pbx: [pbxRow({ id: 5, mobile: '0700000001' })],
    });
    expect(plan.create).toHaveLength(0);
    expect(plan.importToCrm).toHaveLength(0);
  });

  it('does not give one PBX contact to two CRM contacts', () => {
    const a = crm({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', numbers: ['+254700000001'] });
    const b = crm({ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', numbers: ['+254700000001'] });
    const plan = planSync({ ...empty, crm: [a, b], pbx: [pbxRow({ id: 5 })] });
    const claimed = [...plan.adopt, ...plan.update].map((x) => x.pbxContactId);
    expect(claimed).toEqual([5]);
    expect(plan.create).toHaveLength(1);
  });
});

describe('telling which side changed', () => {
  const contact = crm();
  const row = pbxRow({ id: 5 });
  const agreed: ContactLink = {
    contactId: contact.id,
    pbxContactId: 5,
    fingerprint: fingerprint(toWrite(contact)),
    pbxFingerprint: pbxFingerprint(row, KE),
  };
  const run = (c: CrmContact, r: CompanyContactRow, link: ContactLink = agreed) =>
    planSync({ ...empty, crm: [c], pbx: [r], links: [link] });

  it('brings in an edit made on the PBX when the CRM has not changed', () => {
    const edited = pbxRow({ id: 5, contact_name: 'Jane Mwangi', company: 'Acme' });
    const plan = run(contact, edited);
    expect(plan.pull).toEqual([{ contact, row: edited }]);
    expect(plan.update).toHaveLength(0);
  });

  it('writes the CRM over the PBX when both changed, and says it was a conflict', () => {
    const edited = pbxRow({ id: 5, contact_name: 'Jane Mwangi' });
    const plan = run(crm({ lastName: 'Otieno' }), edited);
    expect(plan.pull).toHaveLength(0);
    expect(plan.update).toEqual([expect.objectContaining({ pbxContactId: 5, conflict: edited })]);
  });

  it('is not a conflict when both sides were changed to the same thing', () => {
    const plan = run(crm({ lastName: 'Mwangi' }), pbxRow({ id: 5, contact_name: 'Jane Mwangi' }));
    expect(plan.update).toEqual([expect.objectContaining({ conflict: null })]);
  });

  it('takes a link with no PBX fingerprint as agreed, rather than guessing an edit', () => {
    const edited = pbxRow({ id: 5, contact_name: 'Jane Mwangi' });
    const plan = run(contact, edited, { ...agreed, pbxFingerprint: '' });
    expect(plan.pull).toHaveLength(0);
    expect(plan.update).toHaveLength(0);
    expect(plan.settle).toEqual([
      expect.objectContaining({
        contactId: contact.id,
        pbxFingerprint: pbxFingerprint(edited, KE),
      }),
    ]);
  });

  it('compares the name the way the PBX stores it, as one string', () => {
    // Written as "Mary Ann" "Njeri" and read back as "Mary Ann Njeri", which splits differently.
    const mary = crm({ firstName: 'Mary Ann', lastName: 'Njeri' });
    const plan = planSync({
      ...empty,
      crm: [mary],
      pbx: [pbxRow({ id: 5, contact_name: 'Mary  Ann Njeri' })],
    });
    expect(plan.adopt).toHaveLength(1);
    expect(plan.update).toHaveLength(0);
  });

  it('ignores a number the PBX holds in local form when it is the same number', () => {
    const plan = run(contact, pbxRow({ id: 5, mobile: '0700000001' }));
    expect(plan.pull).toHaveLength(0);
    expect(plan.update).toHaveLength(0);
  });
});
