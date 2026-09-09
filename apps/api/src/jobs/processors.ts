/**
 * BullMQ processors (worker process only). Each processor is small and delegates to services.
 */
import { Worker, type Job } from 'bullmq';
import type { FastifyInstance } from 'fastify';
import { createHash } from 'node:crypto';
import { LimitReachedError } from '../lib/errors.js';
import { SYSTEM_AUDIT } from '../modules/entitlements/entitlements.service.js';
import { newObjectKey } from '../integrations/storage/storage.js';
import { reconcileCdrs } from '../integrations/yeastar/reconcile.js';
import { rooms } from '../lib/realtime.js';
import { TasksService } from '../modules/tasks/tasks.service.js';
import { runCsvImport } from './csv-import.js';
import { runRetention } from './retention.js';
import { QUEUES, type JobPayloads, type QueueName } from './queues.js';

export interface RunningWorkers {
  close(): Promise<void>;
}

function connection(url: string) {
  return { url, maxRetriesPerRequest: null, enableOfflineQueue: true };
}

export function startProcessors(app: FastifyInstance): RunningWorkers {
  const workers: Worker[] = [];
  const url = app.config.VALKEY_URL;
  const tasks = new TasksService(app);

  const register = <N extends QueueName>(
    name: N,
    concurrency: number,
    handler: (job: Job<JobPayloads[N]>) => Promise<void>,
  ) => {
    const worker = new Worker<JobPayloads[N]>(name, handler, {
      connection: connection(url),
      concurrency,
    });
    worker.on('failed', (job, err) => {
      app.log.error(
        { err, queue: name, jobId: job?.id, attempts: job?.attemptsMade },
        'job failed',
      );
    });
    worker.on('error', (err) => {
      app.log.error({ err, queue: name }, 'worker error');
    });
    workers.push(worker);
  };

  register(QUEUES.email, 5, async (job) => {
    await app.mailer.send(job.data);
  });

  register(QUEUES.taskReminder, 5, async (job) => {
    await tasks.fireReminder(job.data.taskId);
  });

  register(QUEUES.csvImport, 1, async (job) => {
    await runCsvImport(app, job.data.importJobId);
  });

  register(QUEUES.retention, 1, async () => {
    await runRetention(app);
  });

  register(QUEUES.messagingInbound, 2, async (job) => {
    await app.messaging.handleInbound(job.data.channelId as 'whatsapp', job.data.payload);
  });

  register(QUEUES.messagingOutbound, 3, async (job) => {
    await app.messaging.deliver(job.data.messageId, job.attemptsMade + 1, job.opts.attempts ?? 1);
  });

  register(QUEUES.ctiEvent, 1, async (job) => {
    await app.cti.machine.handleRaw(job.data.raw, job.data.source, new Date(job.data.receivedAt));
  });

  register(QUEUES.ctiReconcile, 1, async (job) => {
    if (!app.cti.enabled || !app.cti.client) return;
    await reconcileCdrs(
      {
        client: app.cti.client,
        machine: app.cti.machine,
        valkey: app.valkey,
        pbxTimeZone: app.config.YEASTAR_TIMEZONE,
        log: app.log,
      },
      job.data.since ? new Date(job.data.since) : undefined,
    );
  });

  register(QUEUES.recordingDownload, 2, async (job) => {
    const { callId, fileName } = job.data;
    const client = app.cti.client;
    if (!client) throw new Error('PBX client not configured');
    const call = await app.db.call.findUnique({
      where: { id: callId },
      select: { id: true, recordingStatus: true, userId: true },
    });
    if (!call || call.recordingStatus === 'stored') return;
    if (!(await app.entitlements.has('recordings'))) {
      // The PBX keeps its own copy; the CRM simply does not fetch one for this plan.
      await app.db.call.update({ where: { id: callId }, data: { recordingStatus: 'none' } });
      app.log.info({ callId }, 'recording not fetched: recordings are not in the plan');
      return;
    }
    await app.db.call.update({ where: { id: callId }, data: { recordingStatus: 'downloading' } });
    try {
      const { download_resource_url } = await client.recordingDownloadUrl({ file: fileName });
      const res = await client.downloadResource(download_resource_url);
      const chunks: Uint8Array[] = [];
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }
      const buffer = Buffer.concat(chunks);
      if (buffer.length === 0) throw new Error('empty recording body');
      const ext = fileName.split('.').pop() ?? 'wav';
      const key = newObjectKey('recordings', ext);
      const contentType = res.contentType.startsWith('audio/')
        ? res.contentType
        : ext === 'mp3'
          ? 'audio/mpeg'
          : 'audio/wav';
      try {
        await app.entitlements.assertStorage(buffer.length, SYSTEM_AUDIT);
      } catch (err) {
        if (!(err instanceof LimitReachedError)) throw err;
        // Over the storage limit is not a transient failure: mark it and stop retrying.
        await app.db.call.update({ where: { id: callId }, data: { recordingStatus: 'failed' } });
        await app.audit.write(SYSTEM_AUDIT, {
          action: 'recording.skipped_limit',
          entity: 'call',
          entityId: callId,
          after: { bytes: buffer.length, details: err.details },
        });
        app.log.warn(
          { callId, bytes: buffer.length },
          'recording not stored: storage limit reached',
        );
        return;
      }
      await app.storage.put(key, buffer, contentType);
      await app.storageUsage.add('recordings', buffer.length);
      await app.db.call.update({
        where: { id: callId },
        data: {
          recordingStatus: 'stored',
          recordingKey: key,
          recordingSizeBytes: BigInt(buffer.length),
          recordingSha256: createHash('sha256').update(buffer).digest('hex'),
        },
      });
      if (call.userId)
        app.realtime.to(rooms.user(call.userId)).emit('call:recording', {
          at: new Date().toISOString(),
          callId,
          recordingStatus: 'stored',
        });
    } catch (err) {
      const final = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
      await app.db.call.update({
        where: { id: callId },
        data: { recordingStatus: final ? 'failed' : 'pending' },
      });
      throw err;
    }
  });

  app.log.info({ queues: workers.map((w) => w.name) }, 'job processors started');

  return {
    async close() {
      await Promise.all(workers.map((w) => w.close()));
    },
  };
}
