/**
 * Turns a VisibilityScope (docs/07 §4) into Prisma `where` fragments. This is the ONLY place
 * that knows how ownership is expressed per entity; repositories must go through it.
 */
import { resolveScope, type Actor, type VisibilityScope } from '@crm/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { ForbiddenError } from './errors.js';
import { actorOf } from './request.js';

export interface ScopeShape {
  /** Column holding the owning user id (`ownerId`, `assigneeId`, `userId`, `authorId`). */
  ownerField: string;
  /** Relation to that user, used for team membership checks. */
  ownerRelation: string;
  /** Extra clauses that make a record visible to a specific user in `own` mode. */
  extraOwn?: (userId: string) => Record<string, unknown>[];
}

export const SHAPES = {
  contact: {
    ownerField: 'ownerId',
    ownerRelation: 'owner',
    extraOwn: (userId: string) => [
      { calls: { some: { userId } } },
      { conversations: { some: { assigneeId: userId } } },
      { createdById: userId },
    ],
  },
  company: {
    ownerField: 'ownerId',
    ownerRelation: 'owner',
    extraOwn: (userId: string) => [
      { createdById: userId },
      { contacts: { some: { ownerId: userId } } },
    ],
  },
  lead: {
    ownerField: 'ownerId',
    ownerRelation: 'owner',
    extraOwn: (userId: string) => [{ createdById: userId }],
  },
  deal: {
    ownerField: 'ownerId',
    ownerRelation: 'owner',
    extraOwn: (userId: string) => [{ createdById: userId }],
  },
  task: {
    ownerField: 'assigneeId',
    ownerRelation: 'assignee',
    extraOwn: (userId: string) => [{ createdById: userId }],
  },
  note: { ownerField: 'authorId', ownerRelation: 'author' },
  call: { ownerField: 'userId', ownerRelation: 'user' },
  conversation: { ownerField: 'assigneeId', ownerRelation: 'assignee' },
} as const satisfies Record<string, ScopeShape>;

export type ScopedEntity = keyof typeof SHAPES;

export function scopeWhere(scope: VisibilityScope, shape: ScopeShape): Record<string, unknown> {
  switch (scope.kind) {
    case 'all':
      return {};
    case 'team':
      return {
        OR: [{ [shape.ownerField]: null }, { [shape.ownerRelation]: { teamId: scope.teamId } }],
      };
    case 'own':
      return {
        OR: [{ [shape.ownerField]: scope.userId }, ...(shape.extraOwn?.(scope.userId) ?? [])],
      };
  }
}

/** Resolve the caller's scope from settings + role in one place. */
export async function scopeOf(
  app: FastifyInstance,
  request: FastifyRequest,
): Promise<{ actor: Actor; scope: VisibilityScope }> {
  const actor = actorOf(request);
  const visibility = await app.settings.get('agentVisibility');
  return { actor, scope: resolveScope(actor, visibility) };
}

/**
 * Write guard for `own` scope: agents may only modify records they own (or unowned ones they can see),
 * and may not hand records to someone else without the `assign` permission.
 */
export function assertCanWrite(
  scope: VisibilityScope,
  ownerId: string | null,
  actorId: string,
): void {
  if (scope.kind === 'own' && ownerId !== null && ownerId !== actorId) {
    throw new ForbiddenError('You can only modify records you own');
  }
}

export function assertCanAssign(
  hasAssignPermission: boolean,
  newOwnerId: string | null | undefined,
  actorId: string,
): void {
  if (newOwnerId === undefined) return;
  if (newOwnerId !== actorId && !hasAssignPermission) {
    throw new ForbiddenError('Assigning records to other users requires the assign permission');
  }
}
