/**
 * Email and PBX connection details, entered by an admin. Admin only, two-factor required, rate
 * limited, since each save opens a connection to the server named. Passwords and secrets go in
 * and never come back out.
 */
import {
  dataResponse,
  pbxConfigBody,
  pbxStatusDto,
  smtpConfigBody,
  smtpStatusDto,
} from '@crm/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { actorOf, auditContext, requireUser } from '../../lib/request.js';
import { IntegrationsService } from './integrations.service.js';

const manage = { auth: { permission: 'settings:manage' as const, allowWithout2FA: false } };
const limited = { ...manage, rateLimit: { max: 5, timeWindow: '1 minute' } };

const integrationsRoutes: FastifyPluginAsyncZod = async (app) => {
  const service = new IntegrationsService(app);

  app.get('/integrations/smtp', {
    config: manage,
    schema: { tags: ['settings'], response: { 200: dataResponse(smtpStatusDto) } },
    handler: async () => ({ data: await service.smtpStatus() }),
  });

  app.put('/integrations/smtp', {
    config: limited,
    schema: {
      tags: ['settings'],
      body: smtpConfigBody,
      response: { 200: dataResponse(smtpStatusDto) },
    },
    handler: async (request) => ({
      data: await service.saveSmtp(actorOf(request).id, request.body, auditContext(request)),
    }),
  });

  app.post('/integrations/smtp/test', {
    config: limited,
    schema: {
      tags: ['settings'],
      response: { 200: dataResponse(z.object({ sentTo: z.string() })) },
    },
    handler: async (request) => {
      const user = requireUser(request);
      await service.testSmtp({ email: user.email, name: user.name });
      return { data: { sentTo: user.email } };
    },
  });

  app.delete('/integrations/smtp', {
    config: limited,
    schema: { tags: ['settings'], response: { 200: dataResponse(smtpStatusDto) } },
    handler: async (request) => {
      await service.reset('smtp', auditContext(request));
      return { data: await service.smtpStatus() };
    },
  });

  app.get('/integrations/pbx', {
    config: manage,
    schema: { tags: ['settings'], response: { 200: dataResponse(pbxStatusDto) } },
    handler: async () => ({ data: await service.pbxStatus() }),
  });

  app.put('/integrations/pbx', {
    config: limited,
    schema: {
      tags: ['settings'],
      body: pbxConfigBody,
      response: { 200: dataResponse(pbxStatusDto) },
    },
    handler: async (request) => ({
      data: await service.savePbx(actorOf(request).id, request.body, auditContext(request)),
    }),
  });

  app.delete('/integrations/pbx', {
    config: limited,
    schema: { tags: ['settings'], response: { 200: dataResponse(pbxStatusDto) } },
    handler: async (request) => {
      await service.reset('pbx', auditContext(request));
      return { data: await service.pbxStatus() };
    },
  });
};

export default integrationsRoutes;
