import {
  DEFAULT_ENTITLEMENTS,
  LIMITS,
  brandingSettings,
  dataResponse,
  generateBrandPalette,
} from '@crm/shared';
import { createHash } from 'node:crypto';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { LimitReachedError, ValidationError } from '../../lib/errors.js';
import { ipAllowed, normalizeIp } from '../../lib/ip-allowlist.js';
import { auditContext } from '../../lib/request.js';
import { IMAGE_TYPES, storeUpload } from '../../lib/uploads.js';
import {
  publicSettingsSchema,
  settingsPatchSchema,
  settingsResponseSchema,
} from './settings.schema.js';
import { z } from 'zod';

const settingsRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/settings', {
    config: { auth: { permission: 'settings:read' } },
    schema: { tags: ['settings'], response: { 200: dataResponse(settingsResponseSchema) } },
    handler: async () => ({ data: await app.settings.getAll() }),
  });

  /**
   * Whose CRM this is, for the signed-out screens: the customer's name and whether they uploaded a
   * logo. Both are already on show to anyone who signs in, and the sign-in page is where people
   * check they are in the right place, so this answers without a session.
   */
  app.get('/brand', {
    config: { auth: { public: true }, rateLimit: { max: 120, timeWindow: '1 minute' } },
    schema: {
      tags: ['settings'],
      response: {
        200: dataResponse(
          z.object({ name: z.string().nullable(), logoUrl: z.string().nullable() }),
        ),
      },
    },
    handler: async () => {
      const [settings, state] = await Promise.all([
        app.settings.getAll(),
        app.entitlements.getState(),
      ]);
      const name = state.doc.customerName;
      const key = settings.branding.logoKey;
      return {
        data: {
          // The placeholder an unmanaged stack carries is not a name worth printing.
          name: name === DEFAULT_ENTITLEMENTS.customerName ? null : name,
          // The version changes with the key, so a replaced logo is never served from a cache.
          logoUrl:
            key === null
              ? null
              : `/api/v1/brand/logo?v=${createHash('sha256').update(key).digest('hex').slice(0, 12)}`,
        },
      };
    },
  });

  app.get('/brand/logo', {
    config: { auth: { public: true }, rateLimit: { max: 120, timeWindow: '1 minute' } },
    schema: { tags: ['settings'], hide: true },
    handler: async (_request, reply) => {
      const key = (await app.settings.getAll()).branding.logoKey;
      const obj = key === null ? null : await app.storage.get(key);
      if (!obj || !IMAGE_TYPES.has(obj.contentType)) return reply.status(404).send();
      void reply.header('content-type', obj.contentType);
      void reply.header('x-content-type-options', 'nosniff');
      void reply.header('cache-control', 'public, max-age=300');
      if (obj.contentLength !== undefined) void reply.header('content-length', obj.contentLength);
      return reply.send(obj.body);
    },
  });

  /** The address this request came from, as the address lock sees it. */
  app.get('/settings/my-address', {
    config: { auth: { permission: 'settings:manage' } },
    schema: {
      tags: ['settings'],
      response: { 200: dataResponse(z.object({ ip: z.string() })) },
    },
    handler: (request) => Promise.resolve({ data: { ip: normalizeIp(request.ip) } }),
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
          liveCalls: s.liveCalls,
          security: { sessionIdleMinutes: s.security.sessionIdleMinutes },
          recording: {
            consentText: s.recording.consentText,
            allowAgentPlayback: s.recording.allowAgentPlayback,
          },
          branding: s.branding,
          supportContact: s.supportContact,
          timezone: s.timezone,
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
      // Switching the address lock on from an address that is not on the list would lock the
      // person doing it out with everyone else, so it is refused until their own is added.
      const lock = request.body.ipAllowlist;
      if (lock?.enabled === true && !ipAllowed(lock.entries, request.ip)) {
        throw new ValidationError([
          {
            path: 'ipAllowlist',
            message: `Your own address, ${request.ip}, is not on the list. Add it first, or you would be locked out.`,
          },
        ]);
      }
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
      // The picture it replaces goes with it. Anything under branding/ is readable by every signed
      // in user, so a logo somebody thought they had replaced stayed both stored and open.
      if (before.logoKey !== null && before.logoKey !== stored.key) {
        await app.storage.delete(before.logoKey).catch((err: unknown) => {
          request.log.warn({ err, key: before.logoKey }, 'could not remove the replaced logo');
        });
      }
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
      /*
       * Removed means removed. Clearing the key alone left the file in storage and readable by
       * anyone signed in who had the key, which is the wrong answer when the reason somebody is
       * pressing Remove is that they uploaded the wrong picture.
       */
      if (before.logoKey !== null) {
        await app.storage.delete(before.logoKey).catch((err: unknown) => {
          request.log.warn({ err, key: before.logoKey }, 'could not remove the logo object');
        });
      }
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
