import {
  createCustomFieldBody,
  customFieldDefinitionDto,
  dataResponse,
  idParams,
  reorderBody,
  updateCustomFieldBody,
  type CustomFieldDefinitionDto,
} from '@crm/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { ConflictError, NotFoundError } from '../../lib/errors.js';
import { newId } from '../../lib/ids.js';
import { auditContext } from '../../lib/request.js';

function toDto(r: {
  id: string;
  entity: string;
  key: string;
  label: string;
  type: string;
  options: unknown;
  required: boolean;
  sortOrder: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}): CustomFieldDefinitionDto {
  return {
    id: r.id,
    entity: r.entity as CustomFieldDefinitionDto['entity'],
    key: r.key,
    label: r.label,
    type: r.type as CustomFieldDefinitionDto['type'],
    options: Array.isArray(r.options) ? (r.options as CustomFieldDefinitionDto['options']) : null,
    required: r.required,
    sortOrder: r.sortOrder,
    isActive: r.isActive,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

const listQuery = z.object({
  entity: z.enum(['contact', 'company', 'deal', 'lead']).optional(),
  includeInactive: z.enum(['true', 'false']).optional(),
});

const customFieldsRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/custom-fields', {
    config: { auth: { authenticated: true } },
    schema: {
      tags: ['custom-fields'],
      querystring: listQuery,
      response: { 200: dataResponse(z.array(customFieldDefinitionDto)) },
    },
    handler: async (request) => {
      const rows = await app.db.customFieldDefinition.findMany({
        where: {
          ...(request.query.entity ? { entity: request.query.entity } : {}),
          ...(request.query.includeInactive === 'true' ? {} : { isActive: true }),
        },
        orderBy: [{ entity: 'asc' }, { sortOrder: 'asc' }],
      });
      return { data: rows.map(toDto) };
    },
  });

  app.post('/custom-fields', {
    config: { auth: { permission: 'custom_field:manage', feature: 'custom_fields' } },
    schema: {
      tags: ['custom-fields'],
      body: createCustomFieldBody,
      response: { 201: dataResponse(customFieldDefinitionDto) },
    },
    handler: async (request, reply) => {
      const b = request.body;
      const exists = await app.db.customFieldDefinition.findUnique({
        where: { entity_key: { entity: b.entity, key: b.key } },
      });
      if (exists) throw new ConflictError(`Field "${b.key}" already exists for ${b.entity}`);
      const max = await app.db.customFieldDefinition.aggregate({
        where: { entity: b.entity },
        _max: { sortOrder: true },
      });
      const row = await app.db.customFieldDefinition.create({
        data: {
          id: newId(),
          entity: b.entity,
          key: b.key,
          label: b.label,
          type: b.type,
          ...(b.options ? { options: b.options } : {}),
          required: b.required,
          sortOrder: (max._max.sortOrder ?? -1) + 1,
        },
      });
      await app.audit.write(auditContext(request), {
        action: 'custom_field.create',
        entity: 'custom_field',
        entityId: row.id,
        after: toDto(row),
      });
      return reply.status(201).send({ data: toDto(row) });
    },
  });

  app.patch('/custom-fields/:id', {
    config: { auth: { permission: 'custom_field:manage', feature: 'custom_fields' } },
    schema: {
      tags: ['custom-fields'],
      params: idParams,
      body: updateCustomFieldBody,
      response: { 200: dataResponse(customFieldDefinitionDto) },
    },
    handler: async (request) => {
      const before = await app.db.customFieldDefinition.findUnique({
        where: { id: request.params.id },
      });
      if (!before) throw new NotFoundError('Custom field');
      const b = request.body;
      const row = await app.db.customFieldDefinition.update({
        where: { id: before.id },
        data: {
          ...(b.label !== undefined ? { label: b.label } : {}),
          ...(b.options !== undefined ? { options: b.options } : {}),
          ...(b.required !== undefined ? { required: b.required } : {}),
          ...(b.isActive !== undefined ? { isActive: b.isActive } : {}),
        },
      });
      await app.audit.write(auditContext(request), {
        action: 'custom_field.update',
        entity: 'custom_field',
        entityId: row.id,
        before: toDto(before),
        after: toDto(row),
      });
      return { data: toDto(row) };
    },
  });

  app.delete('/custom-fields/:id', {
    config: { auth: { permission: 'custom_field:manage', feature: 'custom_fields' } },
    schema: { tags: ['custom-fields'], params: idParams, response: { 204: z.null() } },
    handler: async (request, reply) => {
      const before = await app.db.customFieldDefinition.findUnique({
        where: { id: request.params.id },
      });
      if (!before) throw new NotFoundError('Custom field');
      // values stay in the JSONB of existing records (history); the definition is deactivated, not dropped
      await app.db.customFieldDefinition.update({
        where: { id: before.id },
        data: { isActive: false },
      });
      await app.audit.write(auditContext(request), {
        action: 'custom_field.deactivate',
        entity: 'custom_field',
        entityId: before.id,
        before: toDto(before),
      });
      return reply.status(204).send(null);
    },
  });

  app.post('/custom-fields/reorder', {
    config: { auth: { permission: 'custom_field:manage', feature: 'custom_fields' } },
    schema: { tags: ['custom-fields'], body: reorderBody, response: { 204: z.null() } },
    handler: async (request, reply) => {
      await app.db.$transaction(
        request.body.ids.map((id, i) =>
          app.db.customFieldDefinition.updateMany({ where: { id }, data: { sortOrder: i } }),
        ),
      );
      return reply.status(204).send(null);
    },
  });
};

export default customFieldsRoutes;
