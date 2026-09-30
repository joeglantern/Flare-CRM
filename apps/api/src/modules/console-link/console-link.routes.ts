/**
 * The owner console link, entered by an admin (docs/21 section 4). Admin only, two-factor required,
 * rate limited. The stack secret is accepted here and never sent back out.
 */
import { consoleLinkEnrollBody, consoleLinkStatusDto, dataResponse } from '@crm/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { actorOf, auditContext } from '../../lib/request.js';
import { ConsoleLinkService } from './console-link.service.js';

const consoleLinkRoutes: FastifyPluginAsyncZod = async (app) => {
  const service = new ConsoleLinkService(app);

  app.get('/console-link', {
    config: { auth: { permission: 'settings:manage', allowWithout2FA: false } },
    schema: { tags: ['entitlements'], response: { 200: dataResponse(consoleLinkStatusDto) } },
    handler: async () => ({ data: await service.status() }),
  });

  app.put('/console-link', {
    config: {
      auth: { permission: 'settings:manage', allowWithout2FA: false },
      rateLimit: { max: 5, timeWindow: '1 minute' },
    },
    schema: {
      tags: ['entitlements'],
      body: consoleLinkEnrollBody,
      response: { 200: dataResponse(consoleLinkStatusDto) },
    },
    handler: async (request) => ({
      data: await service.enroll(actorOf(request).id, request.body, auditContext(request)),
    }),
  });
};

export default consoleLinkRoutes;
