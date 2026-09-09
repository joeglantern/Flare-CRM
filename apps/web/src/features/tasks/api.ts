/**
 * Tasks (docs/09 · Tasks).
 */
import type { CreateTaskBody, TaskDto, UpdateTaskBody } from '@crm/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from '@/components/ui/toast';
import { http, type OffsetList, type Query } from '@/lib/api/client';
import { errorMessage } from '@/lib/api/errors';
import { qk } from '@/lib/query';

export interface TaskFilters extends Query {
  q?: string;
  assigneeId?: string;
  /** The server reads 'true' | 'false', not a boolean. */
  mine?: 'true' | 'false';
  status?: string;
  type?: string;
  priority?: string;
  contactId?: string;
  dealId?: string;
  companyId?: string;
  overdue?: 'true';
  /** ISO date-times. There is no 'due=today' shorthand on the server; the screen computes the range. */
  from?: string;
  to?: string;
  sort?: string;
  page?: number;
  pageSize?: number;
}

/** GET /tasks/calendar takes only these three. Everything else is filtered in the browser. */
export interface CalendarFilters extends Query {
  from: string;
  to: string;
  assigneeId?: string;
}

export function useTasks(filters: TaskFilters = {}, enabled = true) {
  return useQuery({
    queryKey: qk.list('tasks', filters),
    enabled,
    queryFn: (): Promise<OffsetList<TaskDto>> => http.list<TaskDto>('/api/v1/tasks', filters),
  });
}

export function useTaskCalendar(params: CalendarFilters, enabled = true) {
  return useQuery({
    queryKey: qk.list('tasks-calendar', params),
    enabled,
    queryFn: () => http.get<TaskDto[]>('/api/v1/tasks/calendar', params),
  });
}

export function useTask(id: string | null) {
  return useQuery({
    queryKey: qk.entity('task', id ?? ''),
    enabled: id !== null,
    queryFn: () => http.get<TaskDto>(`/api/v1/tasks/${id ?? ''}`),
  });
}

function useTaskInvalidation() {
  const qc = useQueryClient();
  return (task?: TaskDto) => {
    void qc.invalidateQueries({ queryKey: qk.list('tasks') });
    void qc.invalidateQueries({ queryKey: qk.list('tasks-calendar') });
    if (task?.contact != null)
      void qc.invalidateQueries({ queryKey: qk.timeline('contact', task.contact.id) });
    if (task?.deal != null)
      void qc.invalidateQueries({ queryKey: qk.timeline('deal', task.deal.id) });
  };
}

export function useCreateTask() {
  const invalidate = useTaskInvalidation();
  return useMutation({
    mutationFn: (body: CreateTaskBody | Record<string, unknown>) =>
      http.post<TaskDto>('/api/v1/tasks', body),
    onSuccess: (t) => {
      invalidate(t);
    },
  });
}

export function useUpdateTask() {
  const invalidate = useTaskInvalidation();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateTaskBody | Record<string, unknown> }) =>
      http.patch<TaskDto>(`/api/v1/tasks/${id}`, body),
    onSuccess: (t) => {
      invalidate(t);
      void qc.invalidateQueries({ queryKey: qk.entity('task', t.id) });
    },
  });
}

export function useDeleteTask() {
  const invalidate = useTaskInvalidation();
  return useMutation({
    mutationFn: (id: string) => http.del(`/api/v1/tasks/${id}`),
    onSuccess: () => {
      invalidate();
    },
  });
}

/**
 * Optimistic completion — the endpoint is idempotent, which is the bar set for optimistic UI.
 */
export function useCompleteTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { id: string; done?: boolean }) =>
      http.post<TaskDto>(`/api/v1/tasks/${id}/complete`),
    onMutate: async ({ id }) => {
      await qc.cancelQueries({ queryKey: qk.list('tasks') });
      const snapshots = qc.getQueriesData<OffsetList<TaskDto>>({ queryKey: qk.list('tasks') });
      for (const [key, value] of snapshots) {
        if (value === undefined) continue;
        qc.setQueryData<OffsetList<TaskDto>>(key, {
          ...value,
          data: value.data.map((t) => (t.id === id ? { ...t, status: 'done' } : t)),
        });
      }
      return { snapshots };
    },
    onError: (err, _v, ctx) => {
      for (const [key, value] of ctx?.snapshots ?? []) qc.setQueryData(key, value);
      toast({
        tone: 'danger',
        title: 'Could not complete the task',
        description: errorMessage(err),
      });
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: qk.list('tasks') });
      void qc.invalidateQueries({ queryKey: qk.list('tasks-calendar') });
    },
  });
}

export function useBulkTaskAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      ids: string[];
      label: string;
      action: 'complete' | 'assign';
      assigneeId?: string | null;
    }) =>
      http.post<{ affected: number; skipped: string[] }>('/api/v1/tasks/bulk', {
        action: body.action,
        ids: body.ids,
        ...(body.assigneeId !== undefined ? { assigneeId: body.assigneeId } : {}),
      }),
    onSuccess: ({ affected, skipped }, { label }) => {
      toast({
        key: 'bulk-tasks',
        tone: skipped.length > 0 ? 'warning' : 'success',
        title:
          skipped.length > 0
            ? `${label}: ${String(affected)} done, ${String(skipped.length)} skipped`
            : `${label}: ${String(affected)} done`,
        description: skipped.length > 0 ? 'The skipped rows were left unchanged.' : undefined,
        duration: 6000,
      });
      void qc.invalidateQueries({ queryKey: qk.list('tasks') });
      void qc.invalidateQueries({ queryKey: qk.list('tasks-calendar') });
    },
  });
}
