/**
 * The servers themselves (docs/21 §4).
 *
 * A stack is one customer's running CRM, and these are the things an operator does to one: read how
 * it is behaving, label it, ask it to report in, hand it a document again, roll its secret, and
 * refuse it altogether. They live apart from the customer routes because the question "which stack
 * is unhappy" is asked across the fleet rather than one customer at a time.
 */
import { dataResponse, offsetListResponse } from '@crm/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { ConflictError, NotFoundError } from '../lib/errors.js';
import { auditContext } from '../lib/request.js';

const stackId = z.string().min(4).max(64);

const stackRowDto = z.object({
  id: z.string(),
  label: z.string(),
  notes: z.string(),
  customer: z.object({ id: z.string(), name: z.string(), slug: z.string() }),
  connected: z.boolean(),
  lastSeenAt: z.string().nullable(),
  startedAt: z.string().nullable(),
  version: z.string().nullable(),
  domain: z.string().nullable(),
  lastBackupAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
  currentIssueId: z.string().nullable(),
  usage: z.unknown().nullable(),
  health: z.unknown().nullable(),
});

const issueRowDto = z.object({
  id: z.string(),
  status: z.string(),
  issuedAt: z.string(),
  deliveredAt: z.string().nullable(),
  ackedAt: z.string().nullable(),
  rejectReason: z.string().nullable(),
});

const sampleDto = z.object({
  at: z.string(),
  seatsActive: z.number().int(),
  storageBytes: z.number(),
  readyOk: z.boolean(),
  version: z.string().nullable(),
});

interface StackWithCustomer {
  id: string;
  label: string;
  notes: string;
  connected: boolean;
  lastSeenAt: Date | null;
  startedAt: Date | null;
  version: string | null;
  domain: string | null;
  lastBackupAt: Date | null;
  revokedAt: Date | null;
  currentIssueId: string | null;
  usage: unknown;
  health: unknown;
  customer: { id: string; name: string; slug: string };
}

function toStackRow(s: StackWithCustomer) {
  return {
    id: s.id,
    label: s.label,
    notes: s.notes,
    customer: s.customer,
    connected: s.connected,
    lastSeenAt: s.lastSeenAt?.toISOString() ?? null,
    startedAt: s.startedAt?.toISOString() ?? null,
    version: s.version,
    domain: s.domain,
    lastBackupAt: s.lastBackupAt?.toISOString() ?? null,
    revokedAt: s.revokedAt?.toISOString() ?? null,
    currentIssueId: s.currentIssueId,
    usage: s.usage,
    health: s.health,
  };
}

