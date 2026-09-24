/**
 * Contact sync job (docs/06 §17): makes the PBX's company contacts the same set of people as the
 * CRM's contacts, in both directions, and keeps them that way.
 *
 * The rules live in `integrations/yeastar/contact-sync.ts`, where they can be read and tested
 * without a PBX. This is the part that talks to both sides: it loads them, asks for a plan, and
 * applies it one contact at a time.
 *
 * Applied one at a time on purpose. The API has no bulk form for any of these, and a run that dies
 * on the ninetieth contact should leave the first eighty-nine synced and recorded rather than
 * rolling back work the PBX has already done. Every step is idempotent, so the next run continues
 * rather than repeats.
 *
 * How quickly each side follows the other. A CRM write nudges a run within seconds. The PBX
 * publishes no contact events, so its side is read on a short poll (`contactSync.pollSeconds`,
 * default 30 s): one list request, compared against the fingerprint stored per link, and nothing
 * written when nothing changed. The ten-minute run stays as the backstop and also checks the
 * phonebook, which a poll does not need to.
 */
import type { FastifyInstance } from 'fastify';
import type { CountryCode } from 'libphonenumber-js';
import type { Prisma } from '../generated/prisma/client.js';
import type { CompanyContactRow } from '../integrations/yeastar/client.js';
import {
  PBX_NUMBER_SLOTS,
  ensurePhonebook,
  fetchAllPbxContacts,
  fingerprint,
  pbxFingerprint,
  planSync,
  printView,
  rowE164s,
  splitName,
  toWrite,
  viewOfCrm,
  viewOfRow,
  type ContactLink,
  type CrmContact,
  type SyncSummary,
} from '../integrations/yeastar/contact-sync.js';
import { newId } from '../lib/ids.js';
import type { Db } from '../plugins/prisma.js';
import { displayNameOf } from '../modules/contacts/contacts.mappers.js';
import { SYSTEM_AUDIT } from '../modules/entitlements/entitlements.service.js';
import { QUEUES } from './queues.js';

/**
 * How many writes one run will make.
 *
 * The first sync of an established CRM is thousands of contacts and the PBX is a phone system, not
 * a database, so the work is spread over several runs rather than delivered as a thundering herd.
 * Whatever is left is simply the difference the next run finds.
 */
const MAX_WRITES_PER_RUN = 300;

/** The scheduler that reads the PBX side between the ten-minute runs. */
export const POLL_SCHEDULER = 'contact-sync-poll';

/**
 * The phonebook needs checking far less often than the contacts: it is made once and then holds
 * everybody by construction. Once per this many seconds, whichever run comes first, rather than a
 * second request on every poll.
 */
const PHONEBOOK_CHECK_SECONDS = 600;
const PHONEBOOK_CHECK_KEY = 'contact-sync:phonebook-checked';

/**
 * Asks for a sync soon rather than at the next tick.
 *
 * The sync is a reconciliation and needs no hint to be correct; this only shortens how long a
 * contact saved from a call popup takes to reach the phone system's phonebook. The job id names a
 * three-second window, so a burst of edits folds into one run. It is not one fixed id because
 * BullMQ drops an add whose id is still in the queue, and that includes a run in progress: an edit
 * made while a sync was running used to wait for the next scheduled one.
 */
export async function nudgeContactSync(app: FastifyInstance): Promise<void> {
  try {
    await app.queues.add(
      QUEUES.contactSync,
      'nudge',
      {},
      {
        jobId: `contact-sync-nudge-${String(Math.floor(Date.now() / 3_000))}`,
        delay: 3_000,
        removeOnComplete: true,
        removeOnFail: true,
      },
    );
  } catch (err) {
    app.log.warn({ err }, 'could not nudge the contact sync');
  }
}

/**
 * Puts the PBX poll on the interval the settings ask for, or takes it off when the sync is off.
 * Called at startup and whenever the contact sync settings change, so a new interval applies at
 * once rather than after a restart.
 */
