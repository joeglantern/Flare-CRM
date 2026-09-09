/**
 * The one reduction of a block to plain text. Search, the print view and the content integrity
 * test all read through this, so a new block type cannot be added without becoming searchable.
 */
import { roleHasPermission, statement, type Permission, type RoleName } from '@crm/shared';
import type { Block } from './types';
import { stripInline } from './inline';

export function blockText(block: Block): string {
  switch (block.type) {
    case 'p':
      return stripInline(block.text);
    case 'steps':
      return block.items.map(stripInline).join(' ');
    case 'callout':
      return stripInline(block.text);
    case 'figure':
      return [block.alt, block.caption ?? ''].filter(Boolean).join(' ');
    case 'table':
      return [...block.headers, ...block.rows.flat()].join(' ');
    case 'diagram':
      return block.caption;
    case 'shortcuts':
      return block.items.map((i) => `${i.label} ${i.keys}`).join(' ');
    case 'related':
      return '';
    case 'permissions':
      return permissionRows(block.roles)
        .map((r) => `${r.permission} ${r.roles.join(' ')}`)
        .join(' ');
  }
}

export interface PermissionRow {
  permission: Permission;
  /** The roles that hold it, in the order the block asked for. */
  roles: RoleName[];
  held: boolean[];
}

/** Built from the shared access-control statement, so the manual cannot describe a stale matrix. */
export function permissionRows(roles: RoleName[]): PermissionRow[] {
  const permissions = Object.entries(statement).flatMap(([resource, actions]) =>
    (actions as readonly string[]).map((a) => `${resource}:${a}` as Permission),
  );
  return permissions.map((permission) => ({
    permission,
    roles,
    held: roles.map((r) => roleHasPermission(r, permission)),
  }));
}
