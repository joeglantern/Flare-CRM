import { z } from 'zod';
import { TaskPriority, TaskStatus, TaskType, valuesOf } from '../enums.js';
import { isoDateTime, paginationOffset, sortParam, uuid } from './common.js';
import { companyRef, userRef } from './company.js';

/** The latest hand-back while the task is still with the person it was returned to. */
export const taskHandBack = z.object({
  note: z.string(),
  by: userRef,
  at: isoDateTime,
});
export type TaskHandBack = z.infer<typeof taskHandBack>;

export const taskDto = z.object({
  id: uuid,
  title: z.string(),
  description: z.string().nullable(),
  type: z.enum(valuesOf(TaskType)),
  status: z.enum(valuesOf(TaskStatus)),
  priority: z.enum(valuesOf(TaskPriority)),
  dueAt: isoDateTime.nullable(),
  remindAt: isoDateTime.nullable(),
  reminderSentAt: isoDateTime.nullable(),
  assignee: userRef.nullable(),
  assigneeId: uuid.nullable(),
  contact: z.object({ id: uuid, displayName: z.string() }).nullable(),
  contactId: uuid.nullable(),
  deal: z.object({ id: uuid, title: z.string() }).nullable(),
  dealId: uuid.nullable(),
  company: companyRef.nullable(),
  companyId: uuid.nullable(),
  sourceCallId: uuid.nullable(),
  completedAt: isoDateTime.nullable(),
  createdBy: userRef.nullable(),
  /** Who gave the task to its current assignee, when that was somebody else. */
  assignedBy: userRef.nullable(),
  handedBack: taskHandBack.nullable(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});
export type TaskDto = z.infer<typeof taskDto>;

export const createTaskBody = z
  .object({
    title: z.string().trim().min(1).max(200),
    description: z.string().max(5000).nullable().optional(),
    type: z.enum(valuesOf(TaskType)).default('follow_up'),
    priority: z.enum(valuesOf(TaskPriority)).default('normal'),
    dueAt: isoDateTime.nullable().optional(),
    remindAt: isoDateTime.nullable().optional(),
    assigneeId: uuid.nullable().optional(),
    contactId: uuid.nullable().optional(),
    dealId: uuid.nullable().optional(),
    companyId: uuid.nullable().optional(),
    sourceCallId: uuid.nullable().optional(),
  })
  .strict();
export type CreateTaskBody = z.infer<typeof createTaskBody>;

export const updateTaskBody = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().max(5000).nullable().optional(),
    type: z.enum(valuesOf(TaskType)).optional(),
    status: z.enum(valuesOf(TaskStatus)).optional(),
    priority: z.enum(valuesOf(TaskPriority)).optional(),
    dueAt: isoDateTime.nullable().optional(),
    remindAt: isoDateTime.nullable().optional(),
    assigneeId: uuid.nullable().optional(),
    contactId: uuid.nullable().optional(),
    dealId: uuid.nullable().optional(),
    companyId: uuid.nullable().optional(),
    expectedUpdatedAt: isoDateTime.optional(),
  })
  .strict();
export type UpdateTaskBody = z.infer<typeof updateTaskBody>;

export const declineTaskBody = z
  .object({ note: z.string().trim().min(1, 'Say why you are handing it back').max(2000) })
  .strict();
export type DeclineTaskBody = z.infer<typeof declineTaskBody>;

export const TaskEventKind = { assigned: 'assigned', handed_back: 'handed_back' } as const;
export type TaskEventKind = (typeof TaskEventKind)[keyof typeof TaskEventKind];

export const taskEventDto = z.object({
  id: uuid,
  kind: z.enum(['assigned', 'handed_back']),
  actor: userRef.nullable(),
  from: userRef.nullable(),
  to: userRef.nullable(),
  note: z.string().nullable(),
  at: isoDateTime,
});
export type TaskEventDto = z.infer<typeof taskEventDto>;

/** Active people a task can be given to. Deliberately no email or role: agents see this list. */
export const taskAssigneeDto = z.object({
  id: uuid,
  name: z.string(),
  avatarUrl: z.string().nullable(),
  extension: z.string().nullable(),
});
export type TaskAssigneeDto = z.infer<typeof taskAssigneeDto>;

export const bulkTasksBody = z
  .object({
    action: z.enum(['complete', 'assign']),
    ids: z.array(uuid).min(1).max(500),
    assigneeId: uuid.nullable().optional(),
  })
  .strict()
  .refine((v) => (v.action === 'assign' ? v.assigneeId !== undefined : true), {
    message: 'assigneeId required',
    path: ['assigneeId'],
  });
export type BulkTasksBody = z.infer<typeof bulkTasksBody>;

export const TASK_SORT = ['dueAt', 'priority', 'createdAt', 'updatedAt', 'title'] as const;
export const listTasksQuery = paginationOffset.extend({
  q: z.string().trim().max(120).optional(),
  assigneeId: uuid.optional(),
  mine: z.enum(['true', 'false']).optional(),
  status: z.enum(valuesOf(TaskStatus)).optional(),
  type: z.enum(valuesOf(TaskType)).optional(),
  priority: z.enum(valuesOf(TaskPriority)).optional(),
  contactId: uuid.optional(),
  dealId: uuid.optional(),
  companyId: uuid.optional(),
  overdue: z.enum(['true']).optional(),
  from: isoDateTime.optional(),
  to: isoDateTime.optional(),
  sort: sortParam(TASK_SORT),
});

export const calendarQuery = z
  .object({ from: isoDateTime, to: isoDateTime, assigneeId: uuid.optional() })
  .refine(
    (v) => new Date(v.to).getTime() - new Date(v.from).getTime() <= 1000 * 60 * 60 * 24 * 62,
    {
      message: 'Range must be 62 days or less',
      path: ['to'],
    },
  );
