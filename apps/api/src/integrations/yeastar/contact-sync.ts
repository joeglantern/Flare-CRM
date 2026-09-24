/**
 * Keeping the CRM's contacts and the PBX's company contacts the same set of people (docs/06 §17).
 *
 * This reconciles rather than reacts. A contact changes through a dozen paths, including the CSV
 * import, a lead being converted, a merge and every phone and email endpoint, and a sync built out
 * of hooks on those paths is only correct until somebody adds the thirteenth. So each run reads
 * both sides, works out the difference and applies it, the way the CDR reconciliation does. A path
 * nobody remembered still converges on the next run, and a run that dies halfway simply resumes.
 * The PBX publishes no contact events at all, so on its side reading is the only option anyway.
 *
 * Which side wins. An edit made on the PBX to somebody both sides hold is brought into the CRM,
 * because a person corrected a name or a number on a handset and expects it to stick. Each link
 * keeps a fingerprint of both sides as they were at the last sync, so a run can tell which of them
 * moved. When both moved, the CRM wins, because it is the record of the business, and the conflict
 * is audited so the overwritten edit is not lost without a trace. A contact the PBX has and the CRM
 * does not is imported rather than deleted: somebody typed them into a phone, and deleting their
 * work is not a sync, it is data loss.
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
import {
  YeastarApiError,
  type CompanyContactRow,
  type CompanyContactWrite,
  type NumberSlot,
  type YeastarClient,
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
  /** The CRM side as of the last sync, so a CRM edit can be told apart from a PBX one. */
  fingerprint: string;
  /** The PBX row as last read. Empty until the first read after the link was made. */
  pbxFingerprint: string;
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

/** How many of a contact's numbers the PBX can hold, and so how many the sync is responsible for. */
export const PBX_NUMBER_SLOTS = SLOTS.length;

/** The PBX refuses a contact with no first name, so one is always found: theirs, or a placeholder. */
function firstNameFor(contact: CrmContact): string {
  if (contact.firstName.trim() !== '') return contact.firstName;
  const last = contact.lastName?.trim() ?? '';
  return last === '' ? '?' : last;
}

/**
 * The payload for a create or an update.
 *
 * An update names every field, empty ones included. The PBX documents none of them as required,
 * and a field left out of an update is one it has no reason to touch, so a company or an email
 * cleared in the CRM would otherwise stay on the phone system for good. A create has nothing to
 * clear and leaves them out.
 */
export function toWrite(
  contact: CrmContact,
  mode: 'create' | 'update' = 'create',
): CompanyContactWrite {
  const text = (key: 'last_name' | 'company' | 'email' | 'job_title', value: string | null) => {
    const v = value?.trim() ?? '';
    return v !== '' || mode === 'update' ? { [key]: v } : {};
  };
  return {
    // The PBX requires a first name. A contact recorded as one word, which a business name often
    // is, keeps that word here rather than being refused.
    first_name: firstNameFor(contact),
    ...text('last_name', contact.lastName),
    ...text('company', contact.companyName),
    ...text('email', contact.email),
    ...text('job_title', contact.jobTitle),
    // Driven by the slots rather than by the numbers, so an eighth number has nowhere to go and is
    // dropped, rather than being written to a slot that does not exist.
    number_list: SLOTS.flatMap((num_type, i) => {
      const number = contact.numbers[i];
      return number === undefined ? [] : [{ num_type, number }];
    }),
  };
}

/**
 * A stable summary of the CRM side as it was last synced, so an unchanged contact costs no request.
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

/** Runs of whitespace as one space, so a double space typed on a handset is not an edit. */
function oneLine(value: string | null | undefined): string {
  return (value ?? '').trim().replace(/\s+/g, ' ');
}

/**
 * What both sides can hold, in the form the PBX keeps it.
 *
 * The name is one string because that is how the PBX lists it: first and last are written apart
 * but read back joined. Comparing the joined form is what stops "Mary Ann" "Njeri" and "Mary"
 * "Ann Njeri" looking like an edit on every run. The job title is left out because the list does
 * not reliably return it, and a field one side cannot see cannot be compared.
 */
export interface SharedView {
  name: string;
  company: string;
  email: string;
  numbers: string[];
}

export function viewOfCrm(contact: CrmContact): SharedView {
  return {
    name: oneLine([firstNameFor(contact), contact.lastName ?? ''].join(' ')),
    company: oneLine(contact.companyName),
    email: oneLine(contact.email).toLowerCase(),
    numbers: contact.numbers.slice(0, PBX_NUMBER_SLOTS),
  };
}

export function viewOfRow(row: CompanyContactRow, country: CountryCode): SharedView {
  return {
    name: oneLine(row.contact_name),
    company: oneLine(row.company),
    email: oneLine(row.email).toLowerCase(),
    numbers: rowE164s(row, country),
  };
}

export function printView(view: SharedView): string {
  return JSON.stringify([view.name, view.company, view.email, view.numbers]);
}

/** The PBX side's fingerprint, stored per link so the next read can tell what changed there. */
export function pbxFingerprint(row: CompanyContactRow, country: CountryCode): string {
  return printView(viewOfRow(row, country));
}

/** Their name split the way the PBX gives it: one string, first word first. */
export function splitName(row: CompanyContactRow): { firstName: string; lastName: string | null } {
  const name = oneLine(row.contact_name);
  if (name === '') return { firstName: 'Unknown', lastName: null };
  const parts = name.split(' ');
  const first = parts.shift() ?? name;
  return { firstName: first, lastName: parts.length > 0 ? parts.join(' ') : null };
}