export async function schedulePoll(app: FastifyInstance): Promise<void> {
  const queue = app.queues.get(QUEUES.contactSync);
  const { enabled, pollSeconds } = await app.settings.get('contactSync');
  if (!enabled) {
    await queue.removeJobScheduler(POLL_SCHEDULER);
    return;
  }
  await queue.upsertJobScheduler(
    POLL_SCHEDULER,
    { every: pollSeconds * 1000 },
    { name: 'poll', data: {}, opts: { removeOnComplete: true, removeOnFail: 100 } },
  );
}

const CONTACT_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  jobTitle: true,
  company: { select: { name: true } },
  emails: {
    where: { deletedAt: null },
    orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
    select: { id: true, email: true, isPrimary: true },
  },
  phones: {
    where: { deletedAt: null },
    orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
    select: { id: true, e164: true, isPrimary: true },
  },
} satisfies Prisma.ContactSelect;

interface LoadedContact {
  id: string;
  firstName: string;
  lastName: string | null;
  jobTitle: string | null;
  company: { name: string } | null;
  emails: { id: string; email: string; isPrimary: boolean }[];
  phones: { id: string; e164: string; isPrimary: boolean }[];
}

function toCrm(r: LoadedContact): CrmContact {
  return {
    id: r.id,
    firstName: r.firstName,
    lastName: r.lastName,
    jobTitle: r.jobTitle,
    companyName: r.company?.name ?? null,
    email: r.emails[0]?.email ?? null,
    numbers: r.phones.map((p) => p.e164),
  };
}

