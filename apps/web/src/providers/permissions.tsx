/**
 * usePermissions and <Can> (Component Inventory · Hooks and providers).
 *
 * Scope aware, mirroring packages/shared/src/visibility.ts: an agent may update a contact they own
 * but not one they do not, a manager is limited to their team, an admin sees everything. The UI
 * hides what the user cannot do; the server still enforces every rule.
 */
import { resolveScope, type Permission, type VisibilityScope } from '@crm/shared';
import type { ReactNode } from 'react';
import { useCallback, useMemo } from 'react';
import { ForbiddenState } from '@/components/data/states';
import { useMe } from '@/lib/auth/me';
import { useFullSettings } from './settings';

export interface ScopeTarget {
  ownerId?: string | null;
  teamId?: string | null;
  assigneeId?: string | null;
}

export interface PermissionApi {
  role: string;
  /** Raw permission check, ignoring record ownership. */
  has: (p: Permission) => boolean;
  /** Permission plus record scope. */
  can: (p: Permission, on?: ScopeTarget) => boolean;
  /** Whether the actor may see this record at all. */
  inScope: (on: ScopeTarget) => boolean;
  scope: VisibilityScope;
  isAdmin: boolean;
  isManager: boolean;
  isAgent: boolean;
  userId: string;
  teamId: string | null;
}

/**
 * `agentVisibility` lives in the admin-only settings payload, so agents fall back to the
 * conservative default ("owned"). Widening it can only ever be a server decision anyway.
 */
export function usePermissions(): PermissionApi {
  const me = useMe();
  const full = useFullSettings();
  const agentVisibility =
    (full.data as { agentVisibility?: 'owned' | 'team' | 'all' } | undefined)?.agentVisibility ??
    'owned';

  const scope = useMemo<VisibilityScope>(
    () => resolveScope({ id: me.id, role: me.role, teamId: me.teamId }, agentVisibility),
    [me.id, me.role, me.teamId, agentVisibility],
  );

  const has = useCallback((p: Permission) => me.permissions.includes(p), [me.permissions]);

  const inScope = useCallback(
    (on: ScopeTarget) => {
      if (scope.kind === 'all') return true;
      const owner = on.ownerId ?? on.assigneeId ?? null;
      if (scope.kind === 'own') return owner === me.id;
      if (on.teamId !== undefined && on.teamId !== null) return on.teamId === me.teamId;
      return owner === me.id || owner === null;
    },
    [scope, me.id, me.teamId],
  );

  const can = useCallback(
    (p: Permission, on?: ScopeTarget) => (has(p) ? (on === undefined ? true : inScope(on)) : false),
    [has, inScope],
  );

  return useMemo(
    () => ({
      role: me.role,
      has,
      can,
      inScope,
      scope,
      isAdmin: me.role === 'admin',
      isManager: me.role === 'manager',
      isAgent: me.role === 'agent',
      userId: me.id,
      teamId: me.teamId,
    }),
    [me.role, me.id, me.teamId, has, can, inScope, scope],
  );
}

export interface CanProps {
  /** e.g. "contact:update" */
  do: Permission;
  on?: ScopeTarget;
  /** hide (default): render nothing. disable: render children with a reason. forbidden: 403 panel. */
  fallback?: 'hide' | 'forbidden';
  children: ReactNode;
  what?: string;
}

export function Can({ do: permission, on, fallback = 'hide', children, what }: CanProps) {
  const perms = usePermissions();
  if (perms.can(permission, on)) return children;
  if (fallback === 'forbidden') {
    return <ForbiddenState permission={permission} {...(what !== undefined ? { what } : {})} />;
  }
  return null;
}

/** Convenience for buttons: returns the disabled flag and the tooltip that explains why. */
export function useGuard(
  permission: Permission,
  on?: ScopeTarget,
): { allowed: boolean; reason?: string } {
  const perms = usePermissions();
  if (perms.can(permission, on)) return { allowed: true };
  return {
    allowed: false,
    reason: perms.has(permission)
      ? 'This record belongs to someone else'
      : `Requires ${permission}`,
  };
}
