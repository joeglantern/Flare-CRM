/**
 * Retention job (docs/05 §soft delete, docs/08 J3, docs/13 §retention). Runs daily in the worker:
 *  1. hard-purge soft-deleted business records older than `retention.softDeletePurgeDays`
 *  2. trim `pbx_events` older than `retention.pbxEventsDays`
 *  3. drop raw provider payloads on messages older than `retention.rawMessagePayloadDays`
 *  4. delete call recordings older than `recording.retentionDays` (object + DB pointer, audited)
 *  5. delete attachment objects for notes about to be purged, and uploads never attached to
 *     anything, neither of which any cascade can reach
 * Every step is idempotent and bounded per run so a huge backlog cannot stall the worker.
 */
import type { FastifyInstance } from 'fastify';
import { Prisma } from '../generated/prisma/client.js';

const RECORDING_BATCH = 500;
const ATTACHMENT_BATCH = 500;
/** Passes over doomed attachments in one run; the next run continues where this one stopped. */
const ATTACHMENT_PASSES = 10;
/**
 * A file is uploaded before the note that claims it, so an unattached upload is normal for a few
 * minutes. Past a day it means the note was never saved and nothing will ever reference it.
 */
const ORPHAN_UPLOAD_HOURS = 24;
/** Snapshots kept in the object store. The backup service adds one a night. */
const KEEP_BACKUPS = 14;

