/**
 * Tasks & reminders (R-7.3). Reminders are BullMQ delayed jobs; the job id is stored so
 * rescheduling/cancelling is exact.
 *
 * Anyone with task:assign can give a task to another active user. The assignee can hand it back
 * with a reason; it returns to whoever gave it to them, and the task keeps both in its history.
 */
import type {
  bulkTasksBody,
  CreateTaskBody,
  DeclineTaskBody,
  TaskAssigneeDto,
  TaskDto,
  TaskEventDto,
  UpdateTaskBody,
  VisibilityScope,
  calendarQuery,
  listTasksQuery,
} from '@crm/shared';
import type { FastifyInstance } from 'fastify';
import type { z } from 'zod';
import type { Prisma } from '../../generated/prisma/client.js';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  StaleVersionError,
  ValidationError,
} from '../../lib/errors.js';
import { newId } from '../../lib/ids.js';
import { isoOrNull } from '../../lib/object.js';
import { SHAPES, assertCanAssign, assertCanWrite, scopeWhere } from '../../lib/scope.js';
import { QUEUES } from '../../jobs/queues.js';
import type { AuditContext } from '../audit/audit.service.js';
import {
  taskAssignedEmail,
  taskHandedBackEmail,
  type TaskMailTask,
} from '../notifications/templates/tasks.js';

export interface Actor {
  id: string;
  canAssign: boolean;
}

