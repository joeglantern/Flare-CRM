import {
  bulkLeadsBody,
  bulkResult,
  convertLeadBody,
  convertResult,
  createLeadBody,
  dataResponse,
  idParams,
  leadDto,
  listLeadsQuery,
  offsetListResponse,
  roleHasPermission,
  updateLeadBody,
} from '@crm/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { auditContext } from '../../lib/request.js';
import { scopeOf } from '../../lib/scope.js';
import { LeadsService } from './leads.service.js';

const leadsRoutes: FastifyPluginAsyncZod = async (app) => {
  const service = new LeadsService(app);
  const actorFor = (role: string, id: string) => ({
    id,
    canAssign: roleHasPermission(role, 'lead:assign'),
  });

  app.get('/leads', {
    config: { auth: { permission: 'lead:read' } },
    schema: {
      tags: ['leads'],
      querystring: listLeadsQuery,
      response: { 200: offsetListResponse(leadDto) },
    },
    handler: async (request) => service.list((await scopeOf(app, request)).scope, request.query),
  });

  app.post('/leads', {
    config: { auth: { permission: 'lead:create' } },
    schema: { tags: ['leads'], body: createLeadBody, response: { 201: dataResponse(leadDto) } },
    handler: async (request, reply) => {
      const { actor, scope } = await scopeOf(app, request);
      return reply.status(201).send({
        data: await service.create(
          scope,
          actorFor(actor.role, actor.id),
          request.body,
          auditContext(request),
        ),
      });
    },
  });

  app.post('/leads/bulk', {
    config: { auth: { permission: 'lead:update' } },
    schema: { tags: ['leads'], body: bulkLeadsBody, response: { 200: dataResponse(bulkResult) } },
    handler: async (request) => {
      const { actor, scope } = await scopeOf(app, request);
      if (request.body.action === 'delete' && !roleHasPermission(actor.role, 'lead:delete'))
        return { data: { affected: 0, skipped: request.body.ids } };
      return {
        data: await service.bulk(
          scope,
          actorFor(actor.role, actor.id),
          request.body,
          auditContext(request),
        ),
      };
    },
  });

  app.get('/leads/:id', {
    config: { auth: { permission: 'lead:read' } },
    schema: { tags: ['leads'], params: idParams, response: { 200: dataResponse(leadDto) } },
    handler: async (request) => ({
      data: await service.get((await scopeOf(app, request)).scope, request.params.id),
    }),
  });

  app.patch('/leads/:id', {
    config: { auth: { permission: 'lead:update' } },
    schema: {
      tags: ['leads'],
      params: idParams,
      body: updateLeadBody,
      response: { 200: dataResponse(leadDto) },
    },
    handler: async (request) => {
      const { actor, scope } = await scopeOf(app, request);
      return {
        data: await service.update(
          scope,
          actorFor(actor.role, actor.id),
          request.params.id,
          request.body,
          auditContext(request),
        ),
      };
    },
  });

  app.delete('/leads/:id', {
    config: { auth: { permission: 'lead:delete' } },
    schema: { tags: ['leads'], params: idParams, response: { 204: z.null() } },
    handler: async (request, reply) => {
      const { actor, scope } = await scopeOf(app, request);
      await service.softDelete(
        scope,
        actorFor(actor.role, actor.id),
        request.params.id,
        auditContext(request),
      );
      return reply.status(204).send(null);
    },
  });

  app.post('/leads/:id/convert', {
    config: { auth: { permission: 'lead:convert' } },
    schema: {
      tags: ['leads'],
      params: idParams,
      body: convertLeadBody,
      response: { 200: dataResponse(convertResult) },
    },
    handler: async (request) => {
      const { actor, scope } = await scopeOf(app, request);
      return {
        data: await service.convert(
          scope,
          actorFor(actor.role, actor.id),
          request.params.id,
          request.body,
          auditContext(request),
        ),
      };
    },
  });
};

export default leadsRoutes;
