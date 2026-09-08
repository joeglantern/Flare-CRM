/**
 * Admin data: custom fields, pipelines, dispositions, web forms, audit log and system status.
 */
import type { BackupDto, CustomFieldDefinitionDto, PipelineDto, WebFormDto } from '@crm/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { http, type OffsetList, type Query } from '@/lib/api/client';
import { qk } from '@/lib/query';

export type CustomFieldEntity = 'contact' | 'company' | 'deal' | 'lead';

export function useCustomFields(entity: CustomFieldEntity | undefined, enabled = true) {
  return useQuery({
    queryKey: qk.list('custom-fields', { entity }),
    enabled,
    staleTime: 5 * 60_000,
    queryFn: () =>
      http.get<CustomFieldDefinitionDto[]>(
        '/api/v1/custom-fields',
        entity !== undefined ? { entity } : {},
      ),
  });
}

export function useCustomFieldMutations() {
  const qc = useQueryClient();
  const done = () => {
    void qc.invalidateQueries({ queryKey: qk.list('custom-fields') });
  };
  return {
    create: useMutation({
      mutationFn: (body: unknown) =>
        http.post<CustomFieldDefinitionDto>('/api/v1/custom-fields', body),
      onSuccess: done,
    }),
    update: useMutation({
      mutationFn: ({ id, body }: { id: string; body: unknown }) =>
        http.patch<CustomFieldDefinitionDto>(`/api/v1/custom-fields/${id}`, body),
      onSuccess: done,
    }),
    remove: useMutation({
      mutationFn: (id: string) => http.del(`/api/v1/custom-fields/${id}`),
      onSuccess: done,
    }),
    reorder: useMutation({
      mutationFn: (ids: string[]) => http.post('/api/v1/custom-fields/reorder', { ids }),
      onSuccess: done,
    }),
  };
}

export function usePipelineMutations() {
  const qc = useQueryClient();
  const done = () => {
    void qc.invalidateQueries({ queryKey: qk.list('pipelines') });
    void qc.invalidateQueries({ queryKey: qk.list('deal-board') });
  };
  return {
    create: useMutation({
      mutationFn: (body: unknown) => http.post<PipelineDto>('/api/v1/pipelines', body),
      onSuccess: done,
    }),
    update: useMutation({
      mutationFn: ({ id, body }: { id: string; body: unknown }) =>
        http.patch<PipelineDto>(`/api/v1/pipelines/${id}`, body),
      onSuccess: done,
    }),
    remove: useMutation({
      mutationFn: (id: string) => http.del(`/api/v1/pipelines/${id}`),
      onSuccess: done,
    }),
    addStage: useMutation({
      mutationFn: ({ id, body }: { id: string; body: unknown }) =>
        http.post<PipelineDto>(`/api/v1/pipelines/${id}/stages`, body),
      onSuccess: done,
    }),
    updateStage: useMutation({
      mutationFn: ({ id, stageId, body }: { id: string; stageId: string; body: unknown }) =>
        http.patch<PipelineDto>(`/api/v1/pipelines/${id}/stages/${stageId}`, body),
      onSuccess: done,
    }),
    removeStage: useMutation({
      mutationFn: ({
        id,
        stageId,
        reassignToStageId,
      }: {
        id: string;
        stageId: string;
        reassignToStageId?: string;
      }) =>
        http.del<PipelineDto>(
          `/api/v1/pipelines/${id}/stages/${stageId}`,
          reassignToStageId !== undefined ? { reassignToStageId } : undefined,
        ),
      onSuccess: done,
    }),
    reorderStages: useMutation({
      mutationFn: ({ id, ids }: { id: string; ids: string[] }) =>
        http.post<PipelineDto>(`/api/v1/pipelines/${id}/stages/reorder`, { ids }),
      onSuccess: done,
    }),
  };
}

