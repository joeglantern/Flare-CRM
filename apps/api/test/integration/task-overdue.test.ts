/**
 * A task given to someone else that passes its due time unfinished is reported, once, to the
 * person who gave it: in the app and by email.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TasksService } from '../../src/modules/tasks/tasks.service.js';
import { TestContext, type TestUser } from '../setup/test-app.js';

describe('tasks: the giver hears when a task they gave is past due and not done', () => {
  let ctx: TestContext;
  let tasks: TasksService;
  let manager: TestUser;
  let alice: TestUser;

  beforeAll(async () => {
    ctx = await TestContext.create();
    tasks = new TasksService(ctx.app);
  });
  beforeEach(async () => {
    await ctx.reset();
    manager = await ctx.createUser({ role: 'manager' });
    alice = await ctx.createUser({ role: 'agent' });
  });
  afterAll(async () => {
    await ctx.close();
  });

  const create = async (by: TestUser, payload: object) => {
    const res = await ctx.as(by, { method: 'POST', url: '/api/v1/tasks', payload });
    expect(res.statusCode, res.body).toBe(201);
    return res.json<{ data: { id: string } }>().data.id;
  };
  const overdueNotices = (userId: string) =>
    ctx.app.db.notification.findMany({ where: { userId, type: 'task_overdue' } });
  const overdueEmails = async () =>
    (await ctx.app.queues.get('email').getJobs(['waiting', 'delayed']))
      .map((j) => j.data as { subject: string })
      .filter((m) => m.subject.startsWith('Not done yet'));

  it('tells the giver once, by notice and email, and not before the due time', async () => {
    const dueAt = new Date(Date.now() + 60 * 60_000);
    const id = await create(manager, {
      title: 'Call the Mwangi family',
      assigneeId: alice.id,
      dueAt: dueAt.toISOString(),
    });

    expect(await tasks.notifyOverdue(new Date(dueAt.getTime() - 1000))).toBe(0);
    expect(await overdueNotices(manager.id)).toHaveLength(0);

    const after = new Date(dueAt.getTime() + 1000);
    expect(await tasks.notifyOverdue(after)).toBe(1);
    const notices = await overdueNotices(manager.id);
    expect(notices).toHaveLength(1);
    expect(notices[0]?.title).toBe('Not done yet: Call the Mwangi family');
    expect(await overdueNotices(alice.id)).toHaveLength(0);
    expect(await overdueEmails()).toHaveLength(1);

    // Once only.
    expect(await tasks.notifyOverdue(new Date(after.getTime() + 60_000))).toBe(0);
    expect(await overdueNotices(manager.id)).toHaveLength(1);

    // A new deadline gets its own notice when it passes.
    const later = new Date(after.getTime() + 2 * 60 * 60_000);
    const moved = await ctx.as(manager, {
      method: 'PATCH',
      url: `/api/v1/tasks/${id}`,
      payload: { dueAt: later.toISOString() },
    });
    expect(moved.statusCode, moved.body).toBe(200);
    expect(await tasks.notifyOverdue(new Date(later.getTime() + 1000))).toBe(1);
    expect(await overdueNotices(manager.id)).toHaveLength(2);
  });

  it('says nothing about a task that was done, or one a person set for themselves', async () => {
    const dueAt = new Date(Date.now() + 60_000);
    const done = await create(manager, {
      title: 'Send the quote',
      assigneeId: alice.id,
      dueAt: dueAt.toISOString(),
    });
    await create(alice, {
      title: 'My own follow-up',
      assigneeId: alice.id,
      dueAt: dueAt.toISOString(),
    });
    const finished = await ctx.as(alice, {
      method: 'PATCH',
      url: `/api/v1/tasks/${done}`,
      payload: { status: 'done' },
    });
    expect(finished.statusCode, finished.body).toBe(200);

    expect(await tasks.notifyOverdue(new Date(dueAt.getTime() + 1000))).toBe(0);
    expect(await overdueNotices(manager.id)).toHaveLength(0);
    expect(await overdueNotices(alice.id)).toHaveLength(0);
  });
});
