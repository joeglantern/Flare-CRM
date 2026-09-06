/**
 * BullMQ producers (docs/02). One Queue per name, sharing a dedicated Valkey connection.
 */
import { Queue, type JobsOptions } from 'bullmq';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { DEFAULT_JOB_OPTIONS, QUEUES, type JobPayloads, type QueueName } from '../jobs/queues.js';
import { createValkeyClient } from './valkey.js';

export class Queues {
  private readonly queues = new Map<QueueName, Queue>();

  constructor(private readonly connectionUrl: string) {}

  get<N extends QueueName>(name: N): Queue<JobPayloads[N], unknown> {
    let q = this.queues.get(name);
    if (!q) {
      q = new Queue(name, {
        connection: {
          url: this.connectionUrl,
          maxRetriesPerRequest: null,
          enableOfflineQueue: true,
        },
        defaultJobOptions: DEFAULT_JOB_OPTIONS,
      });
      this.queues.set(name, q);
    }
    return q as Queue<JobPayloads[N], unknown>;
  }

  async add<N extends QueueName>(
    name: N,
    jobName: string,
    payload: JobPayloads[N],
    opts?: JobsOptions,
  ): Promise<string | undefined> {
    const job = await this.get(name).add(jobName as never, payload as never, opts);
    return job.id;
  }

  async remove(name: QueueName, jobId: string): Promise<void> {
    const job = await this.get(name).getJob(jobId);
    if (job) await job.remove().catch(() => undefined);
  }

  async close(): Promise<void> {
    await Promise.all([...this.queues.values()].map((q) => q.close()));
  }
}

export default fp(
  function queuesPlugin(app: FastifyInstance) {
    // sanity: connection must work (fail fast at boot)
    const probe = createValkeyClient(app.config.VALKEY_URL, `${app.config.APP_MODE}-bullmq-probe`);
    probe.disconnect();

    const queues = new Queues(app.config.VALKEY_URL);
    app.decorate('queues', queues);
    app.decorate('QUEUES', QUEUES);
    app.addHook('onClose', async () => {
      await queues.close();
    });
  },
  { name: 'queues', dependencies: ['config', 'valkey'] },
);