export function useDispositionMutations() {
  const qc = useQueryClient();
  const done = () => {
    void qc.invalidateQueries({ queryKey: ['call-dispositions'] });
  };
  return {
    create: useMutation({
      mutationFn: (body: unknown) => http.post('/api/v1/call-dispositions', body),
      onSuccess: done,
    }),
    update: useMutation({
      mutationFn: ({ id, body }: { id: string; body: unknown }) =>
        http.patch(`/api/v1/call-dispositions/${id}`, body),
      onSuccess: done,
    }),
    remove: useMutation({
      mutationFn: (id: string) => http.del(`/api/v1/call-dispositions/${id}`),
      onSuccess: done,
    }),
  };
}

export function useWebForms(enabled = true) {
  return useQuery({
    queryKey: qk.list('web-forms'),
    enabled,
    queryFn: () => http.get<WebFormDto[]>('/api/v1/web-forms'),
  });
}

export function useWebFormMutations() {
  const qc = useQueryClient();
  const done = () => {
    void qc.invalidateQueries({ queryKey: qk.list('web-forms') });
  };
  return {
    create: useMutation({
      mutationFn: (body: unknown) => http.post<WebFormDto>('/api/v1/web-forms', body),
      onSuccess: done,
    }),
    update: useMutation({
      mutationFn: ({ id, body }: { id: string; body: unknown }) =>
        http.patch<WebFormDto>(`/api/v1/web-forms/${id}`, body),
      onSuccess: done,
    }),
    remove: useMutation({
      mutationFn: (id: string) => http.del(`/api/v1/web-forms/${id}`),
      onSuccess: done,
    }),
  };
}

export interface AuditRow {
  id: string;
  actorId: string | null;
  actor: { id: string; name: string } | null;
  actorType: string;
  action: string;
  entity: string;
  entityId: string | null;
  before: unknown;
  after: unknown;
  ip: string | null;
  requestId: string | null;
  createdAt: string;
}

export interface AuditFilters extends Query {
  entity?: string;
  entityId?: string;
  actorId?: string;
  action?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

export function useAuditLog(filters: AuditFilters = {}, enabled = true) {
  return useQuery({
    queryKey: qk.list('audit', filters),
    enabled,
    queryFn: (): Promise<OffsetList<AuditRow>> => http.list<AuditRow>('/api/v1/audit', filters),
  });
}

export interface HealthReport {
  status: string;
  ok: boolean;
  checks: Record<string, { ok: boolean; detail?: unknown }>;
}

export function useSystemHealth(enabled = true) {
  return useQuery({
    queryKey: ['system', 'health'],
    enabled,
    refetchInterval: 30_000,
    queryFn: () => http.raw<HealthReport>('GET', '/ready'),
  });
}

export function useUpdateSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      http.patch<Record<string, unknown>>('/api/v1/settings', body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.settings() });
      void qc.invalidateQueries({ queryKey: qk.settingsPublic() });
    },
  });
}

/* -- backups ----------------------------------------------------------------------------- */

export function useBackups(enabled = true) {
  return useQuery({
    queryKey: ['backups'],
    enabled,
    queryFn: () => http.list<BackupDto>('/api/v1/backups'),
  });
}

export function useBackupMutations() {
  const qc = useQueryClient();
  const done = () => {
    void qc.invalidateQueries({ queryKey: ['backups'] });
  };
  return {
    upload: useMutation({
      mutationFn: async (file: File) => {
        const form = new FormData();
        form.append('file', file);
        const res = await fetch('/api/v1/backups/upload', {
          method: 'POST',
          body: form,
          credentials: 'include',
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as {
            error?: { message?: string };
          } | null;
          throw new Error(body?.error?.message ?? 'Upload failed');
        }
        return ((await res.json()) as { data: BackupDto }).data;
      },
      onSuccess: done,
    }),
    remove: useMutation({
      mutationFn: (key: string) => http.del(`/api/v1/backups?key=${encodeURIComponent(key)}`),
      onSuccess: done,
    }),
  };
}
