/**
 * What this account may do, for screens that would rather hide a control than offer one that fails.
 *
 * The server is the decision: every route checks for itself, and a deep link to a screen this
 * account may not use still comes back refused. This only keeps the screens honest, because a
 * button that answers "you are not allowed" reads as a broken console rather than a narrow one.
 */
import { useQuery } from '@tanstack/react-query';
import { meQuery } from './auth';

export function hasPermission(
  permissions: string[] | undefined,
  required: string | string[],
): boolean {
  if (permissions === undefined) return false;
  const list = Array.isArray(required) ? required : [required];
  return list.every((p) => permissions.includes(p));
}

export interface Permitted {
  /** True only when every permission named is held. */
  can: (required: string | string[]) => boolean;
  role: string | undefined;
}

export function usePermissions(): Permitted {
  const me = useQuery(meQuery);
  return {
    can: (required) => hasPermission(me.data?.permissions, required),
    role: me.data?.role,
  };
}
