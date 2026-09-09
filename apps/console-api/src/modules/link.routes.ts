/**
 * The two REST endpoints a stack uses before its socket is up (docs/21).
 *
 * A stack that has just restarted asks for whatever it should be running under, applies it, and
 * says so. Without this a stack that came back while the console was briefly unreachable would
 * wait for the next issue rather than catching up.
 *
 * Authenticated by `Authorization: Bearer <stackId>.<secret>`, not by a session: there is no
 * person here. Nothing about a customer's CRM data passes through.
 */
import { linkAckBody, linkEntitlementsResponse, signedEnvelope } from '@crm/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { UnauthenticatedError } from '../lib/errors.js';

/** Constant-shaped failure: a bad id and a bad secret are indistinguishable from outside. */
async function stackFrom(
  app: Parameters<FastifyPluginAsyncZod>[0],
  header: string | undefined,
): Promise<{ id: string; customerId: string }> {
  const raw = header?.startsWith('Bearer ') === true ? header.slice(7) : '';
  const at = raw.indexOf('.');
  const stack = at > 0 ? await app.stacks.authenticate(raw.slice(0, at), raw.slice(at + 1)) : null;
  if (!stack) throw new UnauthenticatedError('Unknown stack credentials');
  return stack;
}

const linkRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/api/link/entitlements', {
    config: { auth: { stack: true }, rateLimit: { max: 60, timeWindow: '1 minute' } },
    schema: {
      hide: true,
      response: { 200: linkEntitlementsResponse, 204: z.null() },
    },
    handler: async (request, reply) => {
      const stack = await stackFrom(app, request.headers.authorization);
      const issue = await app.db.entitlementIssue.findFirst({
        where: { stackId: stack.id, status: { in: ['pending', 'delivered'] } },
        orderBy: { issuedAt: 'desc' },
      });
      if (!issue) return reply.status(204).send(null);
      if (issue.status === 'pending') {
        await app.db.entitlementIssue.update({
          where: { id: issue.id },
          data: { status: 'delivered', deliveredAt: new Date() },
        });
      }
      // Stored as JSON; parsed on the way out so a corrupt row fails here, not on the stack.
      return reply.send({
        issueId: issue.id,
        envelope: signedEnvelope.parse(issue.envelope),
      });
    },
  });

  app.post('/api/link/ack', {
    config: { auth: { stack: true }, rateLimit: { max: 60, timeWindow: '1 minute' } },
    schema: { hide: true, body: linkAckBody, response: { 200: z.object({ ok: z.literal(true) }) } },
    handler: async (request) => {
      const stack = await stackFrom(app, request.headers.authorization);
      const a = request.body;
      const status = a.result === 'applied' ? 'acked' : 'rejected';
      await app.db.entitlementIssue.updateMany({
        where: { id: a.issueId, stackId: stack.id },
        data: { status, ackedAt: new Date(a.appliedAt), rejectReason: a.reason ?? null },
      });
      if (a.result === 'applied') {
        await app.db.stack.update({
          where: { id: stack.id },
          data: { currentIssueId: a.issueId },
        });
      }
      return { ok: true as const };
    },
  });
};

export default linkRoutes;
