import {
  createPipelineBody,
  createStageBody,
  dataResponse,
  idParams,
  pipelineDto,
  reorderBody,
  updatePipelineBody,
  updateStageBody,
  uuid,
  type PipelineDto,
} from '@crm/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { ConflictError, NotFoundError, ValidationError } from '../../lib/errors.js';
import { newId } from '../../lib/ids.js';
import { auditContext } from '../../lib/request.js';

const pipelineSelect = {
  id: true,
  name: true,
  isDefault: true,
  createdAt: true,
  updatedAt: true,
  stages: {
    orderBy: { sortOrder: 'asc' as const },
    select: {
      id: true,
      pipelineId: true,
      name: true,
      sortOrder: true,
      probability: true,
      type: true,
      isActive: true,
    },
  },
};

function toDto(p: {
  id: string;
  name: string;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
  stages: {
    id: string;
    pipelineId: string;
    name: string;
    sortOrder: number;
    probability: number;
    type: string;
    isActive: boolean;
  }[];
}): PipelineDto {
  return {
    id: p.id,
    name: p.name,
    isDefault: p.isDefault,
    stages: p.stages.map((s) => ({ ...s, type: s.type as PipelineDto['stages'][number]['type'] })),
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

const stageParams = z.object({ id: uuid, stageId: uuid });

const pipelinesRoutes: FastifyPluginAsyncZod = async (app) => {
  const load = async (id: string) => {
    const p = await app.db.pipeline.findUnique({ where: { id }, select: pipelineSelect });
    if (!p) throw new NotFoundError('Pipeline');
    return p;
  };

  app.get('/pipelines', {
    config: { auth: { permission: 'deal:read' } },
    schema: { tags: ['pipelines'], response: { 200: dataResponse(z.array(pipelineDto)) } },
    handler: async () => ({
      data: (
        await app.db.pipeline.findMany({
          select: pipelineSelect,
          orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
        })
      ).map(toDto),
    }),
  });

  app.post('/pipelines', {
    config: { auth: { permission: 'pipeline:manage' } },
    schema: {
      tags: ['pipelines'],
      body: createPipelineBody,
      response: { 201: dataResponse(pipelineDto) },
    },
    handler: async (request, reply) => {
      const b = request.body;
      if (await app.db.pipeline.findUnique({ where: { name: b.name } }))
        throw new ConflictError('A pipeline with this name already exists');
      const stages = b.stages ?? [
        { name: 'New', probability: 10, type: 'open' as const },
        { name: 'Qualified', probability: 50, type: 'open' as const },
        { name: 'Won', probability: 100, type: 'won' as const },
        { name: 'Lost', probability: 0, type: 'lost' as const },
      ];
      if (!stages.some((s) => s.type === 'won') || !stages.some((s) => s.type === 'lost')) {
        throw new ValidationError([
          { path: 'stages', message: 'A pipeline needs at least one won and one lost stage' },
        ]);
      }
      const id = newId();
      await app.db.$transaction(async (tx) => {
        if (b.isDefault)
          await tx.pipeline.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
        await tx.pipeline.create({
          data: {
            id,
            name: b.name,
            isDefault: b.isDefault ?? false,
            stages: {
              create: stages.map((s, i) => ({
                id: newId(),
                name: s.name,
                probability: s.probability,
                type: s.type,
                sortOrder: i,
              })),
            },
          },
        });
        await app.audit.writeWith(tx, auditContext(request), {
          action: 'pipeline.create',
          entity: 'pipeline',
          entityId: id,
          after: b,
        });
      });
      return reply.status(201).send({ data: toDto(await load(id)) });
    },
  });

  app.patch('/pipelines/:id', {
    config: { auth: { permission: 'pipeline:manage' } },
    schema: {
      tags: ['pipelines'],
      params: idParams,
      body: updatePipelineBody,
      response: { 200: dataResponse(pipelineDto) },
    },
    handler: async (request) => {
      const before = await load(request.params.id);
      await app.db.$transaction(async (tx) => {
        if (request.body.isDefault === true)
          await tx.pipeline.updateMany({
            where: { isDefault: true, NOT: { id: before.id } },
            data: { isDefault: false },
          });
        if (request.body.isDefault === false && before.isDefault)
          throw new ConflictError('Set another pipeline as default first');
        await tx.pipeline.update({
          where: { id: before.id },
          data: {
            ...(request.body.name !== undefined ? { name: request.body.name } : {}),
            ...(request.body.isDefault !== undefined ? { isDefault: request.body.isDefault } : {}),
          },
        });
        await app.audit.writeWith(tx, auditContext(request), {
          action: 'pipeline.update',
          entity: 'pipeline',
          entityId: before.id,
          before: toDto(before),
          after: request.body,
        });
      });
      return { data: toDto(await load(before.id)) };
    },
  });

  app.delete('/pipelines/:id', {
    config: { auth: { permission: 'pipeline:manage' } },
    schema: { tags: ['pipelines'], params: idParams, response: { 204: z.null() } },
    handler: async (request, reply) => {
      const before = await load(request.params.id);
      if (before.isDefault) throw new ConflictError('The default pipeline cannot be deleted');
      const deals = await app.db.deal.count({
        where: { pipelineId: before.id },
        includeDeleted: true,
      } as never);
      if (deals > 0) throw new ConflictError('Pipeline has deals; move them first');
      await app.db.pipeline.delete({ where: { id: before.id } });
      await app.audit.write(auditContext(request), {
        action: 'pipeline.delete',
        entity: 'pipeline',
        entityId: before.id,
        before: toDto(before),
      });
      return reply.status(204).send(null);
    },
  });

  app.post('/pipelines/:id/stages', {
    config: { auth: { permission: 'pipeline:manage' } },
    schema: {
      tags: ['pipelines'],
      params: idParams,
      body: createStageBody,
      response: { 201: dataResponse(pipelineDto) },
    },
    handler: async (request, reply) => {
      const p = await load(request.params.id);
      if (p.stages.some((s) => s.name.toLowerCase() === request.body.name.toLowerCase()))
        throw new ConflictError('Stage name already used in this pipeline');
      await app.db.pipelineStage.create({
        data: {
          id: newId(),
          pipelineId: p.id,
          name: request.body.name,
          probability: request.body.probability,
          type: request.body.type,
          sortOrder: p.stages.length,
        },
      });
      await app.audit.write(auditContext(request), {
        action: 'pipeline.stage_create',
        entity: 'pipeline',
        entityId: p.id,
        after: request.body,
      });
      return reply.status(201).send({ data: toDto(await load(p.id)) });
    },
  });

  app.patch('/pipelines/:id/stages/:stageId', {
    config: { auth: { permission: 'pipeline:manage' } },
    schema: {
      tags: ['pipelines'],
      params: stageParams,
      body: updateStageBody,
      response: { 200: dataResponse(pipelineDto) },
    },
    handler: async (request) => {
      const p = await load(request.params.id);
      const stage = p.stages.find((s) => s.id === request.params.stageId);
      if (!stage) throw new NotFoundError('Stage');
      const b = request.body;
      await app.db.pipelineStage.update({
        where: { id: stage.id },
        data: {
          ...(b.name !== undefined ? { name: b.name } : {}),
          ...(b.probability !== undefined ? { probability: b.probability } : {}),
          ...(b.type !== undefined ? { type: b.type } : {}),
          ...(b.isActive !== undefined ? { isActive: b.isActive } : {}),
        },
      });
      await app.audit.write(auditContext(request), {
        action: 'pipeline.stage_update',
        entity: 'pipeline',
        entityId: p.id,
        before: stage,
        after: b,
      });
      return { data: toDto(await load(p.id)) };
    },
  });

  app.delete('/pipelines/:id/stages/:stageId', {
    config: { auth: { permission: 'pipeline:manage' } },
    schema: {
      tags: ['pipelines'],
      params: stageParams,
      response: { 200: dataResponse(pipelineDto) },
    },
    handler: async (request) => {
      const p = await load(request.params.id);
      const stage = p.stages.find((s) => s.id === request.params.stageId);
      if (!stage) throw new NotFoundError('Stage');
      const inUse = await app.db.deal.count({
        where: { stageId: stage.id },
        includeDeleted: true,
      } as never);
      if (inUse > 0) {
        await app.db.pipelineStage.update({ where: { id: stage.id }, data: { isActive: false } });
      } else {
        await app.db.pipelineStage.delete({ where: { id: stage.id } });
      }
      await app.audit.write(auditContext(request), {
        action: inUse > 0 ? 'pipeline.stage_deactivate' : 'pipeline.stage_delete',
        entity: 'pipeline',
        entityId: p.id,
        before: stage,
      });
      return { data: toDto(await load(p.id)) };
    },
  });

  app.post('/pipelines/:id/stages/reorder', {
    config: { auth: { permission: 'pipeline:manage' } },
    schema: {
      tags: ['pipelines'],
      params: idParams,
      body: reorderBody,
      response: { 200: dataResponse(pipelineDto) },
    },
    handler: async (request) => {
      const p = await load(request.params.id);
      const known = new Set(p.stages.map((s) => s.id));
      if (!request.body.ids.every((id) => known.has(id)))
        throw new ValidationError([{ path: 'ids', message: 'Unknown stage id' }]);
      await app.db.$transaction(
        request.body.ids.map((id, i) =>
          app.db.pipelineStage.update({ where: { id }, data: { sortOrder: i } }),
        ),
      );
      return { data: toDto(await load(p.id)) };
    },
  });
};

export default pipelinesRoutes;
