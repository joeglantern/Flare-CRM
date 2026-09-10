/**
 * What the console draws its dashboard from (docs/21 §8).
 *
 * Read-only, three endpoints, and every one of them hands back a shape defined in
 * `@crm/shared/console-analytics` so the client and the server cannot drift. The aggregation all
 * happens in the service; these are the permission check and the validation.
 */
import {
  analyticsRange,
  consoleOverviewDto,
  customerAnalyticsDto,
  dataResponse,
  revenueAnalyticsDto,
} from '@crm/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { NotFoundError } from '../lib/errors.js';

const analyticsRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/analytics/overview', {
    config: { auth: { permission: 'analytics:read' } },
    schema: {
      tags: ['console'],
      querystring: analyticsRange,
      response: { 200: dataResponse(consoleOverviewDto) },
    },
    handler: async (request) => ({ data: await app.analytics.overview(request.query.days) }),
  });

  app.get('/analytics/customers/:id', {
    config: { auth: { permission: 'analytics:read' } },
    schema: {
      tags: ['console'],
      params: z.object({ id: z.uuid() }),
      querystring: analyticsRange,
      response: { 200: dataResponse(customerAnalyticsDto) },
    },
    handler: async (request) => {
      const exists = await app.db.customer.findUnique({
        where: { id: request.params.id },
        select: { id: true },
      });
      if (!exists) throw new NotFoundError('Customer');
      return { data: await app.analytics.customer(request.params.id, request.query.days) };
    },
  });

  app.get('/analytics/revenue', {
    config: { auth: { permission: 'analytics:read' } },
    schema: {
      tags: ['console'],
      querystring: z.object({ months: z.coerce.number().int().min(1).max(36).default(12) }),
      response: { 200: dataResponse(revenueAnalyticsDto) },
    },
    handler: async (request) => ({ data: await app.analytics.revenue(request.query.months) }),
  });
};

export default analyticsRoutes;
