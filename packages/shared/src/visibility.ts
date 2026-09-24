/**
 * Record-level visibility (docs/07 §4). Pure — no DB access.
 * The api turns the descriptor into a Prisma `where`; the web uses it to hide actions.
 */
import type { AgentVisibility } from './enums.js';

export interface Actor {
  id: string;
  role: string;
  teamId: string | null;
}

/**
 * `sharedDirectory`: contacts and companies are seen by everyone, whatever the scope says for the
 * rest (deals, leads, tasks, calls, notes). The people and businesses the company deals with are a
 * shared address book; a caller an agent has never owned must still be findable by that agent.
 */
export type VisibilityScope =
  | { kind: 'all' }
  | { kind: 'team'; teamId: string; includeUnassigned: true; sharedDirectory?: boolean }
  | { kind: 'own'; userId: string; includeUnassigned: false; sharedDirectory?: boolean };

export function resolveScope(
  actor: Actor,
  setting: AgentVisibility,
  sharedDirectory = false,
): VisibilityScope {
  const roles = actor.role.split(',').map((r) => r.trim());
  if (roles.includes('admin')) return { kind: 'all' };
  if (roles.includes('manager')) {
    if (setting === 'all' || actor.teamId === null) return { kind: 'all' };
    return { kind: 'team', teamId: actor.teamId, includeUnassigned: true, sharedDirectory };
  }
  // agent
  if (setting === 'all') return { kind: 'all' };
  if (setting === 'team' && actor.teamId !== null) {
    return { kind: 'team', teamId: actor.teamId, includeUnassigned: true, sharedDirectory };
  }
  return { kind: 'own', userId: actor.id, includeUnassigned: false, sharedDirectory };
}

/** Can the actor write (update) a record owned by `ownerId` under this scope? */
export function canWriteOwned(
  scope: VisibilityScope,
  ownerId: string | null,
  actorId: string,
): boolean {
  switch (scope.kind) {
    case 'all':
      return true;
    case 'team':
      return true; // membership is enforced by the repository filter on owner.teamId
    case 'own':
      return ownerId === actorId || ownerId === null;
  }
}
