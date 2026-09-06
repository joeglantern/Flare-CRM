import { isoDateTime, offsetListResponse, uuid } from '@crm/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

const auditQuery = z.object({
  entity: z.string().max(60).optional(),
  entityId: uuid.optional(),
  actorId: uuid.optional(),
  action: z.string().max(80).optional(),
  from: isoDateTime.optional(),
  to: isoDateTime.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});

const auditDto = z.object({
  id: uuid,
  actorId: uuid.nullable(),
  actorType: z.string(),
  action: z.string(),
  entity: z.string(),
  entityId: uuid.nullable(),
  before: z.unknown().nullable(),
  after: z.unknown().nullable(),
  ip: z.string().nullable(),
  requestId: z.string().nullable(),
  createdAt: isoDateTime,
});

const auditRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/audit', {
    config: { auth: { permission: 'audit:read' } },
    schema: {
      tags: ['audit'],
      querystring: auditQuery,
      response: { 200: offsetListResponse(auditDto) },
    },
    handler: async (request) => {
      const q = request.query;
      const where = {
        ...(q.entity ? { entity: q.entity } : {}),
        ...(q.entityId ? { entityId: q.entityId } : {}),
        ...(q.actorId ? { actorId: q.actorId } : {}),
        ...(q.action ? { action: { startsWith: q.action } } : {}),
        ...(q.from || q.to
          ? {
              createdAt: {
                ...(q.from ? { gte: new Date(q.from) } : {}),
                ...(q.to ? { lte: new Date(q.to) } : {}),
              },
            }
          : {}),
      };
      const [rows, total] = await Promise.all([
        app.db.auditLog.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (q.page - 1) * q.pageSize,
          take: q.pageSize,
        }),
        app.db.auditLog.count({ where }),
      ]);
      return {
        data: rows.map((r) => ({
          id: r.id,
          actorId: r.actorId,
          actorType: r.actorType,
          action: r.action,
          entity: r.entity,
          entityId: r.entityId,
          before: r.before ?? null,
          after: r.after ?? null,
          ip: r.ip,
          requestId: r.requestId,
          createdAt: r.createdAt.toISOString(),
        })),
        page: { page: q.page, pageSize: q.pageSize, total },
      };
    },
  });
};

export default auditRoutes;
