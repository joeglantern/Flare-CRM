import {
  calendarQuery,
  createTaskBody,
  dataResponse,
  idParams,
  listTasksQuery,
  offsetListResponse,
  roleHasPermission,
  taskDto,
  updateTaskBody,
} from '@crm/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { auditContext } from '../../lib/request.js';
import { scopeOf } from '../../lib/scope.js';
import { TasksService } from './tasks.service.js';

const tasksRoutes: FastifyPluginAsyncZod = async (app) => {
  const service = new TasksService(app);
  const actorFor = (role: string, id: string) => ({
    id,
    canAssign: roleHasPermission(role, 'task:assign'),
  });

  app.get('/tasks', {
    config: { auth: { permission: 'task:read' } },
    schema: {
      tags: ['tasks'],
      querystring: listTasksQuery,
      response: { 200: offsetListResponse(taskDto) },
    },
    handler: async (request) => {
      const { actor, scope } = await scopeOf(app, request);
      return service.list(scope, actor.id, request.query);
    },
  });

  app.get('/tasks/calendar', {
    config: { auth: { permission: 'task:read' } },
    schema: {
      tags: ['tasks'],
      querystring: calendarQuery,
      response: { 200: dataResponse(z.array(taskDto)) },
    },
    handler: async (request) => ({
      data: await service.calendar((await scopeOf(app, request)).scope, request.query),
    }),
  });

  app.post('/tasks', {
    config: { auth: { permission: 'task:create' } },
    schema: { tags: ['tasks'], body: createTaskBody, response: { 201: dataResponse(taskDto) } },
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

  app.get('/tasks/:id', {
    config: { auth: { permission: 'task:read' } },
    schema: { tags: ['tasks'], params: idParams, response: { 200: dataResponse(taskDto) } },
    handler: async (request) => ({
      data: await service.get((await scopeOf(app, request)).scope, request.params.id),
    }),
  });

  app.patch('/tasks/:id', {
    config: { auth: { permission: 'task:update' } },
    schema: {
      tags: ['tasks'],
      params: idParams,
      body: updateTaskBody,
      response: { 200: dataResponse(taskDto) },
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

  app.post('/tasks/:id/complete', {
    config: { auth: { permission: 'task:update' } },
    schema: { tags: ['tasks'], params: idParams, response: { 200: dataResponse(taskDto) } },
    handler: async (request) => {
      const { actor, scope } = await scopeOf(app, request);
      return {
        data: await service.complete(
          scope,
          actorFor(actor.role, actor.id),
          request.params.id,
          auditContext(request),
        ),
      };
    },
  });

  app.delete('/tasks/:id', {
    config: { auth: { permission: 'task:delete' } },
    schema: { tags: ['tasks'], params: idParams, response: { 204: z.null() } },
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
};

export default tasksRoutes;
