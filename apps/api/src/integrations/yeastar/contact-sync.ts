/**
 * Keeping the CRM's contacts and the PBX's company contacts the same set of people (docs/06 §17).
 *
 * This reconciles rather than reacts. A contact changes through a dozen paths, including the CSV
 * import, a lead being converted, a merge and every phone and email endpoint, and a sync built out
 * of hooks on those paths is only correct until somebody adds the thirteenth. So each run reads
 * both sides, works out the difference and applies it, the way the CDR reconciliation does. A path
 * nobody remembered still converges on the next run, and a run that dies halfway simply resumes.
 *
 * Which side wins. The CRM is the record of the business, so it wins on content. The exception is
 * a contact the PBX has and the CRM does not: that person is imported rather than deleted, because
 * somebody typed them into a phone and deleting their work is not a sync, it is data loss. After
 * the import they are an ordinary CRM contact and the CRM wins from then on.
 *
 * Deleting is deliberately asymmetric for the same reason. Deleting in the CRM deletes on the PBX,
 * because the CRM is where that decision is made. Deleting on the PBX does not delete in the CRM:
 * the contact is put back on the next run. A phone handset should not be able to destroy the
 * business's own records, and the alternative gives a misplaced tap on a desk phone that power.
 *
 * Matching is by phone number, never by name. Numbers are compared as E.164, and the CRM already
 * guarantees one live contact per number, so a number identifies at most one person on each side.
 * That is what stops a second run creating a second copy of everybody.
 */
import { toE164 } from '@crm/shared';
import type { CountryCode } from 'libphonenumber-js';
import type {
  CompanyContactRow,
  CompanyContactWrite,
  NumberSlot,
  YeastarClient,
} from './client.js';

/** The CRM side of one person, flattened to what the PBX can hold. */
export interface CrmContact {
  id: string;
  firstName: string;
  lastName: string | null;
  jobTitle: string | null;
  companyName: string | null;
  email: string | null;
  /** E.164, primary first. A contact with none of these cannot exist on the PBX. */
  numbers: string[];
}

export interface ContactLink {
  contactId: string;
  pbxContactId: number;
  fingerprint: string;
}

/**
 * Which slot each number goes in.
 *
 * The PBX has fixed slots rather than a list, so the order here decides what a fourth number does:
 * nothing. Seven slots is more than any real contact uses, and a contact with eight numbers keeps
 * its first seven rather than failing the whole sync.
 */
const SLOTS: NumberSlot[] = [
  'mobile_number',
  'business_number',
  'home_number',
  'mobile_number2',
  'business_number2',
  'home_number2',
  'other_number',
];

/** The PBX refuses a contact with no first name, so one is always found: theirs, or a placeholder. */
function firstNameFor(contact: CrmContact): string {
  if (contact.firstName.trim() !== '') return contact.firstName;
  const last = contact.lastName?.trim() ?? '';
  return last === '' ? '?' : last;
}

export function toWrite(contact: CrmContact): CompanyContactWrite {
  return {
    // The PBX requires a first name. A contact recorded as one word, which a business name often
    // is, keeps that word here rather than being refused.
    first_name: firstNameFor(contact),
    ...(contact.lastName ? { last_name: contact.lastName } : {}),
    ...(contact.companyName ? { company: contact.companyName } : {}),
    ...(contact.email ? { email: contact.email } : {}),
    ...(contact.jobTitle ? { job_title: contact.jobTitle } : {}),
    // Driven by the slots rather than by the numbers, so an eighth number has nowhere to go and is
    // dropped, rather than being written to a slot that does not exist.
    number_list: SLOTS.flatMap((num_type, i) => {
      const number = contact.numbers[i];
      return number === undefined ? [] : [{ num_type, number }];
    }),
  };
}

/**
 * A stable summary of what was last written, so an unchanged contact costs no request.
 *
 * Built from the payload rather than from the contact, so a field the PBX cannot hold, a tag or an
 * owner, does not count as a change and does not cause a write on every run.
 */
export function fingerprint(write: CompanyContactWrite): string {
  return JSON.stringify([
    write.first_name,
    write.last_name ?? '',
    write.company ?? '',
    write.email ?? '',
    write.job_title ?? '',
    write.number_list.map((n) => `${n.num_type}:${n.number}`),
  ]);
}

/** Every number a listed PBX contact holds, in slot order, as it came off the wire. */
export function rowNumbers(row: CompanyContactRow): string[] {
  return [row.mobile, row.business, row.home, row.mobile2, row.business2, row.home2, row.other]
    .map((n) => (typeof n === 'string' ? n.trim() : ''))
    .filter((n) => n !== '');
}

/** A PBX contact's numbers in E.164, for matching against the CRM. Unparseable ones are dropped. */
export function rowE164s(row: CompanyContactRow, country: CountryCode): string[] {
  return rowNumbers(row)
    .map((n) => toE164(n, country))
    .filter((n): n is string => n !== null);
}

/** Their name split the way the PBX gives it: one string, first word first. */
export function splitName(row: CompanyContactRow): { firstName: string; lastName: string | null } {
  const name = (row.contact_name ?? '').trim();
  if (name === '') return { firstName: 'Unknown', lastName: null };
  const parts = name.split(/\s+/);
  const first = parts.shift() ?? name;
  return { firstName: first, lastName: parts.length > 0 ? parts.join(' ') : null };
}