export async function runContactSync(app: FastifyInstance): Promise<SyncSummary | null> {
  const summary: SyncSummary = {
    created: 0,
    updated: 0,
    pulled: 0,
    conflicts: 0,
    adopted: 0,
    removed: 0,
    imported: 0,
    duplicatesOnPbx: 0,
    skippedNoNumber: 0,
    failed: 0,
  };

  const client = app.cti.client;
  if (!client) return null;
  const settings = await app.settings.getAll();
  if (!settings.contactSync.enabled) return null;
  if (!(await app.entitlements.has('telephony'))) return null;

  const country = settings.defaultCountry as CountryCode;

  // The phonebook is made to exist before anything is written into it, so the contacts a run
  // creates are reachable from a handset in the same run rather than the one after.
  //
  // A phonebook the PBX will not give us is no reason to leave the contacts unsynced: the caller's
  // name on an incoming call comes from the company contacts, not from the phonebook.
  let phonebookId: number | null = null;
  const checkPhonebook =
    (await app.valkey.set(PHONEBOOK_CHECK_KEY, '1', 'EX', PHONEBOOK_CHECK_SECONDS, 'NX')) === 'OK';
  if (checkPhonebook) {
    try {
      phonebookId = await ensurePhonebook(client, settings.contactSync.phonebookName);
    } catch (err) {
      await app.valkey.del(PHONEBOOK_CHECK_KEY); // try again on the next run, not in ten minutes
      app.log.warn({ err }, 'could not find or create the phonebook; syncing the contacts anyway');
    }
  }

  const [rows, links, pbx] = await Promise.all([
    app.db.contact.findMany({ where: { deletedAt: null }, select: CONTACT_SELECT }),
    app.db.pbxContactLink.findMany(),
    fetchAllPbxContacts(client),
  ]);

  const crm = rows.map(toCrm);

  // A link whose contact is no longer in the live set is somebody the CRM deleted. Their link row
  // is the only remaining trace of what to remove from the PBX.
  const live = new Set(crm.map((c) => c.id));
  const deletedContactIds = links.map((l) => l.contactId).filter((id) => !live.has(id));

  const plan = planSync({
    crm,
    pbx,
    links: links.map((l): ContactLink => ({
      contactId: l.contactId,
      pbxContactId: l.pbxContactId,
      fingerprint: l.fingerprint,
      pbxFingerprint: l.pbxFingerprint,
    })),
    deletedContactIds,
    country,
  });
  summary.skippedNoNumber = plan.skippedNoNumber.length;

  let writes = 0;
  const budgetLeft = () => writes < MAX_WRITES_PER_RUN;
  /** PBX rows written this run, with what the CRM meant them to hold, for the read-back. */
  const written = new Map<number, { contact: CrmContact }>();
  /** Set when a pull or an import left the CRM holding something the PBX does not. */
  let pushPending = false;

  // Only the stored fingerprints are behind; nothing is sent to either side.
  for (const s of plan.settle) {
    await linkContact(app, s.contactId, s.pbxContactId, s.fingerprint, s.pbxFingerprint);
  }

  // Adoptions cost no request: the PBX already holds exactly this, so only the link is recorded.
  for (const a of plan.adopt) {
    await linkContact(app, a.contact.id, a.pbxContactId, a.fingerprint, a.pbxFingerprint);
    summary.adopted++;
  }

  for (const contact of plan.create) {
    if (!budgetLeft()) break;
    const write = toWrite(contact, 'create');
    try {
      const created = await client.companyContactCreate(write);
      await linkContact(app, contact.id, created.id, fingerprint(write), '');
      written.set(created.id, { contact });
      summary.created++;
    } catch (err) {
      app.log.warn({ err, contactId: contact.id }, 'could not create a contact on the PBX');
      summary.failed++;
    }
    writes++;
  }

  for (const { contact, pbxContactId, conflict } of plan.update) {
    if (!budgetLeft()) break;
    try {
      await client.companyContactUpdate({ ...toWrite(contact, 'update'), id: pbxContactId });
      await linkContact(app, contact.id, pbxContactId, fingerprint(toWrite(contact)), '');
      written.set(pbxContactId, { contact });
      summary.updated++;
      if (conflict) {
        // Both sides were edited since the last sync. The CRM's version is now on the PBX; what it
        // replaced is kept here, since the PBX keeps no history of its own.
        summary.conflicts++;
        await app.audit.write(SYSTEM_AUDIT, {
          action: 'contact.sync.conflict',
          entity: 'contact',
          entityId: contact.id,
          before: { pbxContactId, onPbx: viewOfRow(conflict, country) },
          after: { pbxContactId, kept: viewOfCrm(contact) },
        });
      }
    } catch (err) {
      app.log.warn({ err, contactId: contact.id }, 'could not update a contact on the PBX');
      summary.failed++;
    }
    writes++;
  }

  for (const { contact, row } of plan.pull) {
    if (!budgetLeft()) break;
    try {
      const after = await pullIntoCrm(app, contact.id, row, country);
      if (after) {
        const rowPrint = pbxFingerprint(row, country);
        // What the CRM could not take, a number another contact already holds for instance, is
        // left for the next run to write back, so the two sides still end up the same.
        const agrees = printView(viewOfCrm(after)) === rowPrint;
        if (!agrees) pushPending = true;
        await linkContact(
          app,
          contact.id,
          row.id,
          agrees ? fingerprint(toWrite(after)) : '',
          rowPrint,
        );
        summary.pulled++;
      }
    } catch (err) {
      app.log.warn({ err, contactId: contact.id }, 'could not bring a PBX edit into the CRM');
      summary.failed++;
    }
    writes++;
  }

  for (const { contactId, pbxContactId } of plan.remove) {
    if (!budgetLeft()) break;
    try {
      await client.companyContactDelete(pbxContactId);
      await app.db.pbxContactLink.deleteMany({ where: { contactId } });
      summary.removed++;
    } catch (err) {
      app.log.warn({ err, pbxContactId }, 'could not delete a contact from the PBX');
      summary.failed++;
    }
    writes++;
  }

  for (const row of plan.importToCrm) {
    if (!budgetLeft()) break;
    try {
      const outcome = await importContact(app, row, country);
      if (outcome === 'imported' || outcome === 'imported-partly') summary.imported++;
      else if (outcome === 'linked') summary.adopted++;
      else summary.duplicatesOnPbx++;
      if (outcome === 'imported-partly' || outcome === 'linked') pushPending = true;
      // A duplicate is looked at on every poll and changes nothing, so it spends no budget.
      if (outcome !== 'duplicate') writes++;
    } catch (err) {
      app.log.warn({ err, pbxContactId: row.id }, 'could not import a contact from the PBX');
      summary.failed++;
      writes++;
    }
  }

  if (written.size > 0) await readBack(app, client, written, country);

  if (pushPending) await nudgeContactSync(app);

  if (summary.created + summary.removed + summary.imported + summary.pulled > 0) {
    await app.audit.write(SYSTEM_AUDIT, {
      action: 'contact.sync',
      entity: 'contact',
      after: { ...summary, phonebookId },
    });
  }

  // A poll every half minute that found nothing is not worth a log line each time.
  const changed = writes + summary.adopted + plan.settle.length > 0;
  app.log[changed ? 'info' : 'debug']({ ...summary, phonebookId }, 'contact sync complete');
  return summary;
}