export interface RetentionSummary {
  purged: Record<string, number>;
  pbxEvents: number;
  rawPayloads: number;
  recordings: number;
  recordingErrors: number;
  attachments: number;
  attachmentErrors: number;
  backups: number;
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

/**
 * Removes the stored files, then the rows. Deleting the rows first would strand the objects with
 * nothing left pointing at them, which is exactly the leak this exists to close.
 */
async function purgeAttachments(
  app: FastifyInstance,
  where: Prisma.AttachmentWhereInput,
): Promise<{ deleted: number; errors: number; drained: boolean }> {
  const rows = await app.db.attachment.findMany({
    where,
    select: { id: true, key: true },
    take: ATTACHMENT_BATCH,
  });
  let deleted = 0;
  let errors = 0;
  const done: string[] = [];
  for (const a of rows) {
    try {
      await app.storage.delete(a.key);
      done.push(a.id);
      deleted++;
    } catch (err) {
      // Leave the row alone so the next run tries this object again.
      errors++;
      app.log.error({ err, attachmentId: a.id }, 'attachment object delete failed');
    }
  }
  if (done.length > 0) await app.db.attachment.deleteMany({ where: { id: { in: done } } });
  return { deleted, errors, drained: rows.length < ATTACHMENT_BATCH };
}

export async function runRetention(app: FastifyInstance): Promise<RetentionSummary> {
  const retention = await app.settings.get('retention');
  const recording = await app.settings.get('recording');
  const db = app.db;

  // 1. soft-deleted purge — children (notes/tasks/phones/emails) cascade via FKs where declared;
  //    order parents last so cascades do the heavy lifting.
  const purgeBefore = daysAgo(retention.softDeletePurgeDays);
  const purged: Record<string, number> = {};

  // Clear the files off the notes that are about to go. Their rows would cascade away with the
  // note, taking the only reference to the object with them, so this has to happen first. If a
  // backlog is not drained within the pass budget the notes are left for the next run rather than
  // deleted over objects that are still there.
  let attachments = 0;
  let attachmentErrors = 0;
  let notesReadyToPurge = false;
  for (let pass = 0; pass < ATTACHMENT_PASSES; pass++) {
    const r = await purgeAttachments(app, { note: { deletedAt: { lt: purgeBefore } } });
    attachments += r.deleted;
    attachmentErrors += r.errors;
    if (r.drained) {
      notesReadyToPurge = r.errors === 0;
      break;
    }
  }

  purged.notes = notesReadyToPurge
    ? (await db.note.deleteMany({ where: { deletedAt: { lt: purgeBefore } } })).count
    : 0;
  purged.tasks = (await db.task.deleteMany({ where: { deletedAt: { lt: purgeBefore } } })).count;
  purged.deals = (await db.deal.deleteMany({ where: { deletedAt: { lt: purgeBefore } } })).count;
  purged.leads = (await db.lead.deleteMany({ where: { deletedAt: { lt: purgeBefore } } })).count;
  purged.contactPhones = (
    await db.contactPhone.deleteMany({ where: { deletedAt: { lt: purgeBefore } } })
  ).count;
  purged.contactEmails = (
    await db.contactEmail.deleteMany({ where: { deletedAt: { lt: purgeBefore } } })
  ).count;
  purged.contacts = (
    await db.contact.deleteMany({ where: { deletedAt: { lt: purgeBefore } } })
  ).count;
  purged.companies = (
    await db.company.deleteMany({ where: { deletedAt: { lt: purgeBefore } } })
  ).count;

  // 2. pbx_events
  const pbxEvents = (
    await db.pbxEvent.deleteMany({
      where: { receivedAt: { lt: daysAgo(retention.pbxEventsDays) } },
    })
  ).count;

  // 3. raw message payloads (PII minimisation) — bodies/attachments are kept
  const rawPayloads = (
    await db.message.updateMany({
      where: {
        raw: { not: Prisma.DbNull },
        sentAt: { lt: daysAgo(retention.rawMessagePayloadDays) },
      },
      data: { raw: Prisma.DbNull },
    })
  ).count;

  // 4. recordings
  let recordings = 0;
  let recordingErrors = 0;
  const recordingBefore = daysAgo(recording.retentionDays);
  const expired = await db.call.findMany({
    where: { recordingKey: { not: null }, startedAt: { lt: recordingBefore } },
    select: { id: true, recordingKey: true, contactId: true },
    orderBy: { startedAt: 'asc' },
    take: RECORDING_BATCH,
  });
  for (const call of expired) {
    if (!call.recordingKey) continue;
    try {
      await app.storage.delete(call.recordingKey);
      await db.call.update({
        where: { id: call.id },
        data: {
          recordingStatus: 'none',
          recordingKey: null,
          recordingSizeBytes: null,
          recordingSha256: null,
          recordingFileName: null,
        },
      });
      await app.audit.write(
        { actorId: null, actorType: 'system' },
        {
          action: 'recording.expired',
          entity: 'call',
          entityId: call.id,
          before: { recordingKey: call.recordingKey },
          after: { retentionDays: recording.retentionDays },
        },
      );
      recordings++;
    } catch (err) {
      recordingErrors++;
      app.log.error({ err, callId: call.id }, 'recording retention delete failed');
    }
  }

  // 5b. uploads that were never attached to anything
  for (let pass = 0; pass < ATTACHMENT_PASSES; pass++) {
    const r = await purgeAttachments(app, {
      noteId: null,
      messageId: null,
      createdAt: { lt: new Date(Date.now() - ORPHAN_UPLOAD_HOURS * 60 * 60 * 1000) },
    });
    attachments += r.deleted;
    attachmentErrors += r.errors;
    if (r.drained) break;
  }

  // 6. trim the snapshot series. The backup service writes one a night and cannot list the store
  //    to prune itself, so the trimming lives here where listing and deleting already exist.
  let backups = 0;
  try {
    const snapshots = await app.storage.list('backups/', 200);
    for (const old of snapshots.slice(KEEP_BACKUPS)) {
      await app.storage.delete(old.key);
      backups++;
    }
  } catch (err) {
    app.log.error({ err }, 'trimming old backups failed');
  }

  const summary: RetentionSummary = {
    purged,
    pbxEvents,
    rawPayloads,
    recordings,
    recordingErrors,
    attachments,
    attachmentErrors,
    backups,
  };
  await app.audit.write(
    { actorId: null, actorType: 'system' },
    { action: 'retention.run', entity: 'system', after: summary },
  );
  app.log.info(summary, 'retention run complete');
  return summary;
}
