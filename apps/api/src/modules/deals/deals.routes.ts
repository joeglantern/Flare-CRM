import {
  boardColumn,
  boardQuery,
  bulkDealsBody,
  bulkResult,
  changeStageBody,
  createDealBody,
  dataResponse,
  dealDto,
  dealStageHistoryDto,
  idParams,
  listDealsQuery,
  offsetListResponse,
  roleHasPermission,
  updateDealBody,
  uuid,
} from '@crm/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { auditContext } from '../../lib/request.js';
import { scopeOf } from '../../lib/scope.js';
import { DealsService } from './deals.service.js';

const dealsRoutes: FastifyPluginAsyncZod = async (app) => {
  const service = new DealsService(app);
  const actorFor = (role: string, id: string) => ({
    id,
    canAssign: roleHasPermission(role, 'deal:assign'),
  });

  app.get('/deals', {
    config: { auth: { permission: 'deal:read', feature: 'deals' } },
    schema: {
      tags: ['deals'],
      querystring: listDealsQuery,
      response: { 200: offsetListResponse(dealDto) },
    },
    handler: async (request) => service.list((await scopeOf(app, request)).scope, request.query),
  });

  app.get('/deals/board', {
    config: { auth: { permission: 'deal:read', feature: 'deals' } },
    schema: {
      tags: ['deals'],
      querystring: boardQuery,
      response: {
        200: dataResponse(z.object({ pipelineId: uuid, columns: z.array(boardColumn) })),
      },
    },
    handler: async (request) => ({
      data: await service.board((await scopeOf(app, request)).scope, request.query),
    }),
  });

  app.post('/deals', {
    config: { auth: { permission: 'deal:create', feature: 'deals' } },
    schema: { tags: ['deals'], body: createDealBody, response: { 201: dataResponse(dealDto) } },
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

  app.post('/deals/bulk', {
    config: { auth: { permission: 'deal:update', feature: 'deals' } },
    schema: { tags: ['deals'], body: bulkDealsBody, response: { 200: dataResponse(bulkResult) } },
    handler: async (request) => {
      const { actor, scope } = await scopeOf(app, request);
      if (request.body.action === 'delete' && !roleHasPermission(actor.role, 'deal:delete'))
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

  app.get('/deals/:id', {
    config: { auth: { permission: 'deal:read', feature: 'deals' } },
    schema: { tags: ['deals'], params: idParams, response: { 200: dataResponse(dealDto) } },
    handler: async (request) => ({
      data: await service.get((await scopeOf(app, request)).scope, request.params.id),
    }),
  });

  app.patch('/deals/:id', {
    config: { auth: { permission: 'deal:update', feature: 'deals' } },
    schema: {
      tags: ['deals'],
      params: idParams,
      body: updateDealBody,
      response: { 200: dataResponse(dealDto) },
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

  app.post('/deals/:id/stage', {
    config: { auth: { permission: 'deal:change_stage', feature: 'deals' } },
    schema: {
      tags: ['deals'],
      params: idParams,
      body: changeStageBody,
      response: { 200: dataResponse(dealDto) },
    },
    handler: async (request) => {
      const { actor, scope } = await scopeOf(app, request);
      return {
        data: await service.changeStage(
          scope,
          actorFor(actor.role, actor.id),
          request.params.id,
          request.body,
          auditContext(request),
        ),
      };
    },
  });

  app.get('/deals/:id/history', {
    config: { auth: { permission: 'deal:read', feature: 'deals' } },
    schema: {
      tags: ['deals'],
      params: idParams,
      response: { 200: dataResponse(z.array(dealStageHistoryDto)) },
    },
    handler: async (request) => ({
      data: await service.history((await scopeOf(app, request)).scope, request.params.id),
    }),
  });

  app.delete('/deals/:id', {
    config: { auth: { permission: 'deal:delete', feature: 'deals' } },
    schema: { tags: ['deals'], params: idParams, response: { 204: z.null() } },
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

  app.post('/deals/:id/restore', {
    config: { auth: { permission: 'deal:delete', feature: 'deals' } },
    schema: { tags: ['deals'], params: idParams, response: { 200: dataResponse(dealDto) } },
    handler: async (request) => ({
      data: await service.restore(
        (await scopeOf(app, request)).scope,
        request.params.id,
        auditContext(request),
      ),
    }),
  });
};

export default dealsRoutes;
