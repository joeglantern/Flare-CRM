import {
  callControlBody,
  callDispositionDto,
  callDto,
  createDispositionBody,
  ctiCapabilitiesDto,
  ctiStatusDto,
  dataResponse,
  dialBody,
  dialResult,
  dispositionBody,
  idParams,
  linkContactBody,
  linkusSignDto,
  listCallsQuery,
  liveCallDto,
  offsetListResponse,
  reconcileBody,
  reconcileResult,
  updateDispositionBody,
} from '@crm/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { lastReconcileAt, reconcileCdrs } from '../../integrations/yeastar/reconcile.js';
import { readCtiStatus } from '../../integrations/yeastar/subscriber.js';
import { ConflictError, NotFoundError, PbxUnavailableError } from '../../lib/errors.js';
import { newId } from '../../lib/ids.js';
import { auditContext, requireUser } from '../../lib/request.js';
import { scopeOf } from '../../lib/scope.js';
import { CallsService } from './calls.service.js';

const callsRoutes: FastifyPluginAsyncZod = async (app) => {
  const service = new CallsService(app);
  const actorOf = (request: Parameters<typeof requireUser>[0]) => {
    const u = requireUser(request);
    return { id: u.id, role: u.role ?? 'agent', extension: u.extension ?? null };
  };

  app.get('/calls', {
    config: { auth: { permission: 'call:read' } },
    schema: {
      tags: ['calls'],
      querystring: listCallsQuery,
      response: { 200: offsetListResponse(callDto) },
    },
    handler: async (request) => {
      const { actor, scope } = await scopeOf(app, request);
      return service.list(scope, actor.id, request.query);
    },
  });

  app.post('/calls/dial', {
    config: { auth: { permission: 'call:dial' }, rateLimit: { max: 10, timeWindow: '1 minute' } },
    schema: { tags: ['calls'], body: dialBody, response: { 202: dataResponse(dialResult) } },
    handler: async (request, reply) => {
      const { scope } = await scopeOf(app, request);
      const result = await service.dial(
        scope,
        actorOf(request),
        request.body,
        auditContext(request),
      );
      return reply.status(202).send({ data: result });
    },
  });

  app.get('/calls/:id', {
    config: { auth: { permission: 'call:read' } },
    schema: { tags: ['calls'], params: idParams, response: { 200: dataResponse(callDto) } },
    handler: async (request) => ({
      data: await service.get((await scopeOf(app, request)).scope, request.params.id),
    }),
  });

  app.patch('/calls/:id/disposition', {
    config: { auth: { permission: 'call:set_disposition' } },
    schema: {
      tags: ['calls'],
      params: idParams,
      body: dispositionBody,
      response: { 200: dataResponse(callDto) },
    },
    handler: async (request) => {
      const { scope } = await scopeOf(app, request);
      return {
        data: await service.setDisposition(
          scope,
          actorOf(request),
          request.params.id,
          request.body,
          auditContext(request),
        ),
      };
    },
  });

  app.post('/calls/:id/link-contact', {
    config: { auth: { permission: 'call:read' } },
    schema: {
      tags: ['calls'],
      params: idParams,
      body: linkContactBody,
      response: { 200: dataResponse(callDto) },
    },
    handler: async (request) => {
      const { scope } = await scopeOf(app, request);
      return {
        data: await service.linkContact(
          scope,
          request.params.id,
          request.body.contactId,
          auditContext(request),
        ),
      };
    },
  });

  app.post('/calls/:id/control', {
    config: {
      auth: { permission: 'call:control' },
      rateLimit: { max: 60, timeWindow: '1 minute' },
    },
    schema: {
      tags: ['calls'],
      params: idParams,
      body: callControlBody,
      response: { 200: dataResponse(z.object({ ok: z.literal(true) })) },
    },
    handler: async (request) => {
      const { scope } = await scopeOf(app, request);
      return {
        data: await service.control(
          scope,
          actorOf(request),
          request.params.id,
          request.body,
          auditContext(request),
        ),
      };
    },
  });

  app.get('/calls/:id/recording', {
    config: { auth: { permission: 'call:listen_recording' } },
    schema: { tags: ['calls'], params: idParams, hide: true },
    handler: async (request, reply) => {
      const { scope } = await scopeOf(app, request);
      const { key, fileName } = await service.recordingAccess(
        scope,
        actorOf(request),
        request.params.id,
        auditContext(request),
      );
      const presigned = await app.storage.presignGet(key, 300, fileName);
      if (presigned) return reply.send({ data: { url: presigned, expiresInSec: 300 } });
      const range = typeof request.headers.range === 'string' ? request.headers.range : undefined;
      const obj = await app.storage.get(key, range);
      if (!obj) throw new NotFoundError('Recording');
      void reply.header('content-type', obj.contentType);
      void reply.header('accept-ranges', 'bytes');
      void reply.header('cache-control', 'private, no-store');
      void reply.header('x-content-type-options', 'nosniff');
      void reply.header(
        'content-disposition',
        `inline; filename="${fileName.replace(/["\r\n]/g, '')}"`,
      );
      if (obj.contentLength !== undefined) void reply.header('content-length', obj.contentLength);
      if (obj.contentRange) {
        void reply.header('content-range', obj.contentRange);
        void reply.status(206);
      }
      return reply.send(obj.body);
    },
  });

  app.delete('/calls/:id/recording', {
    config: { auth: { permission: 'call:delete_recording' } },
    schema: { tags: ['calls'], params: idParams, response: { 204: z.null() } },
    handler: async (request, reply) => {
      await service.deleteRecording(
        (await scopeOf(app, request)).scope,
        request.params.id,
        auditContext(request),
      );
      return reply.status(204).send(null);
    },
  });

  // ── dispositions ─────────────────────────────────────────────────────────────────────

  app.get('/call-dispositions', {
    config: { auth: { authenticated: true } },
    schema: {
      tags: ['calls'],
      querystring: z.object({ includeInactive: z.enum(['true', 'false']).optional() }),
      response: { 200: dataResponse(z.array(callDispositionDto)) },
    },
    handler: async (request) => ({
      data: await app.db.callDisposition.findMany({
        where: request.query.includeInactive === 'true' ? {} : { isActive: true },
        orderBy: { sortOrder: 'asc' },
      }),
    }),
  });

  app.post('/call-dispositions', {
    config: { auth: { permission: 'pipeline:manage' } },
    schema: {
      tags: ['calls'],
      body: createDispositionBody,
      response: { 201: dataResponse(callDispositionDto) },
    },
    handler: async (request, reply) => {
      if (await app.db.callDisposition.findUnique({ where: { name: request.body.name } }))
        throw new ConflictError('Disposition already exists');
      const max = await app.db.callDisposition.aggregate({ _max: { sortOrder: true } });
      const row = await app.db.callDisposition.create({
        data: { id: newId(), name: request.body.name, sortOrder: (max._max.sortOrder ?? -1) + 1 },
      });
      await app.audit.write(auditContext(request), {
        action: 'disposition.create',
        entity: 'call_disposition',
        entityId: row.id,
        after: row,
      });
      return reply.status(201).send({ data: row });
    },
  });

  app.patch('/call-dispositions/:id', {
    config: { auth: { permission: 'pipeline:manage' } },
    schema: {
      tags: ['calls'],
      params: idParams,
      body: updateDispositionBody,
      response: { 200: dataResponse(callDispositionDto) },
    },
    handler: async (request) => {
      const before = await app.db.callDisposition.findUnique({ where: { id: request.params.id } });
      if (!before) throw new NotFoundError('Disposition');
      const row = await app.db.callDisposition.update({
        where: { id: before.id },
        data: {
          ...(request.body.name !== undefined ? { name: request.body.name } : {}),
          ...(request.body.isActive !== undefined ? { isActive: request.body.isActive } : {}),
          ...(request.body.sortOrder !== undefined ? { sortOrder: request.body.sortOrder } : {}),
        },
      });
      await app.audit.write(auditContext(request), {
        action: 'disposition.update',
        entity: 'call_disposition',
        entityId: row.id,
        before,
        after: row,
      });
      return { data: row };
    },
  });

  app.delete('/call-dispositions/:id', {
    config: { auth: { permission: 'pipeline:manage' } },
    schema: { tags: ['calls'], params: idParams, response: { 204: z.null() } },
    handler: async (request, reply) => {
      const before = await app.db.callDisposition.findUnique({ where: { id: request.params.id } });
      if (!before) throw new NotFoundError('Disposition');
      if (before.isSystem) throw new ConflictError('System dispositions can only be deactivated');
      const used = await app.db.call.count({ where: { dispositionId: before.id } });
      if (used > 0)
        await app.db.callDisposition.update({
          where: { id: before.id },
          data: { isActive: false },
        });
      else await app.db.callDisposition.delete({ where: { id: before.id } });
      return reply.status(204).send(null);
    },
  });

  // ── CTI status & tools ───────────────────────────────────────────────────────────────

  app.get('/cti/capabilities', {
    config: { auth: { authenticated: true, allowWithout2FA: true } },
    schema: { tags: ['cti'], response: { 200: dataResponse(ctiCapabilitiesDto) } },
    handler: async (request) => {
      const user = requireUser(request);
      const caps = await app.cti.capabilities();
      return {
        data: {
          enabled: app.cti.enabled,
          ...caps,
          dial: app.cti.enabled && Boolean(user.extension),
          myExtension: user.extension ?? null,
        },
      };
    },
  });

  app.get('/cti/status', {
    config: { auth: { permission: 'pbx:view_status' } },
    schema: { tags: ['cti'], response: { 200: dataResponse(ctiStatusDto) } },
    handler: async () => {
      const status = await readCtiStatus(app.valkey);
      const token = await app.cti.tokens?.read();
      const live = await app.cti.machine.liveCalls();
      return {
        data: {
          enabled: app.cti.enabled,
          connected: status.connected,
          leader: status.leader,
          since: status.since,
          lastEventAt: status.lastEventAt,
          tokenExpiresAt: token ? new Date(token.accessExpiresAt).toISOString() : null,
          lastReconcileAt: await lastReconcileAt(app.valkey),
          eventSource: app.config.YEASTAR_EVENT_SOURCE,
          liveCalls: live.length,
        },
      };
    },
  });

  app.get('/cti/live-calls', {
    config: { auth: { permission: 'pbx:view_status' } },
    schema: { tags: ['cti'], response: { 200: dataResponse(z.array(liveCallDto)) } },
    handler: async () => {
      const live = await app.cti.machine.liveCalls();
      const exts = [
        ...new Set(
          live
            .flatMap((c) => [c.answeredExtension, c.ringingExtensions[0]])
            .filter((v): v is string => Boolean(v)),
        ),
      ];
      const users = exts.length
        ? await app.db.user.findMany({
            where: { extension: { in: exts } },
            select: { extension: true, name: true },
          })
        : [];
      const names = new Map(users.map((u) => [u.extension, u.name]));
      return {
        data: live.map((c) => {
          const ext = c.answeredExtension ?? c.ringingExtensions[0] ?? null;
          return {
            pbxCallId: c.pbxCallId,
            callId: c.crmCallId,
            direction: c.direction,
            external: c.externalE164 ?? c.externalRaw,
            extension: ext,
            userName: ext ? (names.get(ext) ?? null) : null,
            contactName: c.contactName,
            status: c.ended ? 'ended' : c.answeredExtension ? 'talking' : 'ringing',
            since: c.firstEventAt,
          };
        }),
      };
    },
  });

  app.post('/cti/reconcile', {
    config: {
      auth: { permission: 'pbx:reconcile' },
      rateLimit: { max: 5, timeWindow: '1 minute' },
    },
    schema: {
      tags: ['cti'],
      body: reconcileBody.optional(),
      response: { 200: dataResponse(reconcileResult) },
    },
    handler: async (request) => {
      if (!app.cti.enabled || !app.cti.client)
        throw new PbxUnavailableError('Telephony integration is not enabled');
      const result = await reconcileCdrs(
        {
          client: app.cti.client,
          machine: app.cti.machine,
          valkey: app.valkey,
          pbxTimeZone: app.config.YEASTAR_TIMEZONE,
          log: app.log,
        },
        request.body?.since ? new Date(request.body.since) : undefined,
      );
      await app.audit.write(auditContext(request), {
        action: 'pbx.reconcile',
        entity: 'pbx',
        after: result,
      });
      return { data: result };
    },
  });

  app.post('/cti/linkus-sign', {
    config: { auth: { permission: 'call:webrtc' }, rateLimit: { max: 10, timeWindow: '1 minute' } },
    schema: { tags: ['cti'], response: { 200: dataResponse(linkusSignDto) } },
    handler: async (request) => {
      const user = requireUser(request);
      if (!app.config.LINKUS_SDK_ENABLED || !app.cti.client)
        throw new PbxUnavailableError('Linkus SDK is not enabled');
      if (!user.extension) throw new ConflictError('Your account has no PBX extension assigned');
      const res = await app.cti.client.linkusSign({
        username: user.extension,
        sign_type: 'sdk',
        expire_time: 3600,
      });
      const sign = res.data?.sign ?? res.sign;
      if (!sign) throw new PbxUnavailableError('PBX did not return a sign');
      await app.audit.write(auditContext(request), {
        action: 'cti.linkus_sign',
        entity: 'user',
        entityId: user.id,
      });
      return {
        data: {
          sign,
          username: user.extension,
          pbxUrl: app.config.YEASTAR_BASE_URL ?? '',
          expiresInSec: 3600,
        },
      };
    },
  });
};

export default callsRoutes;