export interface SyncPlan {
  /** In the CRM, missing from the PBX. */
  create: CrmContact[];
  /**
   * On both, and the CRM changed since the last sync. `conflict` is the PBX row when the PBX
   * changed too, to something else: the CRM still wins, and the job audits what it overwrote.
   */
  update: { contact: CrmContact; pbxContactId: number; conflict: CompanyContactRow | null }[];
  /** On both, and only the PBX changed: its edit is brought into the CRM. */
  pull: { contact: CrmContact; row: CompanyContactRow }[];
  /** Nothing to send either way, but the fingerprints stored on the link are out of date. */
  settle: {
    contactId: string;
    pbxContactId: number;
    fingerprint: string;
    pbxFingerprint: string;
  }[];
  /** On both already and identical: the link is recorded, nothing is sent. */
  adopt: {
    contact: CrmContact;
    pbxContactId: number;
    fingerprint: string;
    pbxFingerprint: string;
  }[];
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
 * Pure on purpose. Every rule that decides whether somebody is created, updated, pulled, deleted
 * or imported is here, where a test can put both sides in and read the answer out, rather than
 * spread between a loop and an API client.
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
    pull: [],
    settle: [],
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
    const print = fingerprint(toWrite(contact));
    const link = linkByContact.get(contact.id);

    // The link still points at a contact the PBX has. Which side moved since the last sync decides
    // what happens, and the two fingerprints are what make that answerable.
    const linkedRow = link ? pbxById.get(link.pbxContactId) : undefined;
    if (link && linkedRow) {
      claimed.add(link.pbxContactId);
      const rowPrint = pbxFingerprint(linkedRow, input.country);
      const crmChanged = link.fingerprint !== print;
      // No stored PBX fingerprint means no baseline: the link predates them. What the PBX holds is
      // taken as agreed rather than guessed to be an edit, and recorded so the next one shows.
      const pbxChanged = link.pbxFingerprint !== '' && link.pbxFingerprint !== rowPrint;
      const agree = printView(viewOfCrm(contact)) === rowPrint;

      if (crmChanged) {
        plan.update.push({
          contact,
          pbxContactId: link.pbxContactId,
          conflict: pbxChanged && !agree ? linkedRow : null,
        });
      } else if (pbxChanged && !agree) {
        plan.pull.push({ contact, row: linkedRow });
      } else if (link.pbxFingerprint !== rowPrint) {
        plan.settle.push({
          contactId: contact.id,
          pbxContactId: link.pbxContactId,
          fingerprint: print,
          pbxFingerprint: rowPrint,
        });
      }
      continue;
    }

    // No link, but the PBX already has somebody with one of these numbers. Adopt them rather than
    // create a second copy: this is the path that runs on the very first sync of a PBX that was
    // already in use, and getting it wrong doubles every contact.
    const match = contact.numbers.map((n) => pbxByNumber.get(n)).find((m) => m !== undefined);
    if (match && !claimed.has(match.id)) {
      claimed.add(match.id);
      const rowPrint = pbxFingerprint(match, input.country);
      // The job title is compared only when the PBX said what it holds, for the reason it is not
      // part of the shared view.
      const titleAgrees =
        typeof match.job_title !== 'string' ||
        match.job_title.trim() === (contact.jobTitle?.trim() ?? '');
      if (printView(viewOfCrm(contact)) === rowPrint && titleAgrees)
        plan.adopt.push({
          contact,
          pbxContactId: match.id,
          fingerprint: print,
          pbxFingerprint: rowPrint,
        });
      else plan.update.push({ contact, pbxContactId: match.id, conflict: null });
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
  /** PBX edits brought into the CRM. */
  pulled: number;
  /** Both sides edited differently since the last sync; the CRM's version was written. */
  conflicts: number;
  adopted: number;
  removed: number;
  imported: number;
  /** On the PBX twice under the same number. Counted and left alone, never merged or deleted. */
  duplicatesOnPbx: number;
  skippedNoNumber: number;
  failed: number;
}

/** The PBX's code for a unique value that already exists. */
const DUPLICATE_KEY = 40003;

/**
 * Makes sure there is a phonebook holding every company contact, and says which one it is.
 *
 * "All company contacts" rather than a list of members, so membership cannot drift from the
 * contacts themselves: once the two sides hold the same people, the phonebook holds them too.
 *
 * The PBX allows only one such phonebook, and a PBX in use usually has one already ("All Company
 * Contacts_Phonebook" on a fresh P-Series). Asking for a second is refused as a duplicate, and that
 * refusal used to stop every run before a single contact was written. So a phonebook with the
 * configured name is used if there is one, then any phonebook that already holds everybody, and
 * only then is one created. It does the same job whatever it is called.
 */
export async function ensurePhonebook(
  client: Pick<YeastarClient, 'phonebookList' | 'phonebookCreate'>,
  name: string,
): Promise<number | null> {
  const pick = async () => {
    const books = (await client.phonebookList()).data ?? [];
    return books.find((p) => p.name === name) ?? books.find((p) => p.member_select === 'sel_all');
  };
  const found = await pick();
  if (found) return found.id;
  try {
    const created = await client.phonebookCreate({ name, member_select: 'sel_all' });
    return created.id ?? null;
  } catch (err) {
    // Somebody made one between the list and the create, or the list hid it: look once more.
    if (err instanceof YeastarApiError && err.errcode === DUPLICATE_KEY) {
      return (await pick())?.id ?? null;
    }
    throw err;
  }
}

/**
 * Every page of the PBX's contacts.
 *
 * The API takes pages of up to 10 000, so for any real phonebook this is a single request, which is
 * what makes reading the whole PBX side every half minute affordable.
 */
export async function fetchAllPbxContacts(
  client: Pick<YeastarClient, 'companyContactList'>,
  pageSize = 10_000,
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