export const taskSelect = {
  id: true,
  title: true,
  description: true,
  type: true,
  status: true,
  priority: true,
  dueAt: true,
  remindAt: true,
  reminderJobId: true,
  reminderSentAt: true,
  assigneeId: true,
  assignee: { select: { id: true, name: true } },
  contactId: true,
  contact: { select: { id: true, displayName: true } },
  dealId: true,
  deal: { select: { id: true, title: true } },
  companyId: true,
  company: { select: { id: true, name: true } },
  sourceCallId: true,
  completedAt: true,
  createdById: true,
  assignedById: true,
  // Only the latest event: it says whether the task is sitting with someone it was handed back to.
  events: {
    orderBy: { createdAt: 'desc' },
    take: 1,
    select: { kind: true, actorId: true, toUserId: true, note: true, createdAt: true },
  },
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.TaskSelect;

/** The link every task notification and email opens. */
export function taskPath(id: string): string {
  return `/tasks?taskId=${id}`;
}

type TaskRow = Prisma.TaskGetPayload<{ select: typeof taskSelect }>;

export class TasksService {
  constructor(private readonly app: FastifyInstance) {}

  private get db() {
    return this.app.db;
  }

  private async creatorNames(rows: TaskRow[]): Promise<Map<string, string>> {
    return this.userNames(
      rows.flatMap((r) => [r.createdById, r.assignedById, r.events[0]?.actorId ?? null]),
    );
  }

  private async userNames(candidates: (string | null)[]): Promise<Map<string, string>> {
    const ids = [...new Set(candidates.filter((v): v is string => v !== null))];
    if (ids.length === 0) return new Map();
    const users = await this.db.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true },
    });
    return new Map(users.map((u) => [u.id, u.name]));
  }

  toDto(r: TaskRow, names: Map<string, string>): TaskDto {
    const ref = (id: string) => ({ id, name: names.get(id) ?? 'Unknown' });
    const latest = r.events[0];
    const handedBack =
      latest?.kind === 'handed_back' &&
      latest.toUserId === r.assigneeId &&
      latest.actorId !== null &&
      latest.note !== null
        ? { note: latest.note, by: ref(latest.actorId), at: latest.createdAt.toISOString() }
        : null;
    return {
      id: r.id,
      title: r.title,
      description: r.description,
      type: r.type as TaskDto['type'],
      status: r.status as TaskDto['status'],
      priority: r.priority as TaskDto['priority'],
      dueAt: isoOrNull(r.dueAt),
      remindAt: isoOrNull(r.remindAt),
      reminderSentAt: isoOrNull(r.reminderSentAt),
      assignee: r.assignee,
      assigneeId: r.assigneeId,
      contact: r.contact,
      contactId: r.contactId,
      deal: r.deal,
      dealId: r.dealId,
      company: r.company,
      companyId: r.companyId,
      sourceCallId: r.sourceCallId,
      completedAt: isoOrNull(r.completedAt),
      createdBy: r.createdById ? ref(r.createdById) : null,
      assignedBy:
        r.assignedById !== null && r.assignedById !== r.assigneeId ? ref(r.assignedById) : null,
      handedBack,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
  }

  private async dtoOf(row: TaskRow): Promise<TaskDto> {
    return this.toDto(row, await this.creatorNames([row]));
  }

  private async assertParents(
    scope: VisibilityScope,
    body: {
      contactId?: string | null | undefined;
      dealId?: string | null | undefined;
      companyId?: string | null | undefined;
    },
  ) {
    if (body.contactId) {
      const c = await this.db.contact.findFirst({
        where: { id: body.contactId, ...scopeWhere(scope, SHAPES.contact) },
        select: { id: true },
      });
      if (!c) throw new ValidationError([{ path: 'contactId', message: 'Contact not found' }]);
    }
    if (body.dealId) {
      const d = await this.db.deal.findFirst({
        where: { id: body.dealId, ...(scopeWhere(scope, SHAPES.deal) as Prisma.DealWhereInput) },
        select: { id: true },
      });
      if (!d) throw new ValidationError([{ path: 'dealId', message: 'Deal not found' }]);
    }
    if (body.companyId) {
      const c = await this.db.company.findFirst({
        where: { id: body.companyId, ...scopeWhere(scope, SHAPES.company) },
        select: { id: true },
      });
      if (!c) throw new ValidationError([{ path: 'companyId', message: 'Company not found' }]);
    }
  }

  private async assertAssignee(assigneeId: string | null | undefined) {
    if (!assigneeId) return;
    const u = await this.db.user.findFirst({
      where: { id: assigneeId, isActive: true },
      select: { id: true },
    });
    if (!u) throw new ValidationError([{ path: 'assigneeId', message: 'Assignee not found' }]);
  }

  async list(scope: VisibilityScope, actorId: string, q: z.infer<typeof listTasksQuery>) {
    const now = new Date();
    const where: Prisma.TaskWhereInput = {
      AND: [
        scopeWhere(scope, SHAPES.task),
        ...(q.mine === 'true' ? [{ assigneeId: actorId }] : []),
        ...(q.assigneeId ? [{ assigneeId: q.assigneeId }] : []),
        ...(q.status ? [{ status: q.status }] : []),
        ...(q.type ? [{ type: q.type }] : []),
        ...(q.priority ? [{ priority: q.priority }] : []),
        ...(q.contactId ? [{ contactId: q.contactId }] : []),
        ...(q.dealId ? [{ dealId: q.dealId }] : []),
        ...(q.companyId ? [{ companyId: q.companyId }] : []),
        ...(q.overdue ? [{ dueAt: { lt: now }, status: { in: ['open', 'in_progress'] } }] : []),
        ...(q.from || q.to
          ? [
              {
                dueAt: {
                  ...(q.from ? { gte: new Date(q.from) } : {}),
                  ...(q.to ? { lte: new Date(q.to) } : {}),
                },
              },
            ]
          : []),
        ...(q.q ? [{ title: { contains: q.q, mode: 'insensitive' as const } }] : []),
      ],
    };
    const orderBy =
      q.sort.length > 0
        ? q.sort.map((s) => ({ [s.field]: s.direction }))
        : [
            { dueAt: { sort: 'asc' as const, nulls: 'last' as const } },
            { createdAt: 'desc' as const },
          ];
    const [rows, total] = await Promise.all([
      this.db.task.findMany({
        where,
        select: taskSelect,
        orderBy,
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.db.task.count({ where }),
    ]);
    const names = await this.creatorNames(rows);
    return {
      data: rows.map((r) => this.toDto(r, names)),
      page: { page: q.page, pageSize: q.pageSize, total },
    };
  }

  async calendar(scope: VisibilityScope, q: z.infer<typeof calendarQuery>) {
    const rows = await this.db.task.findMany({
      where: {
        AND: [
          scopeWhere(scope, SHAPES.task) as Prisma.TaskWhereInput,
          { dueAt: { gte: new Date(q.from), lte: new Date(q.to) } },
          ...(q.assigneeId ? [{ assigneeId: q.assigneeId }] : []),
        ],
      },
      select: taskSelect,
      orderBy: { dueAt: 'asc' },
      take: 2000,
    });
    const names = await this.creatorNames(rows);
    return rows.map((r) => this.toDto(r, names));
  }

  async getVisible(scope: VisibilityScope, id: string): Promise<TaskRow> {
    const row = await this.db.task.findFirst({
      where: { id, ...(scopeWhere(scope, SHAPES.task) as Prisma.TaskWhereInput) },
      select: taskSelect,
    });
    if (!row) throw new NotFoundError('Task');
    return row;
  }

  async get(scope: VisibilityScope, id: string): Promise<TaskDto> {
    return this.dtoOf(await this.getVisible(scope, id));
  }

  private async scheduleReminder(
    taskId: string,
    remindAt: Date | null,
    previousJobId: string | null,
  ): Promise<string | null> {
    if (previousJobId) await this.app.queues.remove(QUEUES.taskReminder, previousJobId);
    if (!remindAt) return null;
    const delay = Math.max(0, remindAt.getTime() - Date.now());
    const jobId = `task-reminder-${taskId}-${remindAt.getTime()}`;
    await this.app.queues.add(
      QUEUES.taskReminder,
      'remind',
      { taskId },
      { delay, jobId, attempts: 3 },
    );
    return jobId;
  }

  async create(
    scope: VisibilityScope,
    actor: Actor,
    body: CreateTaskBody,
    ctx: AuditContext,
  ): Promise<TaskDto> {
    assertCanAssign(actor.canAssign, body.assigneeId, actor.id);
    await this.assertParents(scope, body);
    await this.assertAssignee(body.assigneeId);
    const id = newId();
    const assigneeId = body.assigneeId === undefined ? actor.id : body.assigneeId;
    const givenToSomeoneElse = assigneeId !== null && assigneeId !== actor.id;
    const remindAt = body.remindAt ? new Date(body.remindAt) : null;
    await this.db.$transaction(async (tx) => {
      await tx.task.create({
        data: {
          id,
          title: body.title,
          description: body.description ?? null,
          type: body.type,
          priority: body.priority,
          dueAt: body.dueAt ? new Date(body.dueAt) : null,
          remindAt,
          assigneeId,
          contactId: body.contactId ?? null,
          dealId: body.dealId ?? null,
          companyId: body.companyId ?? null,
          sourceCallId: body.sourceCallId ?? null,
          createdById: actor.id,
          assignedById: givenToSomeoneElse ? actor.id : null,
        },
      });
      if (givenToSomeoneElse) {
        await tx.taskEvent.create({
          data: {
            id: newId(),
            taskId: id,
            kind: 'assigned',
            actorId: actor.id,
            fromUserId: null,
            toUserId: assigneeId,
          },
        });
      }
      if (body.contactId || body.dealId || body.companyId) {
        await this.app.activity.record(tx, {
          type: 'task_created',
          contactId: body.contactId ?? null,
          dealId: body.dealId ?? null,
          companyId: body.companyId ?? null,
          actorId: actor.id,
          summary: `Task created: ${body.title}`,
          refTable: 'tasks',
          refId: id,
          meta: { type: body.type, dueAt: body.dueAt ?? null, assigneeId },
        });
      }
      await this.app.audit.writeWith(tx, ctx, {
        action: 'task.create',
        entity: 'task',
        entityId: id,
        after: body,
      });
    });
    const jobId = await this.scheduleReminder(id, remindAt, null);
    if (jobId) await this.db.task.update({ where: { id }, data: { reminderJobId: jobId } });
    this.app.events.emit('task.created', {
      taskId: id,
      assigneeId,
      byUserId: actor.id,
      remindAt: remindAt?.toISOString() ?? null,
    });
    const created = await this.getRow(id);
    if (givenToSomeoneElse) await this.notifyAssigned(created, assigneeId, actor.id);
    return this.dtoOf(created);
  }

  /** Read without a scope, for work that follows a write the caller was already allowed. */
  private async getRow(id: string): Promise<TaskRow> {
    const row = await this.db.task.findFirst({ where: { id }, select: taskSelect });
    if (!row) throw new NotFoundError('Task');
    return row;
  }

  private mailTask(row: TaskRow): TaskMailTask {
    return {
      id: row.id,
      title: row.title,
      description: row.description,
      dueAt: row.dueAt,
      priority: row.priority,
      about: row.contact?.displayName ?? row.deal?.title ?? row.company?.name ?? null,
    };
  }

  private async nameOf(userId: string): Promise<string> {
    return (await this.userNames([userId])).get(userId) ?? 'Someone';
  }

  private async notifyAssigned(row: TaskRow, assigneeId: string, byUserId: string): Promise<void> {
    const by = await this.nameOf(byUserId);
    const task = this.mailTask(row);
    await this.app.notifications.notify({
      userId: assigneeId,
      type: 'task_assigned',
      title: `${by} gave you a task: ${row.title}`,
      body: row.description?.trim() ? row.description.trim().slice(0, 280) : null,
      data: {
        taskId: row.id,
        url: taskPath(row.id),
        byUserId,
        dueAt: row.dueAt?.toISOString() ?? null,
      },
      email: (to, installation) => taskAssignedEmail({ to, task, assignedBy: by, installation }),
    });
  }

  async update(
    scope: VisibilityScope,
    actor: Actor,
    id: string,
    body: UpdateTaskBody,
    ctx: AuditContext,
  ): Promise<TaskDto> {
    const before = await this.getVisible(scope, id);
    assertCanWrite(scope, before.assigneeId, actor.id);
    assertCanAssign(actor.canAssign, body.assigneeId, actor.id);
    if (
      body.expectedUpdatedAt &&
      new Date(body.expectedUpdatedAt).getTime() !== before.updatedAt.getTime()
    )
      throw new StaleVersionError();
    await this.assertParents(scope, body);
    await this.assertAssignee(body.assigneeId);
    const completing = body.status === 'done' && before.status !== 'done';
    const remindAt =
      body.remindAt === undefined
        ? before.remindAt
        : body.remindAt
          ? new Date(body.remindAt)
          : null;
    const reminderChanged = body.remindAt !== undefined || completing;
    const reassigning = body.assigneeId !== undefined && body.assigneeId !== before.assigneeId;

    await this.db.$transaction(async (tx) => {
      await tx.task.update({
        where: { id },
        data: {
          ...(body.title !== undefined ? { title: body.title } : {}),
          ...(body.description !== undefined ? { description: body.description } : {}),
          ...(body.type !== undefined ? { type: body.type } : {}),
          ...(body.status !== undefined
            ? { status: body.status, completedAt: body.status === 'done' ? new Date() : null }
            : {}),
          ...(body.priority !== undefined ? { priority: body.priority } : {}),
          ...(body.dueAt !== undefined ? { dueAt: body.dueAt ? new Date(body.dueAt) : null } : {}),
          ...(body.remindAt !== undefined ? { remindAt } : {}),
          ...(reassigning
            ? {
                assigneeId: body.assigneeId ?? null,
                assignedById:
                  body.assigneeId !== null && body.assigneeId !== actor.id ? actor.id : null,
              }
            : {}),
          ...(body.contactId !== undefined ? { contactId: body.contactId } : {}),
          ...(body.dealId !== undefined ? { dealId: body.dealId } : {}),
          ...(body.companyId !== undefined ? { companyId: body.companyId } : {}),
        },
      });
      if (reassigning) {
        await tx.taskEvent.create({
          data: {
            id: newId(),
            taskId: id,
            kind: 'assigned',
            actorId: actor.id,
            fromUserId: before.assigneeId,
            toUserId: body.assigneeId ?? null,
          },
        });
      }
      if (completing && (before.contactId || before.dealId || before.companyId)) {
        await this.app.activity.record(tx, {
          type: 'task_completed',
          contactId: before.contactId,
          dealId: before.dealId,
          companyId: before.companyId,
          actorId: actor.id,
          summary: `Task completed: ${before.title}`,
          refTable: 'tasks',
          refId: id,
        });
      }
      await this.app.audit.writeWith(tx, ctx, {
        action: 'task.update',
        entity: 'task',
        entityId: id,
        before: { status: before.status, assigneeId: before.assigneeId, dueAt: before.dueAt },
        after: body,
      });
    });

    if (reminderChanged) {
      const jobId = completing
        ? await this.scheduleReminder(id, null, before.reminderJobId)
        : await this.scheduleReminder(id, remindAt, before.reminderJobId);
      await this.db.task.update({ where: { id }, data: { reminderJobId: jobId } });
    }
    const after = await this.get(scope, id);
    if (completing)
      this.app.events.emit('task.completed', {
        taskId: id,
        assigneeId: after.assigneeId,
        byUserId: actor.id,
      });
    else
      this.app.events.emit('task.updated', {
        taskId: id,
        assigneeId: after.assigneeId,
        remindAt: after.remindAt,
        status: after.status,
      });
    if (reassigning && body.assigneeId && body.assigneeId !== actor.id) {
      await this.notifyAssigned(await this.getRow(id), body.assigneeId, actor.id);
    }
    return after;
  }

  async complete(
    scope: VisibilityScope,
    actor: Actor,
    id: string,
    ctx: AuditContext,
  ): Promise<TaskDto> {
    return this.update(scope, actor, id, { status: 'done' }, ctx);
  }

  /**
   * Runs `update` per task rather than one SQL statement, because completing or reassigning a
   * task also reschedules its reminder job, records activity and notifies the new assignee, all
   * of which depend on that task's own state. A row that is not visible, not writable, or fails
   * its own validation is skipped rather than failing the whole batch, matching what the browser
   * did when this ran as one request per row (formerly GAP-03).
   */
  async bulk(
    scope: VisibilityScope,
    actor: Actor,
    body: z.infer<typeof bulkTasksBody>,
    ctx: AuditContext,
  ): Promise<{ affected: number; skipped: string[] }> {
    const patch: UpdateTaskBody =
      body.action === 'complete' ? { status: 'done' } : { assigneeId: body.assigneeId ?? null };
    const skipped: string[] = [];
    let affected = 0;
    for (const id of body.ids) {
      try {
        await this.update(scope, actor, id, patch, ctx);
        affected++;
      } catch (err) {
        // Expected for a row outside scope, unwritable, or failing its own validation; logged for
        // anything less ordinary, since the client only ever sees the id, not why it was skipped.
        this.app.log.debug({ err, taskId: id }, 'bulk task update skipped');
        skipped.push(id);
      }
    }
    return { affected, skipped };
  }

  /**
   * The assignee returns a task they think is not theirs. It goes back to whoever gave it to them,
   * or to its creator for tasks from before assigners were recorded, and stays open. The person it
   * returns to then holds it as they did before it was passed on, so a hand-back from them unwinds
   * one more step rather than bouncing it straight back.
   */
  async decline(
    scope: VisibilityScope,
    actor: Actor,
    id: string,
    body: DeclineTaskBody,
    ctx: AuditContext,
  ): Promise<TaskDto> {
    const before = await this.getVisible(scope, id);
    if (before.assigneeId !== actor.id) {
      throw new ForbiddenError('Only the person a task is assigned to can hand it back');
    }
    if (before.status === 'done' || before.status === 'cancelled') {
      throw new ConflictError('This task is closed, so there is nothing to hand back');
    }
    const returnTo = before.assignedById ?? before.createdById;
    if (returnTo === null || returnTo === actor.id) {
      throw new ConflictError(
        'Nobody else gave you this task, so there is nobody to hand it back to',
      );
    }
    const recipient = await this.db.user.findFirst({
      where: { id: returnTo, isActive: true },
      select: { id: true },
    });
    if (!recipient) {
      throw new ConflictError(
        'The person who gave you this task is no longer active. Ask a manager to reassign it.',
      );
    }
    const theirAssigner = await this.db.taskEvent.findFirst({
      where: { taskId: id, kind: 'assigned', toUserId: returnTo, actorId: { not: returnTo } },
      orderBy: { createdAt: 'desc' },
      select: { actorId: true },
    });
    const note = body.note.trim();

    await this.db.$transaction(async (tx) => {
      // The assignee check is repeated in the write so two hand-backs, or a hand-back racing a
      // reassignment, cannot both land.
      const moved = await tx.task.updateMany({
        where: { id, assigneeId: actor.id, deletedAt: null },
        data: {
          assigneeId: returnTo,
          assignedById: theirAssigner?.actorId ?? null,
          status: 'open',
          completedAt: null,
        },
      });
      if (moved.count === 0) throw new StaleVersionError();
      await tx.taskEvent.create({
        data: {
          id: newId(),
          taskId: id,
          kind: 'handed_back',
          actorId: actor.id,
          fromUserId: actor.id,
          toUserId: returnTo,
          note,
        },
      });
      await this.app.audit.writeWith(tx, ctx, {
        action: 'task.hand_back',
        entity: 'task',
        entityId: id,
        before: { assigneeId: before.assigneeId, status: before.status },
        after: { assigneeId: returnTo, status: 'open', note },
      });
    });

    const row = await this.getRow(id);
    this.app.events.emit('task.updated', {
      taskId: id,
      assigneeId: returnTo,
      remindAt: row.remindAt?.toISOString() ?? null,
      status: row.status,
    });
    const by = await this.nameOf(actor.id);
    const task = this.mailTask(row);
    await this.app.notifications.notify({
      userId: returnTo,
      type: 'task_declined',
      title: `${by} handed back: ${row.title}`,
      body: note.length > 280 ? `${note.slice(0, 279)}…` : note,
      data: { taskId: id, url: taskPath(id), byUserId: actor.id },
      email: (to, installation) =>
        taskHandedBackEmail({ to, task, handedBackBy: by, note, installation }),
    });
    return this.dtoOf(row);
  }

  /** Who gave the task to whom, and every hand-back with its reason, oldest first. */
  async history(scope: VisibilityScope, id: string): Promise<TaskEventDto[]> {
    await this.getVisible(scope, id);
    const rows = await this.db.taskEvent.findMany({
      where: { taskId: id },
      orderBy: { createdAt: 'asc' },
      take: 200,
    });
    const names = await this.userNames(rows.flatMap((r) => [r.actorId, r.fromUserId, r.toUserId]));
    const ref = (userId: string | null) =>
      userId === null ? null : { id: userId, name: names.get(userId) ?? 'Unknown' };
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind as TaskEventDto['kind'],
      actor: ref(r.actorId),
      from: ref(r.fromUserId),
      to: ref(r.toUserId),
      note: r.note,
      at: r.createdAt.toISOString(),
    }));
  }

  /** Active people a task can be given to, for the assignee picker. */
  async assignees(avatarUrl: (key: string | null) => string | null): Promise<TaskAssigneeDto[]> {
    const rows = await this.db.user.findMany({
      where: { isActive: true },
      select: { id: true, name: true, avatarKey: true, extension: true },
      orderBy: { name: 'asc' },
      take: 1000,
    });
    return rows.map((u) => ({
      id: u.id,
      name: u.name,
      avatarUrl: avatarUrl(u.avatarKey),
      extension: u.extension,
    }));
  }

  async softDelete(
    scope: VisibilityScope,
    actor: Actor,
    id: string,
    ctx: AuditContext,
  ): Promise<void> {
    const before = await this.getVisible(scope, id);
    assertCanWrite(scope, before.assigneeId, actor.id);
    await this.db.$transaction(async (tx) => {
      await tx.task.update({ where: { id }, data: { deletedAt: new Date() } });
      await this.app.audit.writeWith(tx, ctx, {
        action: 'task.delete',
        entity: 'task',
        entityId: id,
        before: { title: before.title },
      });
    });
    if (before.reminderJobId)
      await this.app.queues.remove(QUEUES.taskReminder, before.reminderJobId);
  }

  /** Called by the worker when a reminder fires. */
  async fireReminder(taskId: string): Promise<void> {
    const task = await this.db.task.findFirst({
      where: { id: taskId, status: { in: ['open', 'in_progress'] } },
      select: taskSelect,
    });
    if (!task?.assigneeId) return;
    await this.app.notifications.notify({
      userId: task.assigneeId,
      type: 'task_due',
      title: `Reminder: ${task.title}`,
      body: task.dueAt ? `Due ${task.dueAt.toISOString()}` : null,
      data: {
        taskId: task.id,
        url: taskPath(task.id),
        contactId: task.contactId,
        dealId: task.dealId,
        dueAt: task.dueAt?.toISOString() ?? null,
      },
    });
    await this.db.task.update({
      where: { id: taskId },
      data: { reminderSentAt: new Date(), reminderJobId: null },
    });
  }
}
