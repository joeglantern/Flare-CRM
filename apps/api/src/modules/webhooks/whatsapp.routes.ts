/**
 * WhatsApp Cloud API webhooks (docs/11 §2, docs/08 §H): GET verification handshake, POST with
 * X-Hub-Signature-256 verification on raw bytes → dedupe → enqueue → 200.
 */
import { createHash } from 'node:crypto';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { QUEUES } from '../../jobs/queues.js';
import { UnauthenticatedError } from '../../lib/errors.js';

const verifyQuery = z.object({
  'hub.mode': z.string().optional(),
  'hub.verify_token': z.string().optional(),
  'hub.challenge': z.string().optional(),
});

const whatsappWebhookRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/webhooks/whatsapp', {
    config: { auth: { public: true }, rateLimit: { max: 30, timeWindow: '1 minute' } },
    schema: { hide: true, querystring: verifyQuery },
    handler: async (request, reply) => {
      const q = request.query;
      const expected = app.config.WHATSAPP_VERIFY_TOKEN;
      if (
        !app.config.WHATSAPP_ENABLED ||
        !(await app.entitlements.has('messaging')) ||
        !expected ||
        q['hub.mode'] !== 'subscribe' ||
        q['hub.verify_token'] !== expected ||
        !q['hub.challenge']
      ) {
        throw new UnauthenticatedError('Verification failed');
      }
      return reply.header('content-type', 'text/plain').send(q['hub.challenge']);
    },
  });

  app.post('/webhooks/whatsapp', {
    config: { auth: { public: true }, rateLimit: { max: 1200, timeWindow: '1 minute' } },
    schema: { hide: true, response: { 200: z.object({ ok: z.literal(true) }) } },
    handler: async (request, reply) => {
      const raw = request.rawBody ?? Buffer.alloc(0);
      /*
       * Logged, not audited, and the two reasons are told apart. See the note on the Yeastar
       * webhook: a public route writing to an append-only log that nothing prunes let anyone put
       * permanent rows into a customer's audit screen without credentials, and a channel still
       * sending after messaging left the plan did the same with no attacker involved.
       */
      if (!app.config.WHATSAPP_ENABLED || !(await app.entitlements.has('messaging'))) {
        request.log.info({ ip: request.ip }, 'whatsapp webhook ignored: messaging is not enabled');
        // Answered rather than refused, so a sender stops retrying instead of queueing forever.
        return reply.send({ ok: true as const });
      }
      if (!app.whatsappAdapter.verifyWebhook(raw, request.headers)) {
        request.log.warn({ ip: request.ip }, 'whatsapp webhook signature rejected');
        throw new UnauthenticatedError('Invalid signature');
      }
      const jobId = `wa-${createHash('sha256').update(raw).digest('hex')}`;
      await app.queues.add(
        QUEUES.messagingInbound,
        'inbound',
        { channelId: 'whatsapp', payload: request.body },
        { jobId, attempts: 5, removeOnComplete: { age: 3600 } },
      );
      return reply.send({ ok: true as const });
    },
  });
};

export default whatsappWebhookRoutes;
