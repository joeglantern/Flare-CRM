/**
 * Tasks & reminders (R-7.3). Reminders are BullMQ delayed jobs; the job id is stored so
 * rescheduling/cancelling is exact.
 */
import type {
  bulkTasksBody,
  CreateTaskBody,
  TaskDto,
  UpdateTaskBody,
  VisibilityScope,
  calendarQuery,
  listTasksQuery,
} from '@crm/shared';
import type { FastifyInstance } from 'fastify';
import type { z } from 'zod';
import type { Prisma } from '../../generated/prisma/client.js';
import { NotFoundError, StaleVersionError, ValidationError } from '../../lib/errors.js';
import { newId } from '../../lib/ids.js';
import { isoOrNull } from '../../lib/object.js';
import { SHAPES, assertCanAssign, assertCanWrite, scopeWhere } from '../../lib/scope.js';
import { QUEUES } from '../../jobs/queues.js';
import type { AuditContext } from '../audit/audit.service.js';

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
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.TaskSelect;

type TaskRow = Prisma.TaskGetPayload<{ select: typeof taskSelect }>;

export class TasksService {
  constructor(private readonly app: FastifyInstance) {}

  private get db() {
    return this.app.db;
  }

  private async creatorNames(rows: TaskRow[]): Promise<Map<string, string>> {
    const ids = [...new Set(rows.map((r) => r.createdById).filter((v): v is string => v !== null))];
    if (ids.length === 0) return new Map();
    const users = await this.db.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true },
    });
    return new Map(users.map((u) => [u.id, u.name]));
  }

  toDto(r: TaskRow, names: Map<string, string>): TaskDto {
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
      createdBy: r.createdById
        ? { id: r.createdById, name: names.get(r.createdById) ?? 'Unknown' }
        : null,
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
        },
      });
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
    if (assigneeId && assigneeId !== actor.id) {
      await this.app.notifications.notify({
        userId: assigneeId,
        type: 'task_assigned',
        title: `New task: ${body.title}`,
        body: body.dueAt ? `Due ${new Date(body.dueAt).toISOString()}` : null,
        data: { taskId: id, url: `/tasks/${id}` },
      });
    }
    return this.get(scope, id);
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
          ...(body.assigneeId !== undefined ? { assigneeId: body.assigneeId } : {}),
          ...(body.contactId !== undefined ? { contactId: body.contactId } : {}),
          ...(body.dealId !== undefined ? { dealId: body.dealId } : {}),
          ...(body.companyId !== undefined ? { companyId: body.companyId } : {}),
        },
      });
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
    if (body.assigneeId && body.assigneeId !== before.assigneeId && body.assigneeId !== actor.id) {
      await this.app.notifications.notify({
        userId: body.assigneeId,
        type: 'task_assigned',
        title: `Task assigned to you: ${after.title}`,
        body: null,
        data: { taskId: id, url: `/tasks/${id}` },
      });
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
        url: `/tasks/${task.id}`,
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