const stacksRoutes: FastifyPluginAsyncZod = (app) => {
  const stackOr404 = async (id: string) => {
    const stack = await app.db.stack.findUnique({
      where: { id },
      include: { customer: { select: { id: true, name: true, slug: true } } },
    });
    if (!stack) throw new NotFoundError('Stack');
    return stack;
  };

  /**
   * Every stack, across every customer. The default leaves revoked ones out, because they are
   * history rather than fleet, and staleness is asked for in minutes so "quiet for an hour" is a
   * question somebody can actually pose.
   */
  app.get('/stacks', {
    config: { auth: { permission: 'stack:read' } },
    schema: {
      tags: ['console'],
      querystring: z.object({
        q: z.string().trim().max(120).optional(),
        customerId: z.uuid().optional(),
        connected: z.enum(['true', 'false']).optional(),
        revoked: z.enum(['exclude', 'only', 'include']).default('exclude'),
        version: z.string().trim().max(64).optional(),
        staleMinutes: z.coerce.number().int().min(1).max(10_080).optional(),
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(200).default(50),
      }),
      response: { 200: offsetListResponse(stackRowDto) },
    },
    handler: async (request) => {
      const q = request.query;
      const and: Record<string, unknown>[] = [];
      if (q.revoked === 'exclude') and.push({ revokedAt: null });
      if (q.revoked === 'only') and.push({ revokedAt: { not: null } });
      if (q.customerId !== undefined) and.push({ customerId: q.customerId });
      if (q.connected !== undefined) and.push({ connected: q.connected === 'true' });
      if (q.version !== undefined) and.push({ version: q.version });
      if (q.staleMinutes !== undefined) {
        // Never heard from counts as stale: a stack that has said nothing at all is the one most
        // worth finding, not the one to leave out of the answer.
        const cutoff = new Date(Date.now() - q.staleMinutes * 60_000);
        and.push({ OR: [{ lastSeenAt: null }, { lastSeenAt: { lt: cutoff } }] });
      }
      if (q.q !== undefined && q.q !== '') {
        and.push({
          OR: [
            { id: { contains: q.q } },
            { label: { contains: q.q, mode: 'insensitive' } },
            { domain: { contains: q.q.toLowerCase() } },
            { customer: { name: { contains: q.q, mode: 'insensitive' } } },
          ],
        });
      }
      const where = and.length === 0 ? {} : { AND: and };

      const [total, rows] = await Promise.all([
        app.db.stack.count({ where }),
        app.db.stack.findMany({
          where,
          include: { customer: { select: { id: true, name: true, slug: true } } },
          orderBy: [{ connected: 'desc' }, { lastSeenAt: 'desc' }],
          skip: (q.page - 1) * q.pageSize,
          take: q.pageSize,
        }),
      ]);
      return {
        data: rows.map(toStackRow),
        page: { page: q.page, pageSize: q.pageSize, total },
      };
    },
  });

  app.get('/stacks/:stackId', {
    config: { auth: { permission: 'stack:read' } },
    schema: {
      tags: ['console'],
      params: z.object({ stackId }),
      response: { 200: dataResponse(stackRowDto) },
    },
    handler: async (request) => ({ data: toStackRow(await stackOr404(request.params.stackId)) }),
  });

  /**
   * What this one stack has been doing, at the five minute resolution the heartbeat is sampled at.
   * Kept for thirty days, so a window wider than that is answered with what there is rather than
   * with nothing.
   */
  app.get('/stacks/:stackId/samples', {
    config: { auth: { permission: 'stack:read' } },
    schema: {
      tags: ['console'],
      params: z.object({ stackId }),
      querystring: z.object({ hours: z.coerce.number().int().min(1).max(168).default(24) }),
      response: { 200: dataResponse(z.array(sampleDto)) },
    },
    handler: async (request) => {
      await stackOr404(request.params.stackId);
      const since = new Date(Date.now() - request.query.hours * 3_600_000);
      const rows = await app.db.stackSample.findMany({
        where: { stackId: request.params.stackId, at: { gte: since } },
        orderBy: { at: 'asc' },
      });
      return {
        data: rows.map((r) => ({
          at: r.at.toISOString(),
          seatsActive: r.seatsActive,
          storageBytes: Number(r.storageBytes),
          readyOk: r.readyOk,
          version: r.version,
        })),
      };
    },
  });

  app.get('/stacks/:stackId/issues', {
    config: { auth: { permission: 'stack:read' } },
    schema: {
      tags: ['console'],
      params: z.object({ stackId }),
      querystring: z.object({
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(100).default(20),
      }),
      response: { 200: offsetListResponse(issueRowDto) },
    },
    handler: async (request) => {
      await stackOr404(request.params.stackId);
      const where = { stackId: request.params.stackId };
      const [total, rows] = await Promise.all([
        app.db.entitlementIssue.count({ where }),
        app.db.entitlementIssue.findMany({
          where,
          orderBy: { issuedAt: 'desc' },
          skip: (request.query.page - 1) * request.query.pageSize,
          take: request.query.pageSize,
        }),
      ]);
      return {
        data: rows.map((i) => ({
          id: i.id,
          status: i.status,
          issuedAt: i.issuedAt.toISOString(),
          deliveredAt: i.deliveredAt?.toISOString() ?? null,
          ackedAt: i.ackedAt?.toISOString() ?? null,
          rejectReason: i.rejectReason,
        })),
        page: { page: request.query.page, pageSize: request.query.pageSize, total },
      };
    },
  });

  app.patch('/stacks/:stackId', {
    config: { auth: { permission: 'stack:manage' } },
    schema: {
      tags: ['console'],
      params: z.object({ stackId }),
      body: z
        .object({
          label: z.string().trim().min(1).max(80).optional(),
          notes: z.string().trim().max(2000).optional(),
        })
        .strict(),
      response: { 200: dataResponse(stackRowDto) },
    },
    handler: async (request) => {
      const before = await stackOr404(request.params.stackId);
      const data = Object.fromEntries(
        Object.entries(request.body).filter(([, v]) => v !== undefined),
      );
      await app.db.stack.update({ where: { id: before.id }, data });
      await app.audit.write(auditContext(request), {
        action: 'stack.update',
        entity: 'stack',
        entityId: before.id,
        before: { label: before.label, notes: before.notes },
        after: request.body,
      });
      return { data: toStackRow(await stackOr404(before.id)) };
    },
  });

  /**
   * Hands a stack the newest document it was ever given, again.
   *
   * For a server that lost what it had: a restored backup, a rebuild, a database rolled back.
   * Nothing is signed afresh, because the document that was signed is still what was agreed. A
   * revoked stack is refused, since the whole point of revoking it was that it stops hearing from
   * us.
   */
  app.post('/stacks/:stackId/redeliver', {
    config: { auth: { permission: 'stack:operate' } },
    schema: {
      tags: ['console'],
      params: z.object({ stackId }),
      response: {
        200: dataResponse(z.object({ issueId: z.string(), delivered: z.boolean() })),
      },
    },
    handler: async (request) => {
      const stack = await stackOr404(request.params.stackId);
      if (stack.revokedAt !== null) {
        throw new ConflictError('That stack is revoked, so nothing is sent to it any more');
      }
      const again = await app.stacks.redeliver(stack.id);
      if (again === null) {
        throw new ConflictError(
          'This stack has never been issued a document. Issue one from the customer instead',
        );
      }
      await app.link.deliver([{ ...again, stackId: stack.id }]);
      await app.audit.write(auditContext(request), {
        action: 'stack.redeliver',
        entity: 'stack',
        entityId: stack.id,
        after: { issueId: again.issueId, customerId: stack.customer.id },
      });
      return { data: { issueId: again.issueId, delivered: stack.connected } };
    },
  });

  app.post('/stacks/:stackId/rotate', {
    config: { auth: { permission: 'stack:manage' } },
    schema: {
      tags: ['console'],
      params: z.object({ stackId }),
      response: {
        200: dataResponse(
          z.object({ stackId: z.string(), secret: z.string(), envLines: z.array(z.string()) }),
        ),
      },
    },
    handler: async (request) => {
      const stack = await stackOr404(request.params.stackId);
      const rotated = await app.stacks.rotate(stack.id);
      app.link.disconnect(stack.id);
      await app.audit.write(auditContext(request), {
        action: 'stack.rotate',
        entity: 'stack',
        entityId: stack.id,
      });
      return { data: rotated };
    },
  });

  app.post('/stacks/:stackId/ping', {
    config: { auth: { permission: 'stack:operate' } },
    schema: {
      tags: ['console'],
      params: z.object({ stackId }),
      response: { 200: dataResponse(z.object({ asked: z.boolean() })) },
    },
    handler: (request) => {
      // No audit row: asking a stack to speak sooner changes nothing about it.
      return Promise.resolve({ data: { asked: app.link.ping(request.params.stackId) } });
    },
  });

  app.delete('/stacks/:stackId', {
    config: { auth: { permission: 'stack:manage' } },
    schema: {
      tags: ['console'],
      params: z.object({ stackId }),
      response: { 204: z.null() },
    },
    handler: async (request, reply) => {
      const stack = await stackOr404(request.params.stackId);
      const { closed } = await app.stacks.revoke(stack.id);
      app.link.disconnect(stack.id);
      await app.audit.write(auditContext(request), {
        action: 'stack.revoke',
        entity: 'stack',
        entityId: stack.id,
        // How many documents stopped waiting because of this, which is the part that would
        // otherwise look like a number nobody could explain a week later.
        after: { customerId: stack.customer.id, documentsClosed: closed },
      });
      return reply.status(204).send(null);
    },
  });

  return Promise.resolve();
};

export default stacksRoutes;
