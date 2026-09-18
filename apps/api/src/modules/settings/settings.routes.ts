import { LIMITS, brandingSettings, dataResponse, generateBrandPalette } from '@crm/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { LimitReachedError } from '../../lib/errors.js';
import { auditContext } from '../../lib/request.js';
import { IMAGE_TYPES, storeUpload } from '../../lib/uploads.js';
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
          branding: s.branding,
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
      const requestedRetention = request.body.recording?.retentionDays;
      if (requestedRetention !== undefined) {
        const max = await app.entitlements.limit('recording_retention_days');
        if (max !== null && requestedRetention > max) {
          throw new LimitReachedError(
            'recording_retention_days',
            LIMITS.recording_retention_days.label,
            requestedRetention,
            max,
          );
        }
      }
      /*
       * The palette is derived here, from the accent, whatever the browser sent.
       *
       * It arrived as data and was stored after a shape check, which made every contrast guarantee
       * in `generateBrandPalette` a promise the browser had to keep. A tab opened before a fix
       * deployed still runs the old generator and its palette would be accepted, and a hand-written
       * request could store any colours at all. Deriving it server side also means the palette can
       * never disagree with the accent it is supposed to come from.
       */
      const body =
        request.body.branding === undefined
          ? request.body
          : {
              ...request.body,
              branding: {
                ...request.body.branding,
                palette:
                  request.body.branding.accent === null
                    ? null
                    : generateBrandPalette(request.body.branding.accent),
              },
            };

      const before = await app.settings.getAll();
      const after = await app.settings.patch(body, request.user?.id ?? null);
      await app.audit.write(auditContext(request), {
        action: 'settings.update',
        entity: 'settings',
        before: pick(before, request.body),
        after: pick(after, request.body),
      });
      return { data: after };
    },
  });

  /**
   * The customer's logo, which the sidebar shows in place of the Flare wordmark.
   *
   * Stored like any other upload and referenced by key; the colours derived from it are chosen in
   * the browser and saved through `PATCH /settings`, because picking an accent is a judgement
   * somebody makes by looking at it rather than something a server should decide.
   */
  app.post('/settings/branding/logo', {
    config: {
      auth: { permission: 'settings:manage' },
      rateLimit: { max: 10, timeWindow: '1 minute' },
    },
    schema: { tags: ['settings'], response: { 200: dataResponse(brandingSettings) } },
    handler: async (request) => {
      const file = await request.file();
      const stored = await storeUpload(app.storage, file, {
        prefix: 'branding',
        allowed: IMAGE_TYPES,
        maxBytes: 4 * 1024 * 1024,
        beforeStore: (bytes) => app.entitlements.assertStorage(bytes, auditContext(request)),
      });
      const before = (await app.settings.getAll()).branding;
      const after = await app.settings.patch(
        { branding: { ...before, logoKey: stored.key } },
        request.user?.id ?? null,
      );
      await app.audit.write(auditContext(request), {
        action: 'settings.update',
        entity: 'settings',
        before: { branding: { logoKey: before.logoKey } },
        after: { branding: { logoKey: stored.key } },
      });
      return { data: after.branding };
    },
  });

  app.delete('/settings/branding/logo', {
    config: { auth: { permission: 'settings:manage' } },
    schema: { tags: ['settings'], response: { 200: dataResponse(brandingSettings) } },
    handler: async (request) => {
      const before = (await app.settings.getAll()).branding;
      const after = await app.settings.patch(
        { branding: { ...before, logoKey: null } },
        request.user?.id ?? null,
      );
      await app.audit.write(auditContext(request), {
        action: 'settings.update',
        entity: 'settings',
        before: { branding: { logoKey: before.logoKey } },
        after: { branding: { logoKey: null } },
      });
      return { data: after.branding };
    },
  });
};

function pick<T extends object>(obj: T, keysFrom: object): Partial<T> {
  const out: Partial<T> = {};
  for (const k of Object.keys(keysFrom) as (keyof T)[]) out[k] = obj[k];
  return out;
}

export default settingsRoutes;
