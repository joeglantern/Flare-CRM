/**
 * Lead-capture web forms (R-7.2.1). Admin CRUD + a public, rate-limited, origin-checked
 * submission endpoint with a honeypot (docs/08 G1).
 */
import {
  createWebFormBody,
  dataResponse,
  idParams,
  publicSubmissionBody,
  updateWebFormBody,
  webFormDto,
  type WebFormDto,
} from '@crm/shared';
import { randomBytes } from 'node:crypto';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { BadRequestError, NotFoundError, ValidationError } from '../../lib/errors.js';
import { newId } from '../../lib/ids.js';
import { auditContext } from '../../lib/request.js';
import { LeadsService } from '../leads/leads.service.js';

function toDto(
  appUrl: string,
  r: {
    id: string;
    name: string;
    token: string;
    fields: unknown;
    allowedOrigins: string[];
    defaultOwnerId: string | null;
    isActive: boolean;
    submissionsCount: number;
    createdAt: Date;
    updatedAt: Date;
  },
): WebFormDto {
  return {
    id: r.id,
    name: r.name,
    token: r.token,
    fields: Array.isArray(r.fields) ? (r.fields as WebFormDto['fields']) : [],
    allowedOrigins: r.allowedOrigins,
    defaultOwnerId: r.defaultOwnerId,
    isActive: r.isActive,
    submissionsCount: r.submissionsCount,
    submitUrl: `${appUrl}/public/forms/${r.token}`,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

export const webFormsRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/web-forms', {
    config: { auth: { permission: 'webform:manage' } },
    schema: { tags: ['web-forms'], response: { 200: dataResponse(z.array(webFormDto)) } },
    handler: async () => ({
      data: (await app.db.webForm.findMany({ orderBy: { createdAt: 'desc' } })).map((r) =>
        toDto(app.config.APP_URL, r),
      ),
    }),
  });

  app.post('/web-forms', {
    config: { auth: { permission: 'webform:manage' } },
    schema: {
      tags: ['web-forms'],
      body: createWebFormBody,
      response: { 201: dataResponse(webFormDto) },
    },
    handler: async (request, reply) => {
      const row = await app.db.webForm.create({
        data: {
          id: newId(),
          name: request.body.name,
          token: randomBytes(24).toString('base64url'),
          fields: request.body.fields,
          allowedOrigins: request.body.allowedOrigins,
          defaultOwnerId: request.body.defaultOwnerId ?? null,
        },
      });
      await app.audit.write(auditContext(request), {
        action: 'webform.create',
        entity: 'web_form',
        entityId: row.id,
        after: { name: row.name },
      });
      return reply.status(201).send({ data: toDto(app.config.APP_URL, row) });
    },
  });

  app.patch('/web-forms/:id', {
    config: { auth: { permission: 'webform:manage' } },
    schema: {
      tags: ['web-forms'],
      params: idParams,
      body: updateWebFormBody,
      response: { 200: dataResponse(webFormDto) },
    },
    handler: async (request) => {
      const before = await app.db.webForm.findUnique({ where: { id: request.params.id } });
      if (!before) throw new NotFoundError('Web form');
      const b = request.body;
      const row = await app.db.webForm.update({
        where: { id: before.id },
        data: {
          ...(b.name !== undefined ? { name: b.name } : {}),
          ...(b.fields !== undefined ? { fields: b.fields } : {}),
          ...(b.allowedOrigins !== undefined ? { allowedOrigins: b.allowedOrigins } : {}),
          ...(b.defaultOwnerId !== undefined ? { defaultOwnerId: b.defaultOwnerId } : {}),
          ...(b.isActive !== undefined ? { isActive: b.isActive } : {}),
        },
      });
      await app.audit.write(auditContext(request), {
        action: 'webform.update',
        entity: 'web_form',
        entityId: row.id,
        after: b,
      });
      return { data: toDto(app.config.APP_URL, row) };
    },
  });

  app.delete('/web-forms/:id', {
    config: { auth: { permission: 'webform:manage' } },
    schema: { tags: ['web-forms'], params: idParams, response: { 204: z.null() } },
    handler: async (request, reply) => {
      const before = await app.db.webForm.findUnique({ where: { id: request.params.id } });
      if (!before) throw new NotFoundError('Web form');
      await app.db.webForm.delete({ where: { id: before.id } });
      await app.audit.write(auditContext(request), {
        action: 'webform.delete',
        entity: 'web_form',
        entityId: before.id,
        before: { name: before.name },
      });
      return reply.status(204).send(null);
    },
  });
};

