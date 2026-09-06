/**
 * Users and teams (docs/09 · Users, Teams). Used by pickers, the transfer picker and Settings.
 */
import type { CreateUserBody, MeDto, TeamDto, UpdateUserBody, UserDto } from '@crm/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { http, type OffsetList, type Query } from '@/lib/api/client';
import { qk } from '@/lib/query';

export interface UserFilters extends Query {
  q?: string;
  role?: string;
  teamId?: string;
  isActive?: 'true' | 'false';
  page?: number;
  pageSize?: number;
}

export function useUsers(filters: UserFilters = {}) {
  return useQuery({
    queryKey: qk.list('users', filters),
    queryFn: (): Promise<OffsetList<UserDto>> =>
      http.list<UserDto>('/api/v1/users', { pageSize: 50, ...filters }),
    staleTime: 60_000,
  });
}

/** Every active user, for owner and assignee pickers. */
export function useAssignableUsers() {
  return useQuery({
    queryKey: qk.list('users', { assignable: true }),
    queryFn: () => http.list<UserDto>('/api/v1/users', { pageSize: 200, isActive: 'true' }),
    staleTime: 5 * 60_000,
    select: (r) => r.data,
  });
}

export function useUser(id: string | null) {
  return useQuery({
    queryKey: qk.entity('user', id ?? ''),
    enabled: id !== null,
    queryFn: () => http.get<UserDto>(`/api/v1/users/${id ?? ''}`),
  });
}

export function useCreateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateUserBody) => http.post<UserDto>('/api/v1/users', body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.list('users') });
    },
  });
}

export function useUpdateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateUserBody }) =>
      http.patch<UserDto>(`/api/v1/users/${id}`, body),
    onSuccess: (u) => {
      void qc.invalidateQueries({ queryKey: qk.list('users') });
      void qc.invalidateQueries({ queryKey: qk.entity('user', u.id) });
    },
  });
}

export function useUserAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action, body }: { id: string; action: string; body?: unknown }) =>
      http.post<UserDto | Record<string, unknown>>(`/api/v1/users/${id}/${action}`, body ?? {}),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.list('users') });
    },
  });
}

export function useUpdateMe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) => http.patch<MeDto>('/api/v1/users/me', body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.me() });
    },
  });
}

export function useTeams() {
  return useQuery({
    queryKey: qk.list('teams'),
    queryFn: () => http.get<TeamDto[]>('/api/v1/teams'),
    staleTime: 5 * 60_000,
  });
}

export function useTeamMutations() {
  const qc = useQueryClient();
  const done = () => {
    void qc.invalidateQueries({ queryKey: qk.list('teams') });
    void qc.invalidateQueries({ queryKey: qk.list('users') });
  };
  return {
    create: useMutation({
      mutationFn: (body: unknown) => http.post<TeamDto>('/api/v1/teams', body),
      onSuccess: done,
    }),
    update: useMutation({
      mutationFn: ({ id, body }: { id: string; body: unknown }) =>
        http.patch<TeamDto>(`/api/v1/teams/${id}`, body),
      onSuccess: done,
    }),
    remove: useMutation({
      mutationFn: (id: string) => http.del(`/api/v1/teams/${id}`),
      onSuccess: done,
    }),
    setMembers: useMutation({
      mutationFn: ({ id, userIds }: { id: string; userIds: string[] }) =>
        http.post<TeamDto>(`/api/v1/teams/${id}/members`, { userIds }),
      onSuccess: done,
    }),
  };
}
