/**
 * Access-control statement and role definitions (docs/07 §3).
 * Imported by the api (Better Auth admin plugin) and by the web app (UI gating).
 */
import { createAccessControl } from 'better-auth/plugins/access';
import { adminAc, defaultStatements } from 'better-auth/plugins/admin/access';

export const statement = {
  ...defaultStatements,
  contact: [
    'create',
    'read',
    'update',
    'delete',
    'assign',
    'export',
    'import',
    'merge',
    'override_dnc',
  ],
  company: ['create', 'read', 'update', 'delete', 'assign', 'export'],
  lead: ['create', 'read', 'update', 'delete', 'assign', 'convert', 'import'],
  deal: ['create', 'read', 'update', 'delete', 'assign', 'change_stage', 'export'],
  pipeline: ['manage'],
  task: ['create', 'read', 'update', 'delete', 'assign'],
  note: ['create', 'read', 'update', 'delete'],
  call: [
    'read',
    'dial',
    'control',
    'webrtc',
    'set_disposition',
    'listen_recording',
    'delete_recording',
    'export',
  ],
  chat: ['read', 'send', 'assign', 'close'],
  channel: ['manage'],
  report: ['view_own', 'view_team', 'view_all', 'export'],
  notification: ['manage_own'],
  custom_field: ['manage'],
  settings: ['read', 'manage'],
  audit: ['read'],
  pbx: ['view_status', 'reconcile'],
  webform: ['manage'],
  team: ['read', 'manage'],
} as const;

export type Statement = typeof statement;
export type Resource = keyof Statement;
export type Action<R extends Resource> = Statement[R][number];
/** `resource:action` string form used in route guards and audit rows. */
export type Permission = { [R in Resource]: `${R & string}:${Action<R> & string}` }[Resource];

export const ac = createAccessControl(statement);

const agent = ac.newRole({
  contact: ['create', 'read', 'update', 'export'],
  company: ['create', 'read', 'update'],
  lead: ['create', 'read', 'update', 'convert'],
  deal: ['create', 'read', 'update', 'change_stage'],
  task: ['create', 'read', 'update', 'delete'],
  note: ['create', 'read', 'update', 'delete'],
  call: ['read', 'dial', 'control', 'set_disposition', 'listen_recording'],
  chat: ['read', 'send', 'close'],
  report: ['view_own'],
  notification: ['manage_own'],
  settings: ['read'],
  team: ['read'],
});

const manager = ac.newRole({
  contact: [
    'create',
    'read',
    'update',
    'delete',
    'assign',
    'export',
    'import',
    'merge',
    'override_dnc',
  ],
  company: ['create', 'read', 'update', 'delete', 'assign', 'export'],
  lead: ['create', 'read', 'update', 'delete', 'assign', 'convert', 'import'],
  deal: ['create', 'read', 'update', 'delete', 'assign', 'change_stage', 'export'],
  pipeline: ['manage'],
  task: ['create', 'read', 'update', 'delete', 'assign'],
  note: ['create', 'read', 'update', 'delete'],
  call: ['read', 'dial', 'control', 'webrtc', 'set_disposition', 'listen_recording', 'export'],
  chat: ['read', 'send', 'assign', 'close'],
  report: ['view_own', 'view_team', 'export'],
  notification: ['manage_own'],
  custom_field: ['manage'],
  settings: ['read'],
  audit: ['read'],
  pbx: ['view_status'],
  team: ['read'],
  user: ['list'],
});

const everything = Object.fromEntries(
  Object.entries(statement).map(([resource, actions]) => [resource, [...actions]]),
) as { [R in Resource]: Action<R>[] };

const admin = ac.newRole({
  ...everything,
  ...adminAc.statements,
});

export const roles = { admin, manager, agent } as const;
export type RoleName = keyof typeof roles;

/** Split `resource:action` into a permissions object accepted by Better Auth. */
export function parsePermission(permission: Permission): Partial<Record<Resource, string[]>> {
  const idx = permission.indexOf(':');
  const resource = permission.slice(0, idx) as Resource;
  const action = permission.slice(idx + 1);
  return { [resource]: [action] };
}

/** Pure role → permission check (no DB), used by both api guards and the web UI. */
export function isRoleName(value: string): value is RoleName {
  return Object.hasOwn(roles, value);
}

export function roleHasPermission(role: string, permission: Permission): boolean {
  const roleNames = role.split(',').map((r) => r.trim());
  return roleNames.some((name) => {
    if (!isRoleName(name)) return false;
    const result = roles[name].authorize(parsePermission(permission) as never);
    return result.success;
  });
}