/** Mounted at the root: POST /public/forms/:token */
export const publicFormsRoutes: FastifyPluginAsyncZod = async (app) => {
  const leads = new LeadsService(app);

  app.post('/public/forms/:token', {
    config: { auth: { public: true }, rateLimit: { max: 5, timeWindow: '1 minute' } },
    schema: {
      tags: ['public'],
      params: z.object({ token: z.string().min(16).max(64) }),
      body: publicSubmissionBody,
      response: { 201: z.object({ ok: z.literal(true) }) },
    },
    handler: async (request, reply) => {
      const form = await app.db.webForm.findFirst({
        where: { token: request.params.token, isActive: true },
      });
      if (!form) throw new NotFoundError('Form');

      const origin = request.headers.origin;
      if (form.allowedOrigins.length > 0) {
        if (!origin || !form.allowedOrigins.includes(origin))
          throw new BadRequestError('Origin not allowed');
        void reply.header('access-control-allow-origin', origin);
        void reply.header('vary', 'Origin');
      }
      // honeypot: bots fill every field
      if (request.body.website) return reply.status(201).send({ ok: true as const });

      const fields = Array.isArray(form.fields)
        ? (form.fields as { key: string; required: boolean }[])
        : [];
      const missing = fields.filter((f) => f.required && !valueFor(request.body, f.key));
      if (missing.length > 0)
        throw new ValidationError(missing.map((f) => ({ path: f.key, message: 'Required' })));
      if (!request.body.phone && !request.body.email)
        throw new ValidationError([
          { path: 'phone', message: 'A phone number or email is required' },
        ]);

      const allowedCustom = new Set(
        fields
          .map((f) => f.key)
          .filter((k) => k.startsWith('cf:'))
          .map((k) => k.slice(3)),
      );
      const customFields = Object.fromEntries(
        Object.entries(request.body.customFields ?? {}).filter(([k]) => allowedCustom.has(k)),
      );

      await leads.createRaw(
        {
          firstName: request.body.firstName ?? 'Web',
          lastName: request.body.lastName ?? null,
          companyName: request.body.companyName ?? null,
          phone: request.body.phone ?? null,
          email: request.body.email ?? null,
          source: 'webform',
          sourceRef: form.id,
          notes: request.body.notes ?? null,
          customFields,
        },
        null,
        form.defaultOwnerId,
        {
          actorId: null,
          actorType: 'system',
          ip: request.ip,
          userAgent: request.headers['user-agent'] ?? null,
          requestId: request.id,
        },
      );
      await app.db.webForm.update({
        where: { id: form.id },
        data: { submissionsCount: { increment: 1 } },
      });
      if (form.defaultOwnerId) {
        await app.notifications.notify({
          userId: form.defaultOwnerId,
          type: 'system',
          title:
            `New web lead: ${request.body.firstName ?? ''} ${request.body.lastName ?? ''}`.trim(),
          body: null,
          data: { url: '/leads' },
        });
      }
      return reply.status(201).send({ ok: true as const });
    },
  });

  // CORS preflight for embedded forms
  app.options('/public/forms/:token', {
    config: { auth: { public: true } },
    schema: { hide: true, params: z.object({ token: z.string() }) },
    handler: async (request, reply) => {
      const form = await app.db.webForm.findFirst({
        where: { token: request.params.token, isActive: true },
        select: { allowedOrigins: true },
      });
      const origin = request.headers.origin;
      if (
        form &&
        origin &&
        (form.allowedOrigins.length === 0 || form.allowedOrigins.includes(origin))
      ) {
        void reply.header('access-control-allow-origin', origin);
        void reply.header('access-control-allow-methods', 'POST, OPTIONS');
        void reply.header('access-control-allow-headers', 'Content-Type');
        void reply.header('access-control-max-age', '600');
        void reply.header('vary', 'Origin');
      }
      return reply.status(204).send();
    },
  });
};

function valueFor(body: Record<string, unknown>, key: string): unknown {
  if (key.startsWith('cf:'))
    return (body.customFields as Record<string, unknown> | undefined)?.[key.slice(3)];
  return body[key];
}