/**
 * Reads the PBX once more after writing to it, and records what it actually holds.
 *
 * The API does not document whether an update leaves an omitted or empty field alone, or whether
 * `number_list` replaces the numbers or adds to them. Storing what was sent as the PBX's
 * fingerprint would be a guess, and a wrong guess reads as an edit made on the PBX, which the next
 * poll would then pull back into the CRM over the edit that was just made there. What the PBX holds
 * is not a guess. One request, whatever was written.
 */
async function readBack(
  app: FastifyInstance,
  client: NonNullable<FastifyInstance['cti']['client']>,
  written: Map<number, { contact: CrmContact }>,
  country: CountryCode,
): Promise<void> {
  let rows: CompanyContactRow[];
  try {
    rows = await fetchAllPbxContacts(client);
  } catch (err) {
    // The links keep an empty PBX fingerprint, which the next run records as its baseline.
    app.log.warn({ err }, 'could not read the PBX back after writing to it');
    return;
  }
  for (const row of rows) {
    const w = written.get(row.id);
    if (!w) continue;
    const rowPrint = pbxFingerprint(row, country);
    if (rowPrint !== printView(viewOfCrm(w.contact))) {
      app.log.warn(
        { contactId: w.contact.id, pbxContactId: row.id },
        'the PBX did not keep everything it was sent',
      );
    }
    await app.db.pbxContactLink.updateMany({
      where: { contactId: w.contact.id, pbxContactId: row.id },
      data: { pbxFingerprint: rowPrint },
    });
  }
}

async function linkContact(
  app: FastifyInstance,
  contactId: string,
  pbxContactId: number,
  print: string,
  pbxPrint: string,
): Promise<void> {
  const data = { pbxContactId, fingerprint: print, pbxFingerprint: pbxPrint, syncedAt: new Date() };
  await app.db.pbxContactLink.upsert({
    where: { contactId },
    create: { contactId, ...data },
    update: data,
  });
}

/**
 * A company by name, the one the CRM already has if it has one. Case does not make a different
 * company: "Acme ltd" typed on a handset is the Acme the CRM knows.
 */
async function companyNamed(
  tx: Pick<Db, 'company'>,
  name: string,
): Promise<{ id: string; name: string }> {
  const found = await tx.company.findFirst({
    where: { name: { equals: name, mode: 'insensitive' }, deletedAt: null },
    select: { id: true, name: true },
  });
  if (found) return found;
  const id = newId();
  await tx.company.create({ data: { id, name } });
  return { id, name };
}

/**
 * An edit made on the PBX, brought into the CRM: name, company, email and numbers.
 *
 * Only what the PBX can hold is touched. A contact's eighth number, which the PBX never had, is not
 * removed because the PBX does not list it, and a number or an email that already belongs to
 * another contact is not taken from them. Answers the contact as it now stands, or null when it
 * has gone in the meantime.
 */
