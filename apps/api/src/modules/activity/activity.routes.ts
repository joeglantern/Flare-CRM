import { activityDto, cursorListResponse, timelineQuery } from '@crm/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { scopeOf } from '../../lib/scope.js';

const activityRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/activity', {
    config: { auth: { permission: 'contact:read' } },
    schema: {
      tags: ['activity'],
      querystring: timelineQuery,
      response: { 200: cursorListResponse(activityDto) },
    },
    handler: async (request) =>
      app.activity.timeline((await scopeOf(app, request)).scope, request.query),
  });
};

export default activityRoutes;