export interface SyncPlan {
  /** In the CRM, missing from the PBX. */
  create: CrmContact[];
  /** On both, but what the PBX holds is out of date. */
  update: { contact: CrmContact; pbxContactId: number }[];
  /** On both already and identical: the link is recorded, nothing is sent. */
  adopt: { contact: CrmContact; pbxContactId: number; fingerprint: string }[];
  /** Deleted in the CRM, still on the PBX. */
  remove: { contactId: string; pbxContactId: number }[];
  /** On the PBX, unknown to the CRM. */
  importToCrm: CompanyContactRow[];
  /** In the CRM with no phone number at all, so the PBX cannot hold them. */
  skippedNoNumber: string[];
}

/**
 * The difference between the two sides, as a list of things to do.
 *
 * Pure on purpose. Every rule that decides whether somebody is created, updated, deleted or
 * imported is here, where a test can put both sides in and read the answer out, rather than spread
 * between a loop and an API client.
 */
export function planSync(input: {
  crm: CrmContact[];
  pbx: CompanyContactRow[];
  links: ContactLink[];
  /** Ids of contacts the CRM has deleted since they were last synced. */
  deletedContactIds: string[];
  country: CountryCode;
}): SyncPlan {
  const plan: SyncPlan = {
    create: [],
    update: [],
    adopt: [],
    remove: [],
    importToCrm: [],
    skippedNoNumber: [],
  };

  const linkByContact = new Map(input.links.map((l) => [l.contactId, l]));
  const pbxById = new Map(input.pbx.map((row) => [row.id, row]));
  /** Number to PBX contact, for adopting an entry somebody typed in by hand. */
  const pbxByNumber = new Map<string, CompanyContactRow>();
  for (const row of input.pbx) {
    for (const e164 of rowE164s(row, input.country)) {
      if (!pbxByNumber.has(e164)) pbxByNumber.set(e164, row);
    }
  }

  const claimed = new Set<number>();

  for (const contact of input.crm) {
    if (contact.numbers.length === 0) {
      plan.skippedNoNumber.push(contact.id);
      continue;
    }
    const write = toWrite(contact);
    const print = fingerprint(write);
    const link = linkByContact.get(contact.id);

    // The link still points at a contact the PBX has: update it if anything it can hold changed.
    if (link && pbxById.has(link.pbxContactId)) {
      claimed.add(link.pbxContactId);
      if (link.fingerprint !== print)
        plan.update.push({ contact, pbxContactId: link.pbxContactId });
      continue;
    }

    // No link, but the PBX already has somebody with one of these numbers. Adopt them rather than
    // create a second copy: this is the path that runs on the very first sync of a PBX that was
    // already in use, and getting it wrong doubles every contact.
    const match = contact.numbers.map((n) => pbxByNumber.get(n)).find((m) => m !== undefined);
    if (match && !claimed.has(match.id)) {
      claimed.add(match.id);
      const current = fingerprint(
        toWrite({
          ...splitName(match),
          id: contact.id,
          jobTitle: typeof match.job_title === 'string' ? match.job_title : null,
          companyName: match.company ?? null,
          email: match.email ?? null,
          numbers: rowE164s(match, input.country),
        }),
      );
      if (current === print)
        plan.adopt.push({ contact, pbxContactId: match.id, fingerprint: print });
      else plan.update.push({ contact, pbxContactId: match.id });
      continue;
    }

    // A link whose PBX contact is gone lands here too: somebody deleted them on the phone system,
    // so they are created again. The CRM is the record.
    plan.create.push(contact);
  }

  // Deleted in the CRM: take them off the PBX and forget the link.
  for (const contactId of input.deletedContactIds) {
    const link = linkByContact.get(contactId);
    if (link && pbxById.has(link.pbxContactId)) {
      claimed.add(link.pbxContactId);
      plan.remove.push({ contactId, pbxContactId: link.pbxContactId });
    }
  }

  // Whatever is left on the PBX is somebody the CRM has never heard of.
  for (const row of input.pbx) {
    if (claimed.has(row.id)) continue;
    if (rowE164s(row, input.country).length === 0) continue; // nothing to match or dial
    plan.importToCrm.push(row);
  }

  return plan;
}

export interface SyncSummary {
  created: number;
  updated: number;
  adopted: number;
  removed: number;
  imported: number;
  skippedNoNumber: number;
  failed: number;
}

/**
 * Makes sure the phonebook exists, and says which one it is.
 *
 * It is created with "all company contacts" rather than a list of members, so membership cannot
 * drift from the contacts themselves. Once the two sides hold the same people, the phonebook holds
 * them too, by construction rather than by bookkeeping.
 */
export async function ensurePhonebook(
  client: Pick<YeastarClient, 'phonebookList' | 'phonebookCreate'>,
  name: string,
): Promise<number | null> {
  const existing = await client.phonebookList();
  const found = (existing.data ?? []).find((p) => p.name === name);
  if (found) return found.id;
  const created = await client.phonebookCreate({ name, member_select: 'sel_all' });
  return created.id ?? null;
}

/** Every page of the PBX's contacts. */
export async function fetchAllPbxContacts(
  client: Pick<YeastarClient, 'companyContactList'>,
  pageSize = 1000,
): Promise<CompanyContactRow[]> {
  const all: CompanyContactRow[] = [];
  for (let page = 1; page <= 50; page++) {
    const res = await client.companyContactList({ page, page_size: pageSize });
    const rows = res.data ?? [];
    all.push(...rows);
    if (rows.length < pageSize) break;
  }
  return all;
}
