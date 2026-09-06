import {
  createUserBody,
  dataResponse,
  idParams,
  listUsersQuery,
  meDto,
  offsetListResponse,
  setRoleBody,
  updateMeBody,
  updateUserBody,
  userDto,
} from '@crm/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { auditContext, requireUser } from '../../lib/request.js';
import { IMAGE_TYPES, storeUpload } from '../../lib/uploads.js';
import { UsersService } from './users.service.js';

const usersRoutes: FastifyPluginAsyncZod = async (app) => {
  const service = new UsersService({
    db: app.db,
    auth: app.auth,
    valkey: app.valkey,
    audit: app.audit,
    settings: app.settings,
    storage: app.storage,
    appUrl: app.config.APP_URL,
    avatarUrl: (key) => (key ? `/api/v1/files/${encodeURIComponent(key)}` : null),
  });

  app.get('/users/me', {
    config: { auth: { authenticated: true, allowWithout2FA: true } },
    schema: { tags: ['users'], response: { 200: dataResponse(meDto) } },
    handler: async (request) => ({ data: await service.me(requireUser(request).id) }),
  });

  app.patch('/users/me', {
    config: { auth: { authenticated: true, allowWithout2FA: true } },
    schema: { tags: ['users'], body: updateMeBody, response: { 200: dataResponse(meDto) } },
    handler: async (request) => ({
      data: await service.updateMe(requireUser(request).id, request.body, auditContext(request)),
    }),
  });

  app.post('/users/me/avatar', {
    config: {
      auth: { authenticated: true, allowWithout2FA: true },
      rateLimit: { max: 10, timeWindow: '1 minute' },
    },
    schema: { tags: ['users'], response: { 200: dataResponse(meDto) } },
    handler: async (request) => {
      const file = await request.file();
      const stored = await storeUpload(app.storage, file, {
        prefix: 'avatars',
        allowed: IMAGE_TYPES,
        maxBytes: 5 * 1024 * 1024,
      });
      return {
        data: await service.setAvatar(requireUser(request).id, stored.key, auditContext(request)),
      };
    },
  });

  app.delete('/users/me/avatar', {
    config: { auth: { authenticated: true, allowWithout2FA: true } },
    schema: { tags: ['users'], response: { 200: dataResponse(meDto) } },
    handler: async (request) => ({
      data: await service.setAvatar(requireUser(request).id, null, auditContext(request)),
    }),
  });

  app.get('/users', {
    config: { auth: { permission: 'user:list' } },
    schema: {
      tags: ['users'],
      querystring: listUsersQuery,
      response: { 200: offsetListResponse(userDto) },
    },
    handler: async (request) => service.list(request.query),
  });

  app.post('/users', {
    config: { auth: { permission: 'user:create' } },
    schema: { tags: ['users'], body: createUserBody, response: { 201: dataResponse(userDto) } },
    handler: async (request, reply) => {
      const user = await service.create(request.body, request.headers, auditContext(request));
      return reply.status(201).send({ data: user });
    },
  });

  app.get('/users/:id', {
    config: { auth: { permission: 'user:list' } },
    schema: { tags: ['users'], params: idParams, response: { 200: dataResponse(userDto) } },
    handler: async (request) => ({ data: await service.get(request.params.id) }),
  });

  app.patch('/users/:id', {
    config: { auth: { permission: 'user:update' } },
    schema: {
      tags: ['users'],
      params: idParams,
      body: updateUserBody,
      response: { 200: dataResponse(userDto) },
    },
    handler: async (request) => ({
      data: await service.update(request.params.id, request.body, auditContext(request)),
    }),
  });

  app.post('/users/:id/role', {
    config: { auth: { permission: 'user:set-role' } },
    schema: {
      tags: ['users'],
      params: idParams,
      body: setRoleBody,
      response: { 200: dataResponse(userDto) },
    },
    handler: async (request) => ({
      data: await service.setRole(
        request.params.id,
        request.body.role,
        request.headers,
        auditContext(request),
      ),
    }),
  });

  app.post('/users/:id/deactivate', {
    config: { auth: { permission: 'user:update' } },
    schema: { tags: ['users'], params: idParams, response: { 200: dataResponse(userDto) } },
    handler: async (request) => ({
      data: await service.setActive(
        request.params.id,
        false,
        request.headers,
        auditContext(request),
      ),
    }),
  });

  app.post('/users/:id/reactivate', {
    config: { auth: { permission: 'user:update' } },
    schema: { tags: ['users'], params: idParams, response: { 200: dataResponse(userDto) } },
    handler: async (request) => ({
      data: await service.setActive(
        request.params.id,
        true,
        request.headers,
        auditContext(request),
      ),
    }),
  });

  app.post('/users/:id/sessions/revoke', {
    config: { auth: { permission: 'session:revoke' } },
    schema: { tags: ['users'], params: idParams, response: { 204: z.null() } },
    handler: async (request, reply) => {
      await service.revokeSessions(request.params.id, request.headers, auditContext(request));
      return reply.status(204).send(null);
    },
  });
};

export default usersRoutes;