async function pullIntoCrm(
  app: FastifyInstance,
  contactId: string,
  row: CompanyContactRow,
  country: CountryCode,
): Promise<CrmContact | null> {
  const target = viewOfRow(row, country);
  const now = new Date();

  const result = await app.db.$transaction(async (tx) => {
    const current = await tx.contact.findFirst({
      where: { id: contactId, deletedAt: null },
      select: CONTACT_SELECT,
    });
    if (!current) return null;
    const before = viewOfCrm(toCrm(current));

    // Name and company.
    const update: { firstName?: string; lastName?: string | null; displayName?: string } & {
      companyId?: string | null;
    } = {};
    if (target.name !== '' && target.name !== before.name) {
      const { firstName, lastName } = splitName(row);
      Object.assign(update, {
        firstName,
        lastName,
        displayName: displayNameOf(firstName, lastName),
      });
    }
    if (target.company.toLowerCase() !== before.company.toLowerCase()) {
      update.companyId = target.company === '' ? null : (await companyNamed(tx, target.company)).id;
    }
    if (Object.keys(update).length > 0) {
      await tx.contact.update({ where: { id: contactId }, data: update });
    }

    // Email: the PBX holds one, which is the CRM's primary.
    if (target.email !== before.email) {
      const primary = current.emails.find((e) => e.isPrimary) ?? null;
      if (target.email === '') {
        if (primary) {
          await tx.contactEmail.update({
            where: { id: primary.id },
            data: { deletedAt: now, isPrimary: false },
          });
          const next = current.emails.find((e) => e.id !== primary.id);
          if (next)
            await tx.contactEmail.update({ where: { id: next.id }, data: { isPrimary: true } });
        }
      } else {
        const holder = await tx.contactEmail.findFirst({
          where: { email: target.email, deletedAt: null },
          select: { id: true, contactId: true },
        });
        if (holder && holder.contactId !== contactId) {
          app.log.warn({ contactId }, 'the email set on the PBX belongs to another contact');
        } else if (holder) {
          if (primary)
            await tx.contactEmail.update({ where: { id: primary.id }, data: { isPrimary: false } });
          await tx.contactEmail.update({ where: { id: holder.id }, data: { isPrimary: true } });
        } else if (primary) {
          await tx.contactEmail.update({
            where: { id: primary.id },
            data: { email: target.email },
          });
        } else {
          await tx.contactEmail.create({
            data: { id: newId(), contactId, email: target.email, isPrimary: true },
          });
        }
      }
    }

    // Numbers. A PBX entry with none left is not taken as "this person has no phone": the PBX
    // cannot hold such a contact, so it is more likely a half-finished edit, and it is written back.
    if (target.numbers.length > 0 && target.numbers.join() !== before.numbers.join()) {
      const onPbxSlots = current.phones.slice(0, PBX_NUMBER_SLOTS);
      for (const phone of onPbxSlots) {
        if (!target.numbers.includes(phone.e164)) {
          await tx.contactPhone.update({
            where: { id: phone.id },
            data: { deletedAt: now, isPrimary: false },
          });
        }
      }
      for (const e164 of target.numbers) {
        if (current.phones.some((p) => p.e164 === e164)) continue;
        const holder = await tx.contactPhone.findFirst({
          where: { e164, deletedAt: null },
          select: { contactId: true },
        });
        if (holder) {
          app.log.warn({ contactId }, 'a number set on the PBX belongs to another contact');
          continue;
        }
        await tx.contactPhone.create({
          data: { id: newId(), contactId, e164, raw: e164, type: 'other', isPrimary: false },
        });
      }
      // The first slot is the primary on the PBX, so it is the primary here too.
      const livePhones = await tx.contactPhone.findMany({
        where: { contactId, deletedAt: null },
        orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
        select: { id: true, e164: true, isPrimary: true },
      });
      const wanted =
        livePhones.find((p) => p.e164 === target.numbers[0]) ??
        livePhones.find((p) => p.isPrimary) ??
        livePhones[0];
      if (wanted && !wanted.isPrimary) {
        await tx.contactPhone.updateMany({
          where: { contactId, deletedAt: null, isPrimary: true },
          data: { isPrimary: false },
        });
        await tx.contactPhone.update({ where: { id: wanted.id }, data: { isPrimary: true } });
      }
    }

    const after = await tx.contact.findFirstOrThrow({
      where: { id: contactId },
      select: CONTACT_SELECT,
    });
    const crmAfter = toCrm(after);
    await app.audit.writeWith(tx, SYSTEM_AUDIT, {
      action: 'contact.sync.pull',
      entity: 'contact',
      entityId: contactId,
      before,
      after: viewOfCrm(crmAfter),
    });
    return crmAfter;
  });

  if (result) {
    app.events.emit('entity.changed', {
      type: 'contact',
      id: contactId,
      updatedAt: now.toISOString(),
      byUserId: null,
    });
  }
  return result;
}

