import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runCsvImport } from '../../src/jobs/csv-import.js';
import { newId } from '../../src/lib/ids.js';
import { TestContext, type TestUser } from '../setup/test-app.js';

interface Envelope<T> {
  data: T;
}

describe('reports, CSV import/export, web forms', () => {
  let ctx: TestContext;
  let admin: TestUser;
  let agent: TestUser;
  beforeAll(async () => {
    ctx = await TestContext.create();
  });
  beforeEach(async () => {
    await ctx.reset();
    admin = await ctx.createUser({ role: 'admin', extension: '1000' });
    agent = await ctx.createUser({ role: 'agent', extension: '1001' });
  });
  afterAll(async () => {
    await ctx.close();
  });

  const seedCalls = async () => {
    const now = Date.now();
    const rows = [
      {
        direction: 'inbound',
        status: 'completed',
        talk: 120,
        ring: 5,
        userId: agent.id,
        ext: '1001',
      },
      { direction: 'inbound', status: 'missed', talk: 0, ring: 20, userId: agent.id, ext: '1001' },
      {
        direction: 'outbound',
        status: 'completed',
        talk: 60,
        ring: 8,
        userId: admin.id,
        ext: '1000',
      },
      {
        direction: 'inbound',
        status: 'completed',
        talk: 30,
        ring: 3,
        userId: admin.id,
        ext: '1000',
      },
    ];
    for (const [i, r] of rows.entries()) {
      await ctx.app.db.call.create({
        data: {
          id: newId(),
          pbxCallId: `seed.${i}`,
          pbxCdrUid: `seed-uid-${i}`,
          direction: r.direction,
          status: r.status,
          fromNumber: '0712000000',
          toNumber: r.ext,
          externalE164: '+254712000000',
          userId: r.userId,
          extension: r.ext,
          startedAt: new Date(now - (i + 1) * 3600_000),
          ringDurationSec: r.ring,
          talkDurationSec: r.talk,
          totalDurationSec: r.talk + r.ring,
        },
      });
    }
  };

  it('call reports: totals, AHT, answer rate, agent table, scoped per role', async () => {
    await seedCalls();
    const all = await ctx.as(admin, { method: 'GET', url: '/api/v1/reports/calls/summary' });
    expect(all.statusCode, all.body).toBe(200);
    const s = all.json<
      Envelope<{
        totals: { calls: number; inbound: number; missed: number; answered: number };
        avgTalkSec: number;
        answerRate: number;
        series: unknown[];
      }>
    >().data;
    expect(s.totals).toMatchObject({ calls: 4, inbound: 3, missed: 1, answered: 3 });
    expect(s.avgTalkSec).toBe(70);
    expect(s.answerRate).toBeCloseTo(2 / 3, 2);
    expect(s.series.length).toBeGreaterThan(0);

    const own = await ctx.as(agent, { method: 'GET', url: '/api/v1/reports/calls/summary' });
    expect(own.json<Envelope<{ totals: { calls: number } }>>().data.totals.calls).toBe(2);

    const agents = await ctx.as(admin, { method: 'GET', url: '/api/v1/reports/calls/agents' });
    const table =
      agents.json<
        Envelope<{ userId: string; total: number; missed: number; avgTalkSec: number }[]>
      >().data;
    expect(table.find((a) => a.userId === agent.id)).toMatchObject({
      total: 2,
      missed: 1,
      avgTalkSec: 120,
    });

    const csv = await ctx.as(admin, {
      method: 'GET',
      url: '/api/v1/reports/calls/agents?format=csv',
    });
    expect(csv.statusCode).toBe(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.body).toContain('"agent","extension","total"');
    const audit = await ctx.app.db.auditLog.findFirst({ where: { action: 'report.export' } });
    expect(audit).not.toBeNull();

    const missed = await ctx.as(agent, { method: 'GET', url: '/api/v1/reports/calls/missed' });
    expect(missed.json<Envelope<unknown[]>>().data).toHaveLength(1);
  });

  it('pipeline reports: summary, conversion and forecast', async () => {
    const pipelines = (await ctx.as(admin, { method: 'GET', url: '/api/v1/pipelines' })).json<
      Envelope<{ id: string; stages: { id: string; name: string; type: string }[] }[]>
    >().data;
    const stages = pipelines[0]!.stages;
    const nextMonth = new Date(Date.now() + 20 * 24 * 3600_000).toISOString().slice(0, 10);
    const d1 = (
      await ctx.as(admin, {
        method: 'POST',
        url: '/api/v1/deals',
        payload: { title: 'A', value: 1000, expectedCloseDate: nextMonth },
      })
    ).json<Envelope<{ id: string }>>().data;
    const d2 = (
      await ctx.as(admin, {
        method: 'POST',
        url: '/api/v1/deals',
        payload: { title: 'B', value: 500 },
      })
    ).json<Envelope<{ id: string }>>().data;
    await ctx.as(admin, {
      method: 'POST',
      url: `/api/v1/deals/${d1.id}/stage`,
      payload: { stageId: stages.find((s) => s.name === 'Qualified')!.id },
    });
    await ctx.as(admin, {
      method: 'POST',
      url: `/api/v1/deals/${d2.id}/stage`,
      payload: { stageId: stages.find((s) => s.type === 'won')!.id },
    });

    const summary = await ctx.as(admin, { method: 'GET', url: '/api/v1/reports/pipeline/summary' });
    const sum = summary.json<
      Envelope<{
        stages: { name: string; openCount: number; openValue: number; weightedValue: number }[];
        won: { count: number; value: number };
        winRate: number;
        currency: string;
      }>
    >().data;
    expect(sum.won).toEqual({ count: 1, value: 500 });
    expect(sum.stages.find((s) => s.name === 'Qualified')).toMatchObject({
      openCount: 1,
      openValue: 1000,
      weightedValue: 500,
    });
    expect(sum.winRate).toBe(1);
    expect(sum.currency).toBe('KES');

    const conv = await ctx.as(admin, { method: 'GET', url: '/api/v1/reports/pipeline/conversion' });
    const c =
      conv.json<
        Envelope<{ created: number; won: number; stages: { name: string; reached: number }[] }>
      >().data;
    expect(c.created).toBe(2);
    expect(c.won).toBe(1);
    expect(c.stages.find((s) => s.name === 'New')?.reached).toBe(2);
    expect(c.stages.find((s) => s.name === 'Qualified')?.reached).toBe(1);

    const forecast = await ctx.as(admin, {
      method: 'GET',
      url: '/api/v1/reports/pipeline/forecast?months=2',
    });
    const f = forecast.json<
      Envelope<{
        months: { month: string; count: number; value: number; weightedValue: number }[];
      }>
    >().data;
    expect(f.months).toHaveLength(2);
    expect(f.months.reduce((n, m) => n + m.count, 0)).toBe(1);
    expect(f.months.find((m) => m.count === 1)?.weightedValue).toBe(500);
  });

  it('CSV import creates contacts with dedupe/error reporting; export streams injection-safe CSV', async () => {
    const csv = [
      'First Name,Last Name,Phone,Email,Company,Tags',
      'Amina,Yusuf,0712 111 111,amina@example.com,Acme,vip;kenya',
      'Brian,Otieno,not-a-number,,Acme,',
      'Amina,Duplicate,0712111111,,Beta,',
      '=HACK(),X,0712 222 222,,,',
    ]
      .join('\n')
      .concat('\n');
    const boundary = '----crmtest';
    const body = [
      `--${boundary}\r\nContent-Disposition: form-data; name="entity"\r\n\r\ncontact\r\n`,
      `--${boundary}\r\nContent-Disposition: form-data; name="mapping"\r\n\r\n${JSON.stringify({ columns: { 'First Name': 'firstName', 'Last Name': 'lastName', Phone: 'phone', Email: 'email', Company: 'company', Tags: 'tags' }, onDuplicate: 'skip' })}\r\n`,
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="contacts.csv"\r\nContent-Type: text/csv\r\n\r\n${csv}\r\n`,
      `--${boundary}--\r\n`,
    ].join('');
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/imports',
      headers: {
        cookie: admin.cookie,
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload: body,
    });
    expect(res.statusCode, res.body).toBe(202);
    const job = res.json<Envelope<{ id: string; status: string }>>().data;
    expect(job.status).toBe('queued');

    await runCsvImport(ctx.app, job.id);
    const done = (await ctx.as(admin, { method: 'GET', url: `/api/v1/imports/${job.id}` })).json<
      Envelope<{
        status: string;
        totalRows: number;
        createdRows: number;
        errorRows: number;
        errors: { row: number; message: string }[];
      }>
    >().data;
    expect(done.status).toBe('done');
    expect(done.totalRows).toBe(4);
    expect(done.createdRows).toBe(2);
    expect(done.errorRows).toBe(2);
    expect(done.errors.map((e) => e.row).sort()).toEqual([3, 4]);
    expect(done.errors.find((e) => e.row === 3)?.message).toMatch(/Invalid phone/);
    expect(done.errors.find((e) => e.row === 4)?.message).toMatch(/Duplicate/);

    const contacts = await ctx.as(admin, { method: 'GET', url: '/api/v1/contacts?q=amina' });
    const amina =
      contacts.json<Envelope<{ id: string; company: { name: string } | null; tags: string[] }[]>>()
        .data[0]!;
    expect(amina.company?.name).toBe('Acme');
    expect(amina.tags.sort()).toEqual(['kenya', 'vip']);

    const exported = await ctx.as(admin, { method: 'GET', url: '/api/v1/exports/contacts' });
    expect(exported.statusCode).toBe(200);
    expect(exported.headers['content-disposition']).toContain('contacts-');
    const lines = exported.body.split('\n').filter(Boolean);
    expect(lines[0]).toContain('firstName');
    expect(lines.length).toBe(3);
    expect(exported.body).toContain(`"'=HACK()"`); // formula-injection guard
    const agentExport = await ctx.as(agent, { method: 'GET', url: '/api/v1/exports/calls' });
    expect(agentExport.statusCode).toBe(403);
  });

  it('web forms: public submission with origin allowlist and honeypot creates a lead', async () => {
    const created = await ctx.as(admin, {
      method: 'POST',
      url: '/api/v1/web-forms',
      payload: {
        name: 'Site form',
        fields: [
          { key: 'firstName', label: 'Name', required: true },
          { key: 'phone', label: 'Phone', required: true },
          { key: 'notes', label: 'Message' },
        ],
        allowedOrigins: ['https://www.example.com'],
        defaultOwnerId: agent.id,
      },
    });
    expect(created.statusCode, created.body).toBe(201);
    const form = created.json<Envelope<{ token: string; submitUrl: string }>>().data;
    const url = `/public/forms/${form.token}`;

    const wrongOrigin = await ctx.app.inject({
      method: 'POST',
      url,
      headers: { 'content-type': 'application/json', origin: 'https://evil.example' },
      payload: { firstName: 'X', phone: '0712333333' },
    });
    expect(wrongOrigin.statusCode).toBe(400);

    const bot = await ctx.app.inject({
      method: 'POST',
      url,
      headers: { 'content-type': 'application/json', origin: 'https://www.example.com' },
      payload: { firstName: 'Bot', phone: '0712333333', website: 'http://spam' },
    });
    expect(bot.statusCode).toBe(201);
    expect(await ctx.app.db.lead.count()).toBe(0);

    const missing = await ctx.app.inject({
      method: 'POST',
      url,
      headers: { 'content-type': 'application/json', origin: 'https://www.example.com' },
      payload: { firstName: 'NoPhone' },
    });
    expect(missing.statusCode).toBe(422);

    const ok = await ctx.app.inject({
      method: 'POST',
      url,
      headers: { 'content-type': 'application/json', origin: 'https://www.example.com' },
      payload: { firstName: 'Web', lastName: 'Lead', phone: '0712333333', notes: 'Please call me' },
    });
    expect(ok.statusCode, ok.body).toBe(201);
    expect(ok.headers['access-control-allow-origin']).toBe('https://www.example.com');
    const lead = await ctx.app.db.lead.findFirstOrThrow();
    expect(lead).toMatchObject({
      source: 'webform',
      phoneE164: '+254712333333',
      ownerId: agent.id,
    });
    const notif = await ctx.app.db.notification.findFirst({ where: { userId: agent.id } });
    expect(notif?.title).toContain('New web lead');
    const forms = await ctx.as(admin, { method: 'GET', url: '/api/v1/web-forms' });
    expect(forms.json<Envelope<{ submissionsCount: number }[]>>().data[0]?.submissionsCount).toBe(
      1,
    );

    const unknownForm = await ctx.app.inject({
      method: 'POST',
      url: '/public/forms/does-not-exist-token',
      headers: { 'content-type': 'application/json' },
      payload: { firstName: 'X', phone: '0712333333' },
    });
    expect(unknownForm.statusCode).toBe(404);
  });
});
