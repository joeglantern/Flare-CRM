/**
 * Console access control (docs/21).
 *
 * One role: owner. Everyone who can sign in here can do everything here, because the console has
 * a handful of users who are all the provider. Roles exist as a structure so a narrower one can
 * be added later without changing every route.
 */
import { createAccessControl } from 'better-auth/plugins/access';
import { adminAc, defaultStatements } from 'better-auth/plugins/admin/access';

export const statement = {
  ...defaultStatements,
  customer: ['read', 'write'],
  plan: ['read', 'write'],
  entitlement: ['read', 'issue'],
  stack: ['read', 'manage'],
  owner: ['manage'],
  audit: ['read'],
  announce: ['send'],
  settings: ['read', 'manage'],
} as const;

export type Statement = typeof statement;
export type Resource = keyof Statement;
type Action<R extends Resource> = Statement[R][number];
export type Permission = { [R in Resource]: `${R & string}:${Action<R> & string}` }[Resource];

export const ac = createAccessControl(statement);

export const owner = ac.newRole({
  ...adminAc.statements,
  customer: ['read', 'write'],
  plan: ['read', 'write'],
  entitlement: ['read', 'issue'],
  stack: ['read', 'manage'],
  owner: ['manage'],
  audit: ['read'],
  announce: ['send'],
  settings: ['read', 'manage'],
});

export const roles = { owner } as const;
export type RoleName = keyof typeof roles;

export function roleHasPermission(
  role: string | null | undefined,
  permission: Permission,
): boolean {
  const [resource, action] = permission.split(':') as [Resource, string];
  // A role name off the wire is a string, not a RoleName: looked up in a table that admits misses.
  const table = roles as unknown as Record<
    string,
    { statements: Record<string, readonly string[] | undefined> } | undefined
  >;
  return (role ?? '')
    .split(',')
    .map((r) => r.trim())
    .some((r) => table[r]?.statements[resource]?.includes(action) === true);
}
