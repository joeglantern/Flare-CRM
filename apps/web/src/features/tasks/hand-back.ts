import type { TaskDto } from '@crm/shared';

/** Who a hand-back would return the task to, or null when there is nobody to return it to. */
export function handBackTarget(task: TaskDto, meId: string): { id: string; name: string } | null {
  if (task.assigneeId !== meId) return null;
  if (task.status === 'done' || task.status === 'cancelled') return null;
  const to = task.assignedBy ?? task.createdBy;
  return to === null || to.id === meId ? null : to;
}
