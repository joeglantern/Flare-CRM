import {
  createTeamBody,
  dataResponse,
  idParams,
  teamDto,
  teamMembersBody,
  updateTeamBody,
  type TeamDto,
} from '@crm/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { ConflictError, NotFoundError, ValidationError } from '../../lib/errors.js';
import { newId } from '../../lib/ids.js';
import { auditContext } from '../../lib/request.js';

const teamSelect = {
  id: true,
  name: true,
  managerId: true,
  manager: { select: { id: true, name: true } },
  _count: { select: { members: true } },
  createdAt: true,
  updatedAt: true,
} as const;

function toDto(row: {
  id: string;
  name: string;
  managerId: string | null;
  manager: { id: string; name: string } | null;
  _count: { members: number };
  createdAt: Date;
  updatedAt: Date;
}): TeamDto {
  return {
    id: row.id,
    name: row.name,
    managerId: row.managerId,
    manager: row.manager,
    memberCount: row._count.members,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const teamsRoutes: FastifyPluginAsyncZod = async (app) => {
  const assertManager = async (managerId: string | null | undefined) => {
    if (!managerId) return;
    const m = await app.db.user.findUnique({
      where: { id: managerId },
      select: { role: true, isActive: true },
    });
    if (!m?.isActive)
      throw new ValidationError([{ path: 'managerId', message: 'Manager not found' }]);
    if (!(m.role ?? '').split(',').some((r) => r === 'manager' || r === 'admin')) {
      throw new ValidationError([
        { path: 'managerId', message: 'Team manager must have the manager or admin role' },
      ]);
    }
  };

  app.get('/teams', {
    config: { auth: { permission: 'team:read' } },
    schema: { tags: ['teams'], response: { 200: dataResponse(z.array(teamDto)) } },
    handler: async () => ({
      data: (await app.db.team.findMany({ select: teamSelect, orderBy: { name: 'asc' } })).map(
        toDto,
      ),
    }),
  });

  app.post('/teams', {
    config: { auth: { permission: 'team:manage' } },
    schema: { tags: ['teams'], body: createTeamBody, response: { 201: dataResponse(teamDto) } },
    handler: async (request, reply) => {
      await assertManager(request.body.managerId);
      const exists = await app.db.team.findUnique({ where: { name: request.body.name } });
      if (exists) throw new ConflictError('A team with this name already exists');
      const row = await app.db.team.create({
        data: { id: newId(), name: request.body.name, managerId: request.body.managerId ?? null },
        select: teamSelect,
      });
      const dto = toDto(row);
      await app.audit.write(auditContext(request), {
        action: 'team.create',
        entity: 'team',
        entityId: row.id,
        after: dto,
      });
      return reply.status(201).send({ data: dto });
    },
  });

  app.patch('/teams/:id', {
    config: { auth: { permission: 'team:manage' } },
    schema: {
      tags: ['teams'],
      params: idParams,
      body: updateTeamBody,
      response: { 200: dataResponse(teamDto) },
    },
    handler: async (request) => {
      const before = await app.db.team.findUnique({
        where: { id: request.params.id },
        select: teamSelect,
      });
      if (!before) throw new NotFoundError('Team');
      await assertManager(request.body.managerId);
      const row = await app.db.team.update({
        where: { id: request.params.id },
        data: {
          ...(request.body.name !== undefined ? { name: request.body.name } : {}),
          ...(request.body.managerId !== undefined ? { managerId: request.body.managerId } : {}),
        },
        select: teamSelect,
      });
      const dto = toDto(row);
      await app.audit.write(auditContext(request), {
        action: 'team.update',
        entity: 'team',
        entityId: row.id,
        before: toDto(before),
        after: dto,
      });
      return { data: dto };
    },
  });

  app.delete('/teams/:id', {
    config: { auth: { permission: 'team:manage' } },
    schema: { tags: ['teams'], params: idParams, response: { 204: z.null() } },
    handler: async (request, reply) => {
      const before = await app.db.team.findUnique({
        where: { id: request.params.id },
        select: teamSelect,
      });
      if (!before) throw new NotFoundError('Team');
      await app.db.$transaction([
        app.db.user.updateMany({ where: { teamId: request.params.id }, data: { teamId: null } }),
        app.db.team.delete({ where: { id: request.params.id } }),
      ]);
      await app.audit.write(auditContext(request), {
        action: 'team.delete',
        entity: 'team',
        entityId: request.params.id,
        before: toDto(before),
      });
      return reply.status(204).send(null);
    },
  });

  app.post('/teams/:id/members', {
    config: { auth: { permission: 'team:manage' } },
    schema: {
      tags: ['teams'],
      params: idParams,
      body: teamMembersBody,
      response: { 200: dataResponse(teamDto) },
    },
    handler: async (request) => {
      const team = await app.db.team.findUnique({
        where: { id: request.params.id },
        select: { id: true },
      });
      if (!team) throw new NotFoundError('Team');
      await app.db.user.updateMany({
        where: { id: { in: request.body.userIds } },
        data: { teamId: team.id },
      });
      const row = await app.db.team.findUniqueOrThrow({
        where: { id: team.id },
        select: teamSelect,
      });
      await app.audit.write(auditContext(request), {
        action: 'team.members_add',
        entity: 'team',
        entityId: team.id,
        after: { userIds: request.body.userIds },
      });
      return { data: toDto(row) };
    },
  });

  app.delete('/teams/:id/members', {
    config: { auth: { permission: 'team:manage' } },
    schema: {
      tags: ['teams'],
      params: idParams,
      body: teamMembersBody,
      response: { 200: dataResponse(teamDto) },
    },
    handler: async (request) => {
      await app.db.user.updateMany({
        where: { id: { in: request.body.userIds }, teamId: request.params.id },
        data: { teamId: null },
      });
      const row = await app.db.team.findUnique({
        where: { id: request.params.id },
        select: teamSelect,
      });
      if (!row) throw new NotFoundError('Team');
      await app.audit.write(auditContext(request), {
        action: 'team.members_remove',
        entity: 'team',
        entityId: row.id,
        after: { userIds: request.body.userIds },
      });
      return { data: toDto(row) };
    },
  });
};

export default teamsRoutes;
