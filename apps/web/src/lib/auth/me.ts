/**
 * The signed-in user as the API sees them (`GET /api/v1/users/me`, docs/07 section 5): role,
 * extension, team and the effective permission list. The UI hides what the user cannot do; the
 * server still enforces every rule (docs/17 section 3).
 */
import { meDto, type MeDto, type Permission } from '@crm/shared';
import { queryOptions, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, unwrap } from '../api/client';

export const ME_QUERY_KEY = ['me'] as const;

export const meQuery = queryOptions({
  queryKey: ME_QUERY_KEY,
  queryFn: async (): Promise<MeDto> => {
    const res = unwrap(await api.GET('/api/v1/users/me'));
    // the one response we validate at runtime: everything about authorization hangs off it
    return meDto.parse(res.data);
  },
  staleTime: 60_000,
  retry: false,
});

export function useMe(): MeDto {
  const { data } = useQuery({ ...meQuery, enabled: false });
  if (!data) throw new Error('useMe() called outside an authenticated route');
  return data;
}

export function useMeOptional(): MeDto | undefined {
  return useQuery({ ...meQuery, enabled: false }).data;
}

export function hasPermission(me: Pick<MeDto, 'permissions'>, permission: Permission): boolean {
  return me.permissions.includes(permission);
}

export function hasAnyPermission(
  me: Pick<MeDto, 'permissions'>,
  permissions: Permission[],
): boolean {
  return permissions.some((p) => me.permissions.includes(p));
}

export function useCan(): (permission: Permission) => boolean {
  const me = useMe();
  return (permission) => hasPermission(me, permission);
}

export function useInvalidateMe(): () => Promise<void> {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ME_QUERY_KEY });
}

export function isPrivilegedRole(role: MeDto['role']): boolean {
  return role === 'admin' || role === 'manager';
}