/**
 * A person the PBX knows and the CRM does not, brought in.
 *
 * Answers what it did, because three of the outcomes are not a clean import. A number the CRM
 * already holds means this row is the same person, and if that person is already linked to a
 * different row then the PBX simply has them twice: that is left exactly as it is. Moving the link
 * to the second row would move it back to the first on the next run, forever, and each pass would
 * write an audit row that nothing can ever prune. 'imported-partly' is an import that could not
 * take everything, an email another contact holds, so the CRM's version is written back.
 *
 * Unowned on purpose: the sync cannot know whose contact this is, and guessing would hand somebody
 * else's customer to whoever happens to run the job. Unowned contacts are visible to every agent,
 * so nobody loses sight of them while an admin decides.
 *
 * `source` records where they came from, so a later "who typed this in" question has an answer.
 */
async function importContact(
  app: FastifyInstance,
  row: CompanyContactRow,
  country: CountryCode,
): Promise<'imported' | 'imported-partly' | 'linked' | 'duplicate'> {
  const numbers = rowE164s(row, country);
  const first = numbers[0];
  if (first === undefined) return 'duplicate';
  const { firstName, lastName } = splitName(row);
  const view = viewOfRow(row, country);
  const jobTitle =
    typeof row.job_title === 'string' && row.job_title.trim() !== '' ? row.job_title.trim() : null;
  const contactId = newId();

  return app.db.$transaction(async (tx) => {
    // Another run, or a person, may have created this number in the meantime. The partial unique
    // index on a live number would refuse the insert; checking first turns that into a no-op.
    const clash = await tx.contactPhone.findFirst({
      where: { e164: { in: numbers }, deletedAt: null },
      select: { contactId: true },
    });
    if (clash) {
      const existing = await tx.pbxContactLink.findUnique({
        where: { contactId: clash.contactId },
        select: { pbxContactId: true },
      });
      if (existing) {
        if (existing.pbxContactId === row.id) return 'linked';
        app.log.debug(
          { pbxContactId: row.id, alreadyLinkedTo: existing.pbxContactId },
          'the PBX holds this number twice; leaving the second entry alone',
        );
        return 'duplicate';
      }
      // An existing CRM contact: the CRM's version is the record, so an empty fingerprint makes
      // the next run write it over the PBX entry.
      await tx.pbxContactLink.create({
        data: {
          contactId: clash.contactId,
          pbxContactId: row.id,
          fingerprint: '',
          pbxFingerprint: '',
          syncedAt: new Date(),
        },
      });
      return 'linked';
    }

    const emailTaken =
      view.email !== '' &&
      (await tx.contactEmail.count({ where: { email: view.email, deletedAt: null } })) > 0;
    const email = view.email !== '' && !emailTaken ? view.email : null;
    const company = view.company === '' ? null : await companyNamed(tx, view.company);

    await tx.contact.create({
      data: {
        id: contactId,
        firstName,
        lastName,
        displayName: displayNameOf(firstName, lastName),
        jobTitle,
        companyId: company?.id ?? null,
        // An import, which is what it is. 'yeastar' was written here once and is not a contact
        // source the API knows, so every read of such a contact failed its response schema.
        source: 'import',
        phones: {
          create: numbers.map((e164, i) => ({
            id: newId(),
            e164,
            raw: e164,
            type: i === 0 ? 'mobile' : 'other',
            isPrimary: i === 0,
          })),
        },
        ...(email ? { emails: { create: [{ id: newId(), email, isPrimary: true }] } } : {}),
      },
    });

    // Both sides recorded as they now stand, so the new contact is not sent straight back to the
    // PBX it came from. Unless the CRM could not take all of it, in which case it is.
    const asCrm: CrmContact = {
      id: contactId,
      firstName,
      lastName,
      jobTitle,
      companyName: company?.name ?? null,
      email,
      numbers,
    };
    const rowPrint = pbxFingerprint(row, country);
    const complete = printView(viewOfCrm(asCrm)) === rowPrint;
    await tx.pbxContactLink.create({
      data: {
        contactId,
        pbxContactId: row.id,
        fingerprint: complete ? fingerprint(toWrite(asCrm)) : '',
        pbxFingerprint: rowPrint,
        syncedAt: new Date(),
      },
    });
    return complete ? 'imported' : 'imported-partly';
  });
}
