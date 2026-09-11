/**
 * Console access control (docs/21).
 *
 * Two roles. `owner` is the provider: everything here, including what every customer is entitled to
 * and who else may sign in. `support` is for somebody who answers the phone: they see the fleet,
 * unstick a person who is locked out, acknowledge an alert and write a note, and they cannot touch
 * a plan, a price, an entitlement, a stack credential or another account.
 *
 * The actions are split finer than the screens are, because that split is what makes the second
 * role expressible at all. Correcting a customer's phone number and suspending their CRM used to be
 * the same permission, and they are not the same act.
 */
import { createAccessControl } from 'better-auth/plugins/access';
import { adminAc, defaultStatements } from 'better-auth/plugins/admin/access';
import { CONSOLE_ROLES, CONSOLE_ROLE_COPY, type ConsoleRole } from '@crm/shared';

export const statement = {
  ...defaultStatements,
  /** `write` is the details, `archive` is the lifecycle act, `note` is adding to the timeline. */
  customer: ['read', 'write', 'archive', 'note'],
  plan: ['read', 'write'],
  entitlement: ['read', 'issue'],
  /** `operate` asks a stack to do something harmless; `manage` holds its credentials. */
  stack: ['read', 'manage', 'operate'],
  /** `ack` acknowledges, snoozes and closes; `manage` sets thresholds, recipients and mutes. */
  alert: ['read', 'ack', 'manage'],
  owner: ['manage'],
  /** Reading the log is routine; taking a copy of it out of here is not. */
  audit: ['read', 'export'],
  announce: ['send'],
  analytics: ['read'],
  /** Reaching into a customer's own CRM to unstick somebody, and nothing else (docs/21 §9). */
  support: ['run'],
  settings: ['read', 'manage'],
} as const;

export type Statement = typeof statement;
export type Resource = keyof Statement;
type Action<R extends Resource> = Statement[R][number];
export type Permission = { [R in Resource]: `${R & string}:${Action<R> & string}` }[Resource];

export const ac = createAccessControl(statement);

export const owner = ac.newRole({
  ...adminAc.statements,
  customer: ['read', 'write', 'archive', 'note'],
  plan: ['read', 'write'],
  entitlement: ['read', 'issue'],
  stack: ['read', 'manage', 'operate'],
  alert: ['read', 'ack', 'manage'],
  owner: ['manage'],
  audit: ['read', 'export'],
  announce: ['send'],
  analytics: ['read'],
  support: ['run'],
  settings: ['read', 'manage'],
});

/**
 * Deliberately without Better Auth's admin statements: those carry ban, impersonate and set-role,
 * which is the whole of what this role is for not having. A support account can look at anything
 * here and change almost nothing.
 */
export const support = ac.newRole({
  customer: ['read', 'note'],
  plan: ['read'],
  entitlement: ['read'],
  stack: ['read', 'operate'],
  alert: ['read', 'ack'],
  audit: ['read'],
  announce: ['send'],
  analytics: ['read'],
  support: ['run'],
  settings: ['read'],
});

export const roles = { owner, support } as const;

// The names and their wording are shared with the screens, which cannot import this file.
export const ROLE_NAMES = CONSOLE_ROLES;
export const ROLE_COPY = CONSOLE_ROLE_COPY;
export type RoleName = ConsoleRole;

/** Every permission the console defines, in `resource:action` form. */
export const allPermissions: Permission[] = Object.entries(statement).flatMap(
  ([resource, actions]) =>
    (actions as readonly string[]).map((a) => `${resource}:${a}` as Permission),
);

/** What a role may do, for a client that hides what it cannot use. The server still decides. */
export function permissionsFor(role: string | null | undefined): Permission[] {
  return allPermissions.filter((p) => roleHasPermission(role, p));
}

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
