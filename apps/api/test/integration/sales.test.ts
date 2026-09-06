import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TasksService } from '../../src/modules/tasks/tasks.service.js';
import { TestContext, type TestUser } from '../setup/test-app.js';

interface Envelope<T> {
  data: T;
}

describe('sales: pipelines, deals, leads, tasks, notes, notifications', () => {
  let ctx: TestContext;
  let admin: TestUser;
  let agent: TestUser;
  beforeAll(async () => {
    ctx = await TestContext.create();
  });
  beforeEach(async () => {
    await ctx.reset();
    admin = await ctx.createUser({ role: 'admin' });
    agent = await ctx.createUser({ role: 'agent' });
  });
  afterAll(async () => {
    await ctx.close();
  });

  it('seeded default pipeline exists and stages can be reordered', async () => {
    const list = await ctx.as(agent, { method: 'GET', url: '/api/v1/pipelines' });
    const pipelines =
      list.json<
        Envelope<{ id: string; isDefault: boolean; stages: { id: string; name: string }[] }[]>
      >().data;
    expect(pipelines).toHaveLength(1);
    expect(pipelines[0]?.stages.map((s) => s.name)).toEqual([
      'New',
      'Contacted',
      'Qualified',
      'Proposal',
      'Won',
      'Lost',
    ]);
    const ids = pipelines[0]!.stages.map((s) => s.id).reverse();
    const reordered = await ctx.as(admin, {
      method: 'POST',
      url: `/api/v1/pipelines/${pipelines[0]!.id}/stages/reorder`,
      payload: { ids },
    });
    expect(reordered.json<Envelope<{ stages: { name: string }[] }>>().data.stages[0]?.name).toBe(
      'Lost',
    );
    const denied = await ctx.as(agent, {
      method: 'POST',
      url: `/api/v1/pipelines/${pipelines[0]!.id}/stages`,
      payload: { name: 'X', probability: 5 },
    });
    expect(denied.statusCode).toBe(403);
  });

  it('deal lifecycle: create → move stage → won, with history, timeline and board', async () => {
    const contact = (
      await ctx.as(agent, {
        method: 'POST',
        url: '/api/v1/contacts',
        payload: { firstName: 'Buyer', phones: [{ number: '0700000001' }] },
      })
    ).json<Envelope<{ id: string }>>().data;
    const created = await ctx.as(agent, {
      method: 'POST',
      url: '/api/v1/deals',
      payload: { title: 'Big deal', contactId: contact.id, value: 1500.5 },
    });
    expect(created.statusCode, created.body).toBe(201);
    const deal = created.json<
      Envelope<{
        id: string;
        stage: { name: string };
        probability: number;
        currency: string;
        weightedValue: number;
      }>
    >().data;
    expect(deal.stage.name).toBe('New');
    expect(deal.currency).toBe('KES');
    expect(deal.weightedValue).toBe(150.05);

    const pipelines = (await ctx.as(agent, { method: 'GET', url: '/api/v1/pipelines' })).json<
      Envelope<{ stages: { id: string; name: string; type: string }[] }[]>
    >().data;
    const stages = pipelines[0]!.stages;
    const qualified = stages.find((s) => s.name === 'Qualified')!;
    const won = stages.find((s) => s.type === 'won')!;
    const lost = stages.find((s) => s.type === 'lost')!;

    const moved = await ctx.as(agent, {
      method: 'POST',
      url: `/api/v1/deals/${deal.id}/stage`,
      payload: { stageId: qualified.id },
    });
    expect(moved.statusCode, moved.body).toBe(200);
    expect(moved.json<Envelope<{ probability: number }>>().data.probability).toBe(50);

    const lostNoReason = await ctx.as(agent, {
      method: 'POST',
      url: `/api/v1/deals/${deal.id}/stage`,
      payload: { stageId: lost.id },
    });
    expect(lostNoReason.statusCode).toBe(422);

    const wonRes = await ctx.as(agent, {
      method: 'POST',
      url: `/api/v1/deals/${deal.id}/stage`,
      payload: { stageId: won.id },
    });
    expect(wonRes.json<Envelope<{ status: string; wonAt: string | null }>>().data).toMatchObject({
      status: 'won',
    });

    const history = await ctx.as(agent, { method: 'GET', url: `/api/v1/deals/${deal.id}/history` });
    expect(
      history.json<Envelope<{ toStage: { name: string } }[]>>().data.map((h) => h.toStage.name),
    ).toEqual(['Won', 'Qualified', 'New']);

    const timeline = await ctx.as(agent, {
      method: 'GET',
      url: `/api/v1/contacts/${contact.id}/timeline?types=deal_created,deal_stage,deal_won`,
    });
    expect(timeline.json<Envelope<{ type: string }[]>>().data.map((a) => a.type)).toEqual([
      'deal_won',
      'deal_stage',
      'deal_created',
    ]);

    const board = await ctx.as(agent, { method: 'GET', url: '/api/v1/deals/board' });
    const columns =
      board.json<Envelope<{ columns: { stage: { name: string }; count: number }[] }>>().data
        .columns;
    expect(columns.map((c) => c.stage.name)).toEqual(['New', 'Contacted', 'Qualified', 'Proposal']);
    expect(columns.reduce((n, c) => n + c.count, 0)).toBe(0); // won deal left the board
  });

  it('lead capture and conversion into contact + company + deal', async () => {
    const lead = await ctx.as(agent, {
      method: 'POST',
      url: '/api/v1/leads',
      payload: {
        firstName: 'Lee',
        lastName: 'Der',
        companyName: 'Leadco',
        phone: '0711000001',
        email: 'lee@leadco.example',
        source: 'manual',
      },
    });
    expect(lead.statusCode, lead.body).toBe(201);
    const leadId = lead.json<Envelope<{ id: string }>>().data.id;

    const conv = await ctx.as(agent, {
      method: 'POST',
      url: `/api/v1/leads/${leadId}/convert`,
      payload: { createCompany: true, createDeal: true, dealValue: 500 },
    });
    expect(conv.statusCode, conv.body).toBe(200);
    const result = conv.json<
      Envelope<{
        contactId: string;
        dealId: string | null;
        companyId: string | null;
        lead: { status: string };
      }>
    >().data;
    expect(result.lead.status).toBe('converted');
    expect(result.dealId).not.toBeNull();
    expect(result.companyId).not.toBeNull();

    const contact = await ctx.as(agent, {
      method: 'GET',
      url: `/api/v1/contacts/${result.contactId}`,
    });
    const dto = contact.json<
      Envelope<{
        phones: { e164: string }[];
        emails: { email: string }[];
        company: { name: string } | null;
      }>
    >().data;
    expect(dto.phones[0]?.e164).toBe('+254711000001');
    expect(dto.company?.name).toBe('Leadco');

    // converting a lead whose phone already exists requires linking explicitly
    const lead2 = (
      await ctx.as(agent, {
        method: 'POST',
        url: '/api/v1/leads',
        payload: { firstName: 'Again', phone: '0711000001' },
      })
    ).json<Envelope<{ id: string }>>().data;
    const dupConv = await ctx.as(agent, {
      method: 'POST',
      url: `/api/v1/leads/${lead2.id}/convert`,
      payload: { createDeal: false },
    });
    expect(dupConv.statusCode).toBe(409);
    const linked = await ctx.as(agent, {
      method: 'POST',
      url: `/api/v1/leads/${lead2.id}/convert`,
      payload: { createDeal: false, existingContactId: result.contactId },
    });
    expect(linked.statusCode, linked.body).toBe(200);
    expect(linked.json<Envelope<{ contactId: string }>>().data.contactId).toBe(result.contactId);
  });

  it('tasks: assignment notifies, reminders are scheduled, completion hits the timeline', async () => {
    const contact = (
      await ctx.as(admin, { method: 'POST', url: '/api/v1/contacts', payload: { firstName: 'T' } })
    ).json<Envelope<{ id: string }>>().data;
    const remindAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const created = await ctx.as(admin, {
      method: 'POST',
      url: '/api/v1/tasks',
      payload: {
        title: 'Call back',
        contactId: contact.id,
        assigneeId: agent.id,
        dueAt: remindAt,
        remindAt,
      },
    });
    expect(created.statusCode, created.body).toBe(201);
    const task = created.json<Envelope<{ id: string; assigneeId: string }>>().data;

    const notif = await ctx.as(agent, { method: 'GET', url: '/api/v1/notifications?unread=true' });
    expect(notif.json<Envelope<{ type: string }[]>>().data[0]?.type).toBe('task_assigned');
    const unread = await ctx.as(agent, {
      method: 'GET',
      url: '/api/v1/notifications/unread-count',
    });
    expect(unread.json<Envelope<{ unread: number }>>().data.unread).toBe(1);

    const row = await ctx.app.db.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(row.reminderJobId).toBeTruthy();
    const job = await ctx.app.queues.get('task.reminder').getJob(row.reminderJobId!);
    expect(job).not.toBeNull();
    expect(await job!.getState()).toBe('delayed');

    const mine = await ctx.as(agent, { method: 'GET', url: '/api/v1/tasks?mine=true' });
    expect(mine.json<Envelope<{ id: string }[]>>().data.map((t) => t.id)).toEqual([task.id]);

    const done = await ctx.as(agent, { method: 'POST', url: `/api/v1/tasks/${task.id}/complete` });
    expect(done.json<Envelope<{ status: string; completedAt: string | null }>>().data.status).toBe(
      'done',
    );
    expect(await ctx.app.queues.get('task.reminder').getJob(row.reminderJobId!)).toBeFalsy();

    const timeline = await ctx.as(admin, {
      method: 'GET',
      url: `/api/v1/contacts/${contact.id}/timeline?types=task_created,task_completed`,
    });
    expect(timeline.json<Envelope<{ type: string }[]>>().data.map((a) => a.type)).toEqual([
      'task_completed',
      'task_created',
    ]);

    // reminder firing creates a task_due notification (email queued per default preference)
    await ctx.app.db.task.update({ where: { id: task.id }, data: { status: 'open' } });
    await new TasksService(ctx.app).fireReminder(task.id);
    const due = await ctx.app.db.notification.findFirst({
      where: { userId: agent.id, type: 'task_due' },
    });
    expect(due).not.toBeNull();
    const emails = await ctx.app.queues.get('email').getJobs(['waiting', 'delayed']);
    expect(emails.some((j) => j.data.subject.startsWith('Reminder'))).toBe(true);
  });

  it('notes: author-only edits, timeline search', async () => {
    const contact = (
      await ctx.as(agent, { method: 'POST', url: '/api/v1/contacts', payload: { firstName: 'N' } })
    ).json<Envelope<{ id: string }>>().data;
    const note = await ctx.as(agent, {
      method: 'POST',
      url: '/api/v1/notes',
      payload: { body: 'Discussed pricing for the enterprise tier', contactId: contact.id },
    });
    expect(note.statusCode, note.body).toBe(201);
    const noteId = note.json<Envelope<{ id: string }>>().data.id;

    const other = await ctx.createUser({ role: 'agent' });
    await ctx.as(admin, {
      method: 'PATCH',
      url: '/api/v1/settings',
      payload: { agentVisibility: 'all' },
    });
    const forbidden = await ctx.as(other, {
      method: 'PATCH',
      url: `/api/v1/notes/${noteId}`,
      payload: { body: 'hijack' },
    });
    expect(forbidden.statusCode).toBe(403);

    const found = await ctx.as(agent, {
      method: 'GET',
      url: `/api/v1/activity?contactId=${contact.id}&q=enterprise`,
    });
    expect(found.json<Envelope<{ type: string }[]>>().data).toHaveLength(1);
    const notFound = await ctx.as(agent, {
      method: 'GET',
      url: `/api/v1/activity?contactId=${contact.id}&q=zebra`,
    });
    expect(notFound.json<Envelope<unknown[]>>().data).toHaveLength(0);

    const orphan = await ctx.as(agent, {
      method: 'POST',
      url: '/api/v1/notes',
      payload: { body: 'no parent' },
    });
    expect(orphan.statusCode).toBe(422);
  });
});
