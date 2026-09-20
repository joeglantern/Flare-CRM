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
 */
import type { FastifyInstance } from 'fastify';
import type { CountryCode } from 'libphonenumber-js';
import {
  ensurePhonebook,
  fetchAllPbxContacts,
  fingerprint,
  planSync,
  rowE164s,
  splitName,
  toWrite,
  type ContactLink,
  type CrmContact,
  type SyncSummary,
} from '../integrations/yeastar/contact-sync.js';
import { newId } from '../lib/ids.js';
import { SYSTEM_AUDIT } from '../modules/entitlements/entitlements.service.js';

/**
 * How many writes one run will make.
 *
 * The first sync of an established CRM is thousands of contacts and the PBX is a phone system, not
 * a database, so the work is spread over several runs rather than delivered as a thundering herd.
 * Whatever is left is simply the difference the next run finds.
 */
const MAX_WRITES_PER_RUN = 300;

export async function runContactSync(app: FastifyInstance): Promise<SyncSummary | null> {
  const summary: SyncSummary = {
    created: 0,
    updated: 0,
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
  const phonebookId = await ensurePhonebook(client, settings.contactSync.phonebookName);

  const [rows, links, pbx] = await Promise.all([
    app.db.contact.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        jobTitle: true,
        company: { select: { name: true } },
        emails: { where: { deletedAt: null }, orderBy: { isPrimary: 'desc' }, take: 1 },
        phones: {
          where: { deletedAt: null },
          orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
          select: { e164: true },
        },
      },
    }),
    app.db.pbxContactLink.findMany(),
    fetchAllPbxContacts(client),
  ]);

  const crm: CrmContact[] = rows.map((r) => ({
    id: r.id,
    firstName: r.firstName,
    lastName: r.lastName,
    jobTitle: r.jobTitle,
    companyName: r.company?.name ?? null,
    email: r.emails[0]?.email ?? null,
    numbers: r.phones.map((p) => p.e164),
  }));

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
    })),
    deletedContactIds,
    country,
  });
  summary.skippedNoNumber = plan.skippedNoNumber.length;

  let writes = 0;
  const budgetLeft = () => writes < MAX_WRITES_PER_RUN;

  // Adoptions cost no request: the PBX already holds exactly this, so only the link is recorded.
  for (const { contact, pbxContactId, fingerprint: print } of plan.adopt) {
    await linkContact(app, contact.id, pbxContactId, print);
    summary.adopted++;
  }

  for (const contact of plan.create) {
    if (!budgetLeft()) break;
    const write = toWrite(contact);
    try {
      const created = await client.companyContactCreate(write);
      await linkContact(app, contact.id, created.id, fingerprint(write));
      summary.created++;
    } catch (err) {
      app.log.warn({ err, contactId: contact.id }, 'could not create a contact on the PBX');
      summary.failed++;
    }
    writes++;
  }

  for (const { contact, pbxContactId } of plan.update) {
    if (!budgetLeft()) break;
    const write = toWrite(contact);
    try {
      await client.companyContactUpdate({ ...write, id: pbxContactId });
      await linkContact(app, contact.id, pbxContactId, fingerprint(write));
      summary.updated++;
    } catch (err) {
      app.log.warn({ err, contactId: contact.id }, 'could not update a contact on the PBX');
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
      if (outcome === 'imported') summary.imported++;
      else if (outcome === 'linked') summary.adopted++;
      else summary.duplicatesOnPbx++;
    } catch (err) {
      app.log.warn({ err, pbxContactId: row.id }, 'could not import a contact from the PBX');
      summary.failed++;
    }
    writes++;
  }

  if (summary.created + summary.removed + summary.imported > 0) {
    await app.audit.write(SYSTEM_AUDIT, {
      action: 'contact.sync',
      entity: 'contact',
      after: { ...summary, phonebookId },
    });
  }

  app.log.info({ ...summary, phonebookId }, 'contact sync complete');
  return summary;
}

async function linkContact(
  app: FastifyInstance,
  contactId: string,
  pbxContactId: number,
  print: string,
): Promise<void> {
  await app.db.pbxContactLink.upsert({
    where: { contactId },
    create: { contactId, pbxContactId, fingerprint: print, syncedAt: new Date() },
    update: { pbxContactId, fingerprint: print, syncedAt: new Date() },
  });
}

/**
 * A person the PBX knows and the CRM does not, brought in.
 *
 * Answers what it did, because two of the three outcomes are not imports. A number the CRM already
 * holds means this row is the same person, and if that person is already linked to a different row
 * then the PBX simply has them twice: that is left exactly as it is. Moving the link to the second
 * row would move it back to the first on the next run, forever, and each pass would write an audit
 * row that nothing can ever prune.
 *
 * Unowned on purpose: the sync cannot know whose contact this is, and guessing would hand somebody
 * else's customer to whoever happens to run the job. Unowned contacts are visible to every agent,
 * so nobody loses sight of them while an admin decides.
 *
 * `source` records where they came from, so a later "who typed this in" question has an answer.
 */
async function importContact(
  app: FastifyInstance,
  row: Parameters<typeof rowE164s>[0],
  country: CountryCode,
): Promise<'imported' | 'linked' | 'duplicate'> {
  const numbers = rowE164s(row, country);
  const first = numbers[0];
  if (first === undefined) return 'duplicate';
  const { firstName, lastName } = splitName(row);
  const displayName = [firstName, lastName].filter(Boolean).join(' ');
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
        app.log.warn(
          { pbxContactId: row.id, alreadyLinkedTo: existing.pbxContactId },
          'the PBX holds this number twice; leaving the second entry alone',
        );
        return 'duplicate';
      }
      await tx.pbxContactLink.create({
        data: {
          contactId: clash.contactId,
          pbxContactId: row.id,
          fingerprint: '',
          syncedAt: new Date(),
        },
      });
      return 'linked';
    }

    await tx.contact.create({
      data: {
        id: contactId,
        firstName,
        lastName,
        displayName,
        jobTitle: typeof row.job_title === 'string' && row.job_title !== '' ? row.job_title : null,
        source: 'yeastar',
        phones: {
          create: numbers.map((e164, i) => ({
            id: newId(),
            e164,
            raw: e164,
            type: i === 0 ? 'mobile' : 'other',
            isPrimary: i === 0,
          })),
        },
        ...(row.email
          ? { emails: { create: [{ id: newId(), email: row.email, isPrimary: true }] } }
          : {}),
      },
    });
    await tx.pbxContactLink.create({
      data: {
        contactId,
        pbxContactId: row.id,
        fingerprint: '',
        syncedAt: new Date(),
      },
    });
    return 'imported';
  });
}
