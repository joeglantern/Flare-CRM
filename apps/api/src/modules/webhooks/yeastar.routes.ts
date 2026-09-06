/**
 * Yeastar webhook receiver (docs/06 §6, docs/08 §H): verify signature on raw bytes, dedupe,
 * enqueue, answer 200 immediately.
 */
import { createHash } from 'node:crypto';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { verifyYeastarSignature } from '../../integrations/yeastar/webhook-verify.js';
import { QUEUES } from '../../jobs/queues.js';
import { UnauthenticatedError } from '../../lib/errors.js';

const yeastarWebhookRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post('/webhooks/yeastar', {
    config: { auth: { public: true }, rateLimit: { max: 600, timeWindow: '1 minute' } },
    schema: { hide: true, response: { 200: z.object({ ok: z.literal(true) }) } },
    handler: async (request, reply) => {
      const secret = app.config.YEASTAR_WEBHOOK_SECRET;
      const raw = request.rawBody ?? Buffer.alloc(0);
      const signature = request.headers['x-signature'];
      if (
        !secret ||
        !verifyYeastarSignature(raw, secret, Array.isArray(signature) ? signature[0] : signature)
      ) {
        request.log.warn({ ip: request.ip }, 'yeastar webhook signature rejected');
        await app.audit
          .write(
            { actorId: null, actorType: 'webhook', ip: request.ip, requestId: request.id },
            { action: 'webhook.signature_rejected', entity: 'pbx' },
          )
          .catch(() => undefined);
        throw new UnauthenticatedError('Invalid signature');
      }
      const body = request.body as { event?: unknown; type?: unknown } | undefined;
      if (body && typeof body === 'object' && body.event === 'test')
        return reply.send({ ok: true as const });
      if (app.config.YEASTAR_EVENT_SOURCE === 'websocket') return reply.send({ ok: true as const }); // webhook configured but not selected as a source
      const jobId = `evt-${createHash('sha256').update(raw).digest('hex')}`;
      await app.queues.add(
        QUEUES.ctiEvent,
        'event',
        { raw: request.body, source: 'webhook', receivedAt: new Date().toISOString() },
        { jobId, attempts: 3, removeOnComplete: { age: 3600 } },
      );
      return reply.send({ ok: true as const });
    },
  });
};

export default yeastarWebhookRoutes;
