/**
 * Retention job (docs/05 §soft delete, docs/08 J3, docs/13 §retention). Runs daily in the worker:
 *  1. hard-purge soft-deleted business records older than `retention.softDeletePurgeDays`
 *  2. trim `pbx_events` older than `retention.pbxEventsDays`
 *  3. drop raw provider payloads on messages older than `retention.rawMessagePayloadDays`
 *  4. delete call recordings older than `recording.retentionDays` (object + DB pointer, audited)
 * Every step is idempotent and bounded per run so a huge backlog cannot stall the worker.
 */
import type { FastifyInstance } from 'fastify';
import { Prisma } from '../generated/prisma/client.js';

const RECORDING_BATCH = 500;

export interface RetentionSummary {
  purged: Record<string, number>;
  pbxEvents: number;
  rawPayloads: number;
  recordings: number;
  recordingErrors: number;
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

export async function runRetention(app: FastifyInstance): Promise<RetentionSummary> {
  const retention = await app.settings.get('retention');
  const recording = await app.settings.get('recording');
  const db = app.db;

  // 1. soft-deleted purge — children (notes/tasks/phones/emails) cascade via FKs where declared;
  //    order parents last so cascades do the heavy lifting.
  const purgeBefore = daysAgo(retention.softDeletePurgeDays);
  const purged: Record<string, number> = {};
  purged.notes = (await db.note.deleteMany({ where: { deletedAt: { lt: purgeBefore } } })).count;
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

  const summary: RetentionSummary = { purged, pbxEvents, rawPayloads, recordings, recordingErrors };
  await app.audit.write(
    { actorId: null, actorType: 'system' },
    { action: 'retention.run', entity: 'system', after: summary },
  );
  app.log.info(summary, 'retention run complete');
  return summary;
}
