import {
  companyDto,
  contactSummaryDto,
  createCompanyBody,
  dataResponse,
  idParams,
  listCompaniesQuery,
  offsetListResponse,
  roleHasPermission,
  updateCompanyBody,
} from '@crm/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { auditContext } from '../../lib/request.js';
import { scopeOf } from '../../lib/scope.js';
import { contactSummarySelect, contactToSummary } from '../contacts/contacts.mappers.js';
import { CompaniesService } from './companies.service.js';

const companiesRoutes: FastifyPluginAsyncZod = async (app) => {
  const service = new CompaniesService(app);
  const actorFor = (role: string, id: string) => ({
    id,
    canAssign: roleHasPermission(role, 'company:assign'),
  });

  app.get('/companies', {
    config: { auth: { permission: 'company:read' } },
    schema: {
      tags: ['companies'],
      querystring: listCompaniesQuery,
      response: { 200: offsetListResponse(companyDto) },
    },
    handler: async (request) => {
      const { scope } = await scopeOf(app, request);
      return service.list(scope, request.query);
    },
  });

  app.post('/companies', {
    config: { auth: { permission: 'company:create' } },
    schema: {
      tags: ['companies'],
      body: createCompanyBody,
      response: { 201: dataResponse(companyDto) },
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

  app.get('/companies/:id', {
    config: { auth: { permission: 'company:read' } },
    schema: { tags: ['companies'], params: idParams, response: { 200: dataResponse(companyDto) } },
    handler: async (request) => {
      const { scope } = await scopeOf(app, request);
      return { data: await service.get(scope, request.params.id) };
    },
  });

  app.patch('/companies/:id', {
    config: { auth: { permission: 'company:update' } },
    schema: {
      tags: ['companies'],
      params: idParams,
      body: updateCompanyBody,
      response: { 200: dataResponse(companyDto) },
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

  app.delete('/companies/:id', {
    config: { auth: { permission: 'company:delete' } },
    schema: { tags: ['companies'], params: idParams, response: { 204: z.null() } },
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

  app.post('/companies/:id/restore', {
    config: { auth: { permission: 'company:delete' } },
    schema: { tags: ['companies'], params: idParams, response: { 200: dataResponse(companyDto) } },
    handler: async (request) => {
      const { scope } = await scopeOf(app, request);
      return { data: await service.restore(scope, request.params.id, auditContext(request)) };
    },
  });

  app.get('/companies/:id/contacts', {
    config: { auth: { permission: 'company:read' } },
    schema: {
      tags: ['companies'],
      params: idParams,
      response: { 200: dataResponse(z.array(contactSummaryDto)) },
    },
    handler: async (request) => {
      const { scope } = await scopeOf(app, request);
      await service.getVisible(scope, request.params.id);
      const rows = await app.db.contact.findMany({
        where: { companyId: request.params.id },
        select: contactSummarySelect,
        orderBy: { displayName: 'asc' },
        take: 500,
      });
      return { data: rows.map(contactToSummary) };
    },
  });
};

export default companiesRoutes;
