import { dataResponse } from '@crm/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { auditContext } from '../../lib/request.js';
import {
  publicSettingsSchema,
  settingsPatchSchema,
  settingsResponseSchema,
} from './settings.schema.js';

const settingsRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/settings', {
    config: { auth: { permission: 'settings:read' } },
    schema: { tags: ['settings'], response: { 200: dataResponse(settingsResponseSchema) } },
    handler: async () => ({ data: await app.settings.getAll() }),
  });

  app.get('/settings/public', {
    config: { auth: { authenticated: true, allowWithout2FA: true } },
    schema: { tags: ['settings'], response: { 200: dataResponse(publicSettingsSchema) } },
    handler: async () => {
      const s = await app.settings.getAll();
      return {
        data: {
          defaultCountry: s.defaultCountry,
          currency: s.currency,
          popup: s.popup,
          security: { sessionIdleMinutes: s.security.sessionIdleMinutes },
          recording: {
            consentText: s.recording.consentText,
            allowAgentPlayback: s.recording.allowAgentPlayback,
          },
        },
      };
    },
  });

  app.patch('/settings', {
    config: { auth: { permission: 'settings:manage' } },
    schema: {
      tags: ['settings'],
      body: settingsPatchSchema,
      response: { 200: dataResponse(settingsResponseSchema) },
    },
    handler: async (request) => {
      const before = await app.settings.getAll();
      const after = await app.settings.patch(request.body, request.user?.id ?? null);
      await app.audit.write(auditContext(request), {
        action: 'settings.update',
        entity: 'settings',
        before: pick(before, request.body),
        after: pick(after, request.body),
      });
      return { data: after };
    },
  });
};

function pick<T extends object>(obj: T, keysFrom: object): Partial<T> {
  const out: Partial<T> = {};
  for (const k of Object.keys(keysFrom) as (keyof T)[]) out[k] = obj[k];
  return out;
}

export default settingsRoutes;
