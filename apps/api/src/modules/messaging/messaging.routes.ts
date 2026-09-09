import {
  assignConversationBody,
  attachmentDto,
  channelDto,
  conversationDto,
  createChannelBody,
  cursorListResponse,
  dataResponse,
  idParams,
  listConversationsQuery,
  listMessagesQuery,
  messageDto,
  roleHasPermission,
  sendMessageBody,
  startConversationBody,
  updateChannelBody,
  type ChannelDto,
} from '@crm/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { encryptJson } from '../../lib/crypto.js';
import { ConflictError, ForbiddenError, NotFoundError } from '../../lib/errors.js';
import { newId } from '../../lib/ids.js';
import { auditContext, requireUser } from '../../lib/request.js';
import { scopeOf } from '../../lib/scope.js';
import { MAX_UPLOAD_BYTES } from '../../plugins/storage.js';
import { ATTACHMENT_TYPES, storeUpload } from '../../lib/uploads.js';

function channelToDto(r: {
  id: string;
  type: string;
  name: string;
  externalId: string | null;
  config: unknown;
  secretsEncrypted: Uint8Array | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}): ChannelDto {
  return {
    id: r.id,
    type: r.type as ChannelDto['type'],
    name: r.name,
    externalId: r.externalId,
    config: (r.config ?? {}) as Record<string, unknown>,
    hasSecrets: r.secretsEncrypted !== null,
    isActive: r.isActive,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

const messagingRoutes: FastifyPluginAsyncZod = async (app) => {
  const service = app.messaging;
  const actorFor = (request: Parameters<typeof requireUser>[0]) => {
    const u = requireUser(request);
    return {
      id: u.id,
      role: u.role ?? 'agent',
      teamId: u.teamId ?? null,
      canAssign: roleHasPermission(u.role ?? 'agent', 'chat:assign'),
    };
  };

  // ── channels (admin) ─────────────────────────────────────────────────────────────────
  app.get('/channels', {
    config: { auth: { permission: 'chat:read', feature: 'messaging' } },
    schema: { tags: ['messaging'], response: { 200: dataResponse(z.array(channelDto)) } },
    handler: async () => ({
      data: (await app.db.channel.findMany({ orderBy: { createdAt: 'asc' } })).map(channelToDto),
    }),
  });

  app.post('/channels', {
    config: { auth: { permission: 'channel:manage', feature: 'messaging' } },
    schema: {
      tags: ['messaging'],
      body: createChannelBody,
      response: { 201: dataResponse(channelDto) },
    },
    handler: async (request, reply) => {
      const b = request.body;
      if (
        b.externalId &&
        (await app.db.channel.findFirst({ where: { type: b.type, externalId: b.externalId } }))
      )
        throw new ConflictError('A channel with this external id already exists');
      await app.entitlements.assertLimit(
        'channels',
        await app.db.channel.count({ where: { isActive: true } }),
        auditContext(request),
      );
      const row = await app.db.channel.create({
        data: {
          id: newId(),
          type: b.type,
          name: b.name,
          externalId: b.externalId ?? null,
          config: b.config as object,
          ...(b.secrets
            ? { secretsEncrypted: encryptJson(b.secrets, app.config.SECRETS_KEY) }
            : {}),
        },
      });
      await app.audit.write(auditContext(request), {
        action: 'channel.create',
        entity: 'channel',
        entityId: row.id,
        after: { type: b.type, name: b.name, externalId: b.externalId },
      });
      return reply.status(201).send({ data: channelToDto(row) });
    },
  });

  app.patch('/channels/:id', {
    config: { auth: { permission: 'channel:manage', feature: 'messaging' } },
    schema: {
      tags: ['messaging'],
      params: idParams,
      body: updateChannelBody,
      response: { 200: dataResponse(channelDto) },
    },
    handler: async (request) => {
      const before = await app.db.channel.findUnique({ where: { id: request.params.id } });
      if (!before) throw new NotFoundError('Channel');
      const b = request.body;
      if (b.isActive === true) {
        await app.entitlements.assertLimit(
          'channels',
          await app.db.channel.count({ where: { isActive: true, id: { not: request.params.id } } }),
          auditContext(request),
        );
      }
      const row = await app.db.channel.update({
        where: { id: before.id },
        data: {
          ...(b.name !== undefined ? { name: b.name } : {}),
          ...(b.externalId !== undefined ? { externalId: b.externalId } : {}),
          ...(b.config !== undefined ? { config: b.config as object } : {}),
          ...(b.secrets !== undefined
            ? { secretsEncrypted: encryptJson(b.secrets, app.config.SECRETS_KEY) }
            : {}),
          ...(b.isActive !== undefined ? { isActive: b.isActive } : {}),
        },
      });
      await app.audit.write(auditContext(request), {
        action: 'channel.update',
        entity: 'channel',
        entityId: row.id,
        after: { name: b.name, isActive: b.isActive, secretsRotated: b.secrets !== undefined },
      });
      return { data: channelToDto(row) };
    },
  });

  // ── conversations ────────────────────────────────────────────────────────────────────
  app.get('/conversations', {
    config: { auth: { permission: 'chat:read', feature: 'messaging' } },
    schema: {
      tags: ['messaging'],
      querystring: listConversationsQuery,
      response: { 200: cursorListResponse(conversationDto) },
    },
    handler: async (request) => {
      const { actor, scope } = await scopeOf(app, request);
      return service.list(scope, actor.id, request.query);
    },
  });

  app.post('/conversations', {
    config: { auth: { permission: 'chat:send', feature: 'messaging' } },
    schema: {
      tags: ['messaging'],
      body: startConversationBody,
      response: { 201: dataResponse(conversationDto) },
    },
    handler: async (request, reply) => {
      const { scope } = await scopeOf(app, request);
      return reply.status(201).send({
        data: await service.start(scope, actorFor(request), request.body, auditContext(request)),
      });
    },
  });

  app.get('/conversations/:id', {
    config: { auth: { permission: 'chat:read', feature: 'messaging' } },
    schema: {
      tags: ['messaging'],
      params: idParams,
      response: { 200: dataResponse(conversationDto) },
    },
    handler: async (request) => ({
      data: service.conversationToDto(
        await service.getVisible((await scopeOf(app, request)).scope, request.params.id),
      ),
    }),
  });

  app.get('/conversations/:id/messages', {
    config: { auth: { permission: 'chat:read', feature: 'messaging' } },
    schema: {
      tags: ['messaging'],
      params: idParams,
      querystring: listMessagesQuery,
      response: { 200: cursorListResponse(messageDto) },
    },
    handler: async (request) =>
      service.messages((await scopeOf(app, request)).scope, request.params.id, request.query),
  });

  app.post('/conversations/:id/messages', {
    config: {
      auth: { permission: 'chat:send', feature: 'messaging' },
      rateLimit: { max: 60, timeWindow: '1 minute' },
    },
    schema: {
      tags: ['messaging'],
      params: idParams,
      body: sendMessageBody,
      response: { 202: dataResponse(messageDto) },
    },
    handler: async (request, reply) => {
      const { scope } = await scopeOf(app, request);
      return reply.status(202).send({
        data: await service.send(
          scope,
          actorFor(request),
          request.params.id,
          request.body,
          auditContext(request),
        ),
      });
    },
  });

  app.post('/conversations/:id/read', {
    config: { auth: { permission: 'chat:read', feature: 'messaging' } },
    schema: {
      tags: ['messaging'],
      params: idParams,
      response: { 200: dataResponse(conversationDto) },
    },
    handler: async (request) => ({
      data: await service.markRead((await scopeOf(app, request)).scope, request.params.id),
    }),
  });

  app.post('/conversations/:id/assign', {
    config: { auth: { permission: 'chat:read', feature: 'messaging' } },
    schema: {
      tags: ['messaging'],
      params: idParams,
      body: assignConversationBody,
      response: { 200: dataResponse(conversationDto) },
    },
    handler: async (request) => {
      const { scope } = await scopeOf(app, request);
      return {
        data: await service.assign(
          scope,
          actorFor(request),
          request.params.id,
          request.body.assigneeId,
          auditContext(request),
        ),
      };
    },
  });

  for (const status of ['close', 'reopen', 'archive'] as const) {
    app.post(`/conversations/:id/${status}`, {
      config: { auth: { permission: 'chat:close', feature: 'messaging' } },
      schema: {
        tags: ['messaging'],
        params: idParams,
        response: { 200: dataResponse(conversationDto) },
      },
      handler: async (request) => {
        const { scope } = await scopeOf(app, request);
        const target = status === 'close' ? 'closed' : status === 'reopen' ? 'open' : 'archived';
        return {
          data: await service.setStatus(
            scope,
            actorFor(request),
            request.params.id,
            target,
            auditContext(request),
          ),
        };
      },
    });
  }

  // ── attachments (upload before send) ─────────────────────────────────────────────────
  // Shared by chat and by notes, so it asks for either right rather than one. An upload is inert
  // until something binds it: it belongs to nothing and is readable only by those two rights.
  app.post('/attachments', {
    config: { auth: { authenticated: true }, rateLimit: { max: 30, timeWindow: '1 minute' } },
    schema: { tags: ['messaging'], response: { 201: dataResponse(attachmentDto) } },
    handler: async (request, reply) => {
      const user = requireUser(request);
      const role = user.role ?? 'agent';
      if (!roleHasPermission(role, 'chat:send') && !roleHasPermission(role, 'note:create'))
        throw new ForbiddenError('Insufficient permissions');
      const file = await request.file();
      const stored = await storeUpload(app.storage, file, {
        prefix: 'attachments',
        allowed: ATTACHMENT_TYPES,
        maxBytes: MAX_UPLOAD_BYTES,
        beforeStore: (bytes) => app.entitlements.assertStorage(bytes, auditContext(request)),
      });
      await app.storageUsage.add('attachments', stored.size);
      const row = await app.db.attachment.create({
        data: {
          id: newId(),
          key: stored.key,
          fileName: stored.fileName,
          mimeType: stored.mimeType,
          sizeBytes: BigInt(stored.size),
          sha256: stored.sha256,
          uploadedById: user.id,
        },
      });
      return reply.status(201).send({
        data: {
          id: row.id,
          fileName: row.fileName,
          mimeType: row.mimeType,
          sizeBytes: Number(row.sizeBytes),
          url: `/api/v1/files/${encodeURIComponent(row.key)}`,
        },
      });
    },
  });
};

export default messagingRoutes;
