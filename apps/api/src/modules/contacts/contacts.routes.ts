import {
  activityDto,
  bulkContactsBody,
  bulkResult,
  contactDto,
  contactSummaryDto,
  createContactBody,
  cursorListResponse,
  dataResponse,
  duplicateMatch,
  duplicatesQuery,
  emailInputItem,
  idParams,
  listContactsQuery,
  mergeContactsBody,
  offsetListResponse,
  phoneInputItem,
  roleHasPermission,
  timelineQuery,
  updateContactBody,
  uuid,
} from '@crm/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { auditContext } from '../../lib/request.js';
import { scopeOf } from '../../lib/scope.js';
import { IMAGE_TYPES, storeUpload } from '../../lib/uploads.js';
import { ContactsService } from './contacts.service.js';

const phoneParams = z.object({ id: uuid, phoneId: uuid });
const emailParams = z.object({ id: uuid, emailId: uuid });
const updatePhoneBody = z
  .object({
    type: z.enum(['mobile', 'work', 'home', 'other']).optional(),
    isPrimary: z.literal(true).optional(),
  })
  .strict();

const contactsRoutes: FastifyPluginAsyncZod = async (app) => {
  const service = new ContactsService(app);
  const actorFor = (role: string, id: string) => ({
    id,
    canAssign: roleHasPermission(role, 'contact:assign'),
  });

  app.get('/contacts', {
    config: { auth: { permission: 'contact:read' } },
    schema: {
      tags: ['contacts'],
      querystring: listContactsQuery,
      response: { 200: offsetListResponse(contactSummaryDto) },
    },
    handler: async (request) => {
      const { scope } = await scopeOf(app, request);
      return service.list(scope, request.query);
    },
  });

  app.get('/contacts/duplicates', {
    config: { auth: { permission: 'contact:read' } },
    schema: {
      tags: ['contacts'],
      querystring: duplicatesQuery,
      response: { 200: dataResponse(z.array(duplicateMatch)) },
    },
    handler: async (request) => ({ data: await service.duplicatesQuery(request.query) }),
  });

  app.post('/contacts', {
    config: { auth: { permission: 'contact:create' } },
    schema: {
      tags: ['contacts'],
      body: createContactBody,
      response: { 201: dataResponse(contactDto) },
    },
    handler: async (request, reply) => {
      const { actor, scope } = await scopeOf(app, request);
      const dto = await service.create(
        scope,
        actorFor(actor.role, actor.id),
        request.body,
        auditContext(request),
      );
      return reply.status(201).send({ data: dto });
    },
  });

  app.post('/contacts/bulk', {
    config: { auth: { permission: 'contact:update' } },
    schema: {
      tags: ['contacts'],
      body: bulkContactsBody,
      response: { 200: dataResponse(bulkResult) },
    },
    handler: async (request) => {
      const { actor, scope } = await scopeOf(app, request);
      if (request.body.action === 'delete' && !roleHasPermission(actor.role, 'contact:delete')) {
        return { data: { affected: 0, skipped: request.body.ids } };
      }
      return {
        data: await service.bulk(
          scope,
          actorFor(actor.role, actor.id),
          request.body,
          auditContext(request),
        ),
      };
    },
  });

  app.get('/contacts/:id', {
    config: { auth: { permission: 'contact:read' } },
    schema: { tags: ['contacts'], params: idParams, response: { 200: dataResponse(contactDto) } },
    handler: async (request) => {
      const { scope } = await scopeOf(app, request);
      return { data: await service.get(scope, request.params.id) };
    },
  });

  app.patch('/contacts/:id', {
    config: { auth: { permission: 'contact:update' } },
    schema: {
      tags: ['contacts'],
      params: idParams,
      body: updateContactBody,
      response: { 200: dataResponse(contactDto) },
    },
    handler: async (request) => {
      const { actor, scope } = await scopeOf(app, request);
      return {
        data: await service.update(
          scope,
          actorFor(actor.role, actor.id),
          request.params.id,
          request.body,
          auditContext(request),
        ),
      };
    },
  });

  app.delete('/contacts/:id', {
    config: { auth: { permission: 'contact:delete' } },
    schema: { tags: ['contacts'], params: idParams, response: { 204: z.null() } },
    handler: async (request, reply) => {
      const { actor, scope } = await scopeOf(app, request);
      await service.softDelete(
        scope,
        actorFor(actor.role, actor.id),
        request.params.id,
        auditContext(request),
      );
      return reply.status(204).send(null);
    },
  });

  app.post('/contacts/:id/restore', {
    config: { auth: { permission: 'contact:delete' } },
    schema: { tags: ['contacts'], params: idParams, response: { 200: dataResponse(contactDto) } },
    handler: async (request) => {
      const { scope } = await scopeOf(app, request);
      return { data: await service.restore(scope, request.params.id, auditContext(request)) };
    },
  });

  app.post('/contacts/:id/merge', {
    config: { auth: { permission: 'contact:merge' } },
    schema: {
      tags: ['contacts'],
      params: idParams,
      body: mergeContactsBody,
      response: { 200: dataResponse(contactDto) },
    },
    handler: async (request) => {
      const { actor, scope } = await scopeOf(app, request);
      return {
        data: await service.merge(
          scope,
          actorFor(actor.role, actor.id),
          request.params.id,
          request.body.sourceId,
          auditContext(request),
        ),
      };
    },
  });

  app.get('/contacts/:id/timeline', {
    config: { auth: { permission: 'contact:read' } },
    schema: {
      tags: ['contacts'],
      params: idParams,
      querystring: timelineQuery.omit({ contactId: true, dealId: true, companyId: true }),
      response: { 200: cursorListResponse(activityDto) },
    },
    handler: async (request) => {
      const { scope } = await scopeOf(app, request);
      await service.getVisible(scope, request.params.id);
      return app.activity.timeline(
        { kind: 'all' },
        { ...request.query, contactId: request.params.id },
      );
    },
  });

  app.post('/contacts/:id/phones', {
    config: { auth: { permission: 'contact:update' } },
    schema: {
      tags: ['contacts'],
      params: idParams,
      body: phoneInputItem,
      response: { 201: dataResponse(contactDto) },
    },
    handler: async (request, reply) => {
      const { actor, scope } = await scopeOf(app, request);
      const dto = await service.addPhone(
        scope,
        actorFor(actor.role, actor.id),
        request.params.id,
        request.body,
        auditContext(request),
      );
      return reply.status(201).send({ data: dto });
    },
  });

  app.patch('/contacts/:id/phones/:phoneId', {
    config: { auth: { permission: 'contact:update' } },
    schema: {
      tags: ['contacts'],
      params: phoneParams,
      body: updatePhoneBody,
      response: { 200: dataResponse(contactDto) },
    },
    handler: async (request) => {
      const { actor, scope } = await scopeOf(app, request);
      return {
        data: await service.updatePhone(
          scope,
          actorFor(actor.role, actor.id),
          request.params.id,
          request.params.phoneId,
          request.body,
          auditContext(request),
        ),
      };
    },
  });

  app.delete('/contacts/:id/phones/:phoneId', {
    config: { auth: { permission: 'contact:update' } },
    schema: {
      tags: ['contacts'],
      params: phoneParams,
      response: { 200: dataResponse(contactDto) },
    },
    handler: async (request) => {
      const { actor, scope } = await scopeOf(app, request);
      return {
        data: await service.removePhone(
          scope,
          actorFor(actor.role, actor.id),
          request.params.id,
          request.params.phoneId,
          auditContext(request),
        ),
      };
    },
  });

  app.post('/contacts/:id/emails', {
    config: { auth: { permission: 'contact:update' } },
    schema: {
      tags: ['contacts'],
      params: idParams,
      body: emailInputItem,
      response: { 201: dataResponse(contactDto) },
    },
    handler: async (request, reply) => {
      const { actor, scope } = await scopeOf(app, request);
      const dto = await service.addEmail(
        scope,
        actorFor(actor.role, actor.id),
        request.params.id,
        request.body,
        auditContext(request),
      );
      return reply.status(201).send({ data: dto });
    },
  });

  app.delete('/contacts/:id/emails/:emailId', {
    config: { auth: { permission: 'contact:update' } },
    schema: {
      tags: ['contacts'],
      params: emailParams,
      response: { 200: dataResponse(contactDto) },
    },
    handler: async (request) => {
      const { actor, scope } = await scopeOf(app, request);
      return {
        data: await service.removeEmail(
          scope,
          actorFor(actor.role, actor.id),
          request.params.id,
          request.params.emailId,
          auditContext(request),
        ),
      };
    },
  });

  app.post('/contacts/:id/avatar', {
    config: { auth: { permission: 'contact:update' } },
    schema: { tags: ['contacts'], params: idParams, response: { 200: dataResponse(contactDto) } },
    handler: async (request) => {
      const { actor, scope } = await scopeOf(app, request);
      const file = await request.file();
      const stored = await storeUpload(app.storage, file, {
        prefix: 'avatars',
        allowed: IMAGE_TYPES,
        maxBytes: 5 * 1024 * 1024,
        beforeStore: (bytes) => app.entitlements.assertStorage(bytes, auditContext(request)),
      });
      return {
        data: await service.setAvatar(
          scope,
          actorFor(actor.role, actor.id),
          request.params.id,
          stored.key,
          auditContext(request),
        ),
      };
    },
  });

  app.delete('/contacts/:id/avatar', {
    config: { auth: { permission: 'contact:update' } },
    schema: { tags: ['contacts'], params: idParams, response: { 200: dataResponse(contactDto) } },
    handler: async (request) => {
      const { actor, scope } = await scopeOf(app, request);
      return {
        data: await service.setAvatar(
          scope,
          actorFor(actor.role, actor.id),
          request.params.id,
          null,
          auditContext(request),
        ),
      };
    },
  });
};

export default contactsRoutes;
