import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TestContext, type TestUser } from '../setup/test-app.js';

interface Envelope<T> {
  data: T;
}

interface Task {
  id: string;
  status: string;
  assigneeId: string | null;
  assignedBy: { id: string; name: string } | null;
  handBackTo: { id: string } | null;
  handedBack: { note: string; by: { id: string }; at: string } | null;
}

interface TaskEvent {
  kind: string;
  actor: { id: string } | null;
  from: { id: string } | null;
  to: { id: string } | null;
  note: string | null;
}

describe('tasks: agents assign to each other, and the assignee can hand a task back', () => {
  let ctx: TestContext;
  let admin: TestUser;
  let manager: TestUser;
  let alice: TestUser;
  let bob: TestUser;

  beforeAll(async () => {
    ctx = await TestContext.create();
  });
  beforeEach(async () => {
    await ctx.reset();
    admin = await ctx.createUser({ role: 'admin' });
    manager = await ctx.createUser({ role: 'manager' });
    alice = await ctx.createUser({ role: 'agent' });
    bob = await ctx.createUser({ role: 'agent' });
  });
  afterAll(async () => {
    await ctx.close();
  });

  const emails = async () =>
    (await ctx.app.queues.get('email').getJobs(['waiting', 'delayed'])).map((j) => j.data);

  const visibility = async (agentVisibility: 'own' | 'team' | 'all') => {
    const res = await ctx.as(admin, {
      method: 'PATCH',
      url: '/api/v1/settings',
      payload: { agentVisibility },
    });
    expect(res.statusCode, res.body).toBe(200);
  };

  const team = async (name: string, ...members: TestUser[]) => {
    const id = randomUUID();
    await ctx.app.db.team.create({ data: { id, name } });
    await ctx.app.db.user.updateMany({
      where: { id: { in: members.map((m) => m.id) } },
      data: { teamId: id },
    });
  };

  const handBack = (by: TestUser, id: string, note = 'Not mine') =>
    ctx.as(by, { method: 'POST', url: `/api/v1/tasks/${id}/decline`, payload: { note } });

  const holder = async (id: string) =>
    (await ctx.app.db.task.findUniqueOrThrow({ where: { id } })).assigneeId;

  const createFor = async (by: TestUser, assigneeId: string, extra: object = {}) => {
    const res = await ctx.as(by, {
      method: 'POST',
      url: '/api/v1/tasks',
      payload: { title: 'Call the Mwangi family', assigneeId, ...extra },
    });
    expect(res.statusCode, res.body).toBe(201);
    return res.json<Envelope<Task>>().data;
  };

  it('an agent assigns a task to another agent, who is told in the app and by email', async () => {
    const dueAt = '2026-10-01T07:00:00.000Z';
    const task = await createFor(alice, bob.id, {
      dueAt,
      description: 'They asked for the new price list.',
    });
    expect(task.assigneeId).toBe(bob.id);
    expect(task.assignedBy?.id).toBe(alice.id);

    const notes = await ctx.app.db.notification.findMany({ where: { userId: bob.id } });
    expect(notes.map((n) => n.type)).toEqual(['task_assigned']);
    expect((notes[0]?.data as { url?: string }).url).toBe(`/tasks?taskId=${task.id}`);

    const mail = (await emails()).find((m) => m.to === bob.email);
    expect(mail?.subject).toBe('Task for you: Call the Mwangi family');
    expect(mail?.text).toContain('They asked for the new price list.');
    expect(mail?.text).toContain('1 October 2026, 10:00');
    expect(mail?.html).toContain(`/tasks?taskId=${task.id}`);

    // alice handed it on, so she can still see it, but only bob can change it
    const seen = await ctx.as(alice, { method: 'GET', url: `/api/v1/tasks/${task.id}` });
    expect(seen.statusCode).toBe(200);
    const edit = await ctx.as(alice, {
      method: 'PATCH',
      url: `/api/v1/tasks/${task.id}`,
      payload: { title: 'Changed' },
    });
    expect(edit.statusCode).toBe(403);

    // agents get the assignee list without needing to list users
    const people = await ctx.as(alice, { method: 'GET', url: '/api/v1/tasks/assignees' });
    expect(people.statusCode, people.body).toBe(200);
    const listed = people.json<Envelope<Record<string, unknown>[]>>().data;
    expect(listed.map((p) => p.id)).toEqual(expect.arrayContaining([alice.id, bob.id]));
    expect(listed[0]).not.toHaveProperty('email');
  });

  it('a hand-back returns the task to whoever gave it, with the reason, and tells them', async () => {
    const task = await createFor(alice, bob.id);
    await ctx.as(bob, {
      method: 'PATCH',
      url: `/api/v1/tasks/${task.id}`,
      payload: { status: 'in_progress' },
    });

    const res = await ctx.as(bob, {
      method: 'POST',
      url: `/api/v1/tasks/${task.id}/decline`,
      payload: { note: '  Not my region; the Mwangis are with the Nakuru desk.  ' },
    });
    expect(res.statusCode, res.body).toBe(200);
    const back = res.json<Envelope<Task>>().data;
    expect(back.assigneeId).toBe(alice.id);
    expect(back.status).toBe('open');
    expect(back.handedBack?.note).toBe('Not my region; the Mwangis are with the Nakuru desk.');
    expect(back.handedBack?.by.id).toBe(bob.id);

    const history = await ctx.as(alice, {
      method: 'GET',
      url: `/api/v1/tasks/${task.id}/history`,
    });
    const events = history.json<Envelope<TaskEvent[]>>().data;
    expect(events.map((e) => [e.kind, e.actor?.id, e.to?.id])).toEqual([
      ['assigned', alice.id, bob.id],
      ['handed_back', bob.id, alice.id],
    ]);
    expect(events[1]?.note).toBe('Not my region; the Mwangis are with the Nakuru desk.');

    const declined = await ctx.app.db.notification.findFirst({
      where: { userId: alice.id, type: 'task_declined' },
    });
    expect(declined?.body).toBe('Not my region; the Mwangis are with the Nakuru desk.');
    expect((declined?.data as { url?: string }).url).toBe(`/tasks?taskId=${task.id}`);
    const mail = (await emails()).find((m) => m.to === alice.email);
    expect(mail?.subject).toBe('Task handed back: Call the Mwangi family');
    expect(mail?.text).toContain('Not my region; the Mwangis are with the Nakuru desk.');

    const audit = await ctx.app.db.auditLog.findFirst({
      where: { action: 'task.hand_back', entityId: task.id },
    });
    expect(audit).not.toBeNull();

    // alice created it herself, so there is nobody further back to return it to
    const again = await ctx.as(alice, {
      method: 'POST',
      url: `/api/v1/tasks/${task.id}/decline`,
      payload: { note: 'Back to you' },
    });
    expect(again.statusCode).toBe(409);
  });

  it('a hand-back unwinds one step at a time along the chain of assigners', async () => {
    const task = await createFor(manager, alice.id);
    const passed = await ctx.as(alice, {
      method: 'PATCH',
      url: `/api/v1/tasks/${task.id}`,
      payload: { assigneeId: bob.id },
    });
    expect(passed.statusCode, passed.body).toBe(200);

    await ctx.as(bob, {
      method: 'POST',
      url: `/api/v1/tasks/${task.id}/decline`,
      payload: { note: 'Not mine' },
    });
    let row = await ctx.app.db.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(row.assigneeId).toBe(alice.id);
    expect(row.assignedById).toBe(manager.id);

    await ctx.as(alice, {
      method: 'POST',
      url: `/api/v1/tasks/${task.id}/decline`,
      payload: { note: 'Nobody on my desk can take it' },
    });
    row = await ctx.app.db.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(row.assigneeId).toBe(manager.id);
  });

  it('only the assignee can hand a task back, only when someone else gave it, with a reason', async () => {
    const task = await createFor(alice, bob.id);

    const notAssignee = await ctx.as(alice, {
      method: 'POST',
      url: `/api/v1/tasks/${task.id}/decline`,
      payload: { note: 'Not mine' },
    });
    expect(notAssignee.statusCode).toBe(403);

    const noReason = await ctx.as(bob, {
      method: 'POST',
      url: `/api/v1/tasks/${task.id}/decline`,
      payload: { note: '   ' },
    });
    expect(noReason.statusCode).toBe(422);
    const tooLong = await ctx.as(bob, {
      method: 'POST',
      url: `/api/v1/tasks/${task.id}/decline`,
      payload: { note: 'x'.repeat(2001) },
    });
    expect(tooLong.statusCode).toBe(422);

    const own = await createFor(bob, bob.id);
    const selfMade = await ctx.as(bob, {
      method: 'POST',
      url: `/api/v1/tasks/${own.id}/decline`,
      payload: { note: 'Not mine' },
    });
    expect(selfMade.statusCode).toBe(409);

    await ctx.as(bob, { method: 'POST', url: `/api/v1/tasks/${task.id}/complete` });
    const closed = await ctx.as(bob, {
      method: 'POST',
      url: `/api/v1/tasks/${task.id}/decline`,
      payload: { note: 'Not mine' },
    });
    expect(closed.statusCode).toBe(409);
    expect((await ctx.app.db.task.findUniqueOrThrow({ where: { id: task.id } })).status).toBe(
      'done',
    );

    expect(
      await ctx.app.db.notification.count({ where: { userId: alice.id, type: 'task_declined' } }),
    ).toBe(0);
  });

  it('an agent cannot drop a task someone gave them; they hand it back instead', async () => {
    const task = await createFor(alice, bob.id);
    const dropped = await ctx.as(bob, {
      method: 'PATCH',
      url: `/api/v1/tasks/${task.id}`,
      payload: { assigneeId: null },
    });
    expect(dropped.statusCode, dropped.body).toBe(409);
    expect(await holder(task.id)).toBe(bob.id);
  });

  it('passing a task outside your own view still saves, answers, and tells the new assignee', async () => {
    const carol = await ctx.createUser({ role: 'agent' });
    await team('Nairobi desk', alice, bob);
    await team('Nakuru desk', carol);
    await visibility('team');

    const task = await createFor(alice, bob.id);
    const passed = await ctx.as(bob, {
      method: 'PATCH',
      url: `/api/v1/tasks/${task.id}`,
      payload: { assigneeId: carol.id },
    });
    expect(passed.statusCode, passed.body).toBe(200);
    expect(passed.json<Envelope<Task>>().data.assigneeId).toBe(carol.id);
    expect(
      await ctx.app.db.notification.count({ where: { userId: carol.id, type: 'task_assigned' } }),
    ).toBe(1);
  });

  it("an agent who can see a teammate's task still cannot pass it on", async () => {
    const dave = await ctx.createUser({ role: 'agent' });
    await team('Nairobi desk', alice, bob, dave);
    await visibility('team');

    const task = await createFor(alice, bob.id);
    const seen = await ctx.as(dave, { method: 'GET', url: `/api/v1/tasks/${task.id}` });
    expect(seen.statusCode).toBe(200);

    const moved = await ctx.as(dave, {
      method: 'PATCH',
      url: `/api/v1/tasks/${task.id}`,
      payload: { assigneeId: dave.id },
    });
    expect(moved.statusCode).toBe(403);
    const bulk = await ctx.as(dave, {
      method: 'POST',
      url: '/api/v1/tasks/bulk',
      payload: { action: 'assign', ids: [task.id], assigneeId: dave.id },
    });
    expect(bulk.json<Envelope<{ affected: number; skipped: string[] }>>().data).toEqual({
      affected: 0,
      skipped: [task.id],
    });
    expect(await holder(task.id)).toBe(bob.id);

    // a manager can move it
    const byManager = await ctx.as(manager, {
      method: 'PATCH',
      url: `/api/v1/tasks/${task.id}`,
      payload: { assigneeId: dave.id },
    });
    expect(byManager.statusCode, byManager.body).toBe(200);
  });

  it('two people cannot bounce a task between them with hand-backs', async () => {
    const task = await createFor(alice, bob.id);
    const passedBack = await ctx.as(bob, {
      method: 'PATCH',
      url: `/api/v1/tasks/${task.id}`,
      payload: { assigneeId: alice.id },
    });
    expect(passedBack.statusCode, passedBack.body).toBe(200);

    expect((await handBack(alice, task.id)).statusCode).toBe(200);
    expect(await holder(task.id)).toBe(bob.id);

    // bob was given it by alice first, but alice has just handed it back, so it stops here
    expect((await handBack(bob, task.id)).statusCode).toBe(409);
    expect(await holder(task.id)).toBe(bob.id);
    expect(await ctx.app.db.notification.count({ where: { type: 'task_declined' } })).toBe(1);
  });

  it('a task you took for yourself cannot be handed to its creator', async () => {
    await visibility('all');
    const made = await ctx.as(manager, {
      method: 'POST',
      url: '/api/v1/tasks',
      payload: { title: 'Anyone free?', assigneeId: null },
    });
    const id = made.json<Envelope<Task>>().data.id;
    const taken = await ctx.as(alice, {
      method: 'PATCH',
      url: `/api/v1/tasks/${id}`,
      payload: { assigneeId: alice.id },
    });
    expect(taken.statusCode, taken.body).toBe(200);
    expect(taken.json<Envelope<Task>>().data.handBackTo).toBeNull();
    expect((await handBack(alice, id)).statusCode).toBe(409);
    expect(await holder(id)).toBe(alice.id);
  });

  it('offers no hand-back once the person who gave the task has left', async () => {
    const task = await createFor(alice, bob.id);
    const before = await ctx.as(bob, { method: 'GET', url: `/api/v1/tasks/${task.id}` });
    expect(before.json<Envelope<Task>>().data.handBackTo?.id).toBe(alice.id);

    await ctx.app.db.user.update({ where: { id: alice.id }, data: { isActive: false } });
    const after = await ctx.as(bob, { method: 'GET', url: `/api/v1/tasks/${task.id}` });
    expect(after.json<Envelope<Task>>().data.handBackTo).toBeNull();
    expect((await handBack(bob, task.id)).statusCode).toBe(409);
  });
});
