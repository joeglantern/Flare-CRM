import { io as connect, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { yeastarSignature } from '../../src/integrations/yeastar/webhook-verify.js';
import { YeastarSubscriber } from '../../src/integrations/yeastar/subscriber.js';
import { reconcileCdrs } from '../../src/integrations/yeastar/reconcile.js';
import { startProcessors, type RunningWorkers } from '../../src/jobs/processors.js';
import {
  FakePbx,
  cdr,
  inboundAnswered,
  inboundBye,
  inboundRinging,
  nextCallId,
  outboundRinging,
} from '../setup/fake-pbx.js';
import { TestContext, type TestUser } from '../setup/test-app.js';

interface Envelope<T> {
  data: T;
}

function waitFor<T>(socket: Socket, event: string, timeoutMs = 5000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`timed out waiting for ${event}`));
    }, timeoutMs);
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

async function until(fn: () => Promise<boolean>, timeoutMs = 8000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('condition not met in time');
}

describe('Yeastar CTI end to end (fake PBX)', () => {
  let pbx: FakePbx;
  let ctx: TestContext;
  let url: string;
  let subscriber: YeastarSubscriber;
  let admin: TestUser;
  let agent: TestUser;
  const sockets: Socket[] = [];
  const WEBHOOK_SECRET = 'whsec-0123456789abcdef0123456789ab';

  beforeAll(async () => {
    pbx = new FakePbx();
    const pbxUrl = await pbx.start();
    ctx = await TestContext.create({
      YEASTAR_ENABLED: 'true',
      YEASTAR_BASE_URL: pbxUrl,
      YEASTAR_CLIENT_ID: 'client-id',
      YEASTAR_CLIENT_SECRET: 'client-secret',
      YEASTAR_EVENT_SOURCE: 'both',
      YEASTAR_WEBHOOK_SECRET: WEBHOOK_SECRET,
      YEASTAR_TIMEZONE: 'Africa/Nairobi',
    });
    url = await ctx.app.listen({ host: '127.0.0.1', port: 0 });
    subscriber = new YeastarSubscriber({
      valkey: ctx.app.valkey,
      tokens: ctx.app.cti.tokens!,
      machine: ctx.app.cti.machine,
      baseUrl: pbxUrl,
      tls: {},
      log: ctx.app.log,
      onStatus: () => undefined,
      onConnected: async () => undefined,
    });
    subscriber.start();
    await until(async () => pbx.sockets.size === 1);
  }, 60_000);

  beforeEach(async () => {
    await ctx.reset();
    await ctx.app.cti.extMap.refresh();
    admin = await ctx.createUser({ role: 'admin', extension: '1000' });
    agent = await ctx.createUser({ role: 'agent', extension: '1001' });
    await ctx.app.cti.extMap.refresh();
    pbx.requests.length = 0;
    // reset() flushed Valkey, including the token; the fake PBX still accepts any tok-* value
  });

  afterAll(async () => {
    for (const s of sockets) s.disconnect();
    await subscriber.stop();
    await ctx.close();
    await pbx.stop();
  });

  const agentSocket = async (user: TestUser) => {
    const s = connect(url, {
      transports: ['websocket'],
      extraHeaders: { cookie: user.cookie },
      reconnection: false,
    });
    sockets.push(s);
    await waitFor(s, 'connect');
    return s;
  };

  it('pops a matched contact to the ringing agent within budget, then logs the answered call with a recording', async () => {
    const contact = (
      await ctx.as(admin, {
        method: 'POST',
        url: '/api/v1/contacts',
        payload: {
          firstName: 'Caller',
          lastName: 'One',
          phones: [{ number: '0712000001' }],
          ownerId: agent.id,
        },
      })
    ).json<Envelope<{ id: string }>>().data;
    await ctx.as(admin, {
      method: 'POST',
      url: '/api/v1/notes',
      payload: { body: 'Previous chat', contactId: contact.id },
    });
    const socket = await agentSocket(agent);

    const ringing = waitFor<{
      callId: string;
      contact: { id: string; displayName: string } | null;
      callerNumber: string;
      recentActivity: unknown[];
      direction: string;
      capabilities: { answer: string };
    }>(socket, 'call:ringing');
    const callId = nextCallId();
    const started = Date.now();
    pbx.emit(inboundRinging(callId, '0712000001', '1001'));
    const pop = await ringing;
    expect(Date.now() - started).toBeLessThan(2000);
    expect(pop.contact?.id).toBe(contact.id);
    expect(pop.contact?.displayName).toBe('Caller One');
    expect(pop.callerNumber).toBe('+254712000001');
    expect(pop.direction).toBe('inbound');
    expect(pop.recentActivity.length).toBeGreaterThan(0);
    expect(pop.capabilities.answer).toBe('api');

    const answered = waitFor<{ answeredByExtension: string }>(socket, 'call:answered');
    pbx.emit(inboundAnswered(callId, '0712000001', '1001'));
    expect((await answered).answeredByExtension).toBe('1001');

    const ended = waitFor(socket, 'call:ended');
    pbx.emit(inboundBye(callId, '0712000001', '1001'));
    await ended;

    const logged = waitFor<{
      status: string;
      talkDurationSec: number;
      suggestFollowUp: boolean;
      recordingStatus: string;
    }>(socket, 'call:logged');
    pbx.emit(
      cdr(callId, {
        from: '0712000001',
        to: '1001',
        type: 'Inbound',
        status: 'ANSWERED',
        talk: 42,
        total: 50,
        recording: `rec-${callId}.wav`,
      }),
    );
    const done = await logged;
    expect(done).toMatchObject({
      status: 'completed',
      talkDurationSec: 42,
      suggestFollowUp: true,
      recordingStatus: 'pending',
    });

    const row = await ctx.app.db.call.findFirstOrThrow({ where: { pbxCallId: callId } });
    expect(row).toMatchObject({
      direction: 'inbound',
      status: 'completed',
      contactId: contact.id,
      userId: agent.id,
      extension: '1001',
      talkDurationSec: 42,
      totalDurationSec: 50,
      ringDurationSec: 8,
      pbxCdrUid: `uid-${callId}`,
    });
    expect(row.answeredAt).not.toBeNull();

    const timeline = await ctx.as(agent, {
      method: 'GET',
      url: `/api/v1/contacts/${contact.id}/timeline?types=call`,
    });
    expect(
      timeline.json<Envelope<{ summary: string; meta: { direction: string } }[]>>().data[0]?.meta
        .direction,
    ).toBe('inbound');

    // recording job → worker processor downloads from the PBX into object storage
    const job = await ctx.app.queues.get('recording.download').getJob(`recording-${row.id}`);
    expect(job).toBeTruthy();
    expect(job!.id).toBe(`recording-${row.id}`);
    let workers: RunningWorkers | null = null;
    try {
      workers = startProcessors(ctx.app);
      await job!.promote().catch(() => undefined);
      await until(
        async () =>
          (await ctx.app.db.call.findUniqueOrThrow({ where: { id: row.id } })).recordingStatus ===
          'stored',
        15_000,
      );
    } finally {
      await workers?.close();
    }
    const stored = await ctx.app.db.call.findUniqueOrThrow({ where: { id: row.id } });
    expect(stored.recordingKey).toMatch(/^recordings\//);
    expect(pbx.requestsTo('/openapi/v1.0/recording/download')).toHaveLength(1);

    const rec = await ctx.as(agent, { method: 'GET', url: `/api/v1/calls/${row.id}/recording` });
    expect(rec.statusCode, rec.body).toBe(200);
    expect(rec.headers['content-type']).toContain('audio/wav');
    const audit = await ctx.app.db.auditLog.findFirst({
      where: { action: 'recording.accessed', entityId: row.id },
    });
    expect(audit?.actorId).toBe(agent.id);

    const history = await ctx.as(agent, {
      method: 'GET',
      url: `/api/v1/calls/${row.id}/recording-history`,
    });
    expect(history.statusCode, history.body).toBe(200);
    const historyRows =
      history.json<Envelope<{ at: string; actor: { id: string; name: string } | null }[]>>().data;
    expect(historyRows).toHaveLength(1);
    expect(historyRows[0]?.actor?.id).toBe(agent.id);

    const notFound = await ctx.as(agent, {
      method: 'GET',
      url: '/api/v1/calls/00000000-0000-7000-8000-000000000000/recording-history',
    });
    expect(notFound.statusCode).toBe(404);

    // disposition
    const dispositions = (
      await ctx.as(agent, { method: 'GET', url: '/api/v1/call-dispositions' })
    ).json<Envelope<{ id: string; name: string }[]>>().data;
    const interested = dispositions.find((d) => d.name === 'Interested')!;
    const disp = await ctx.as(agent, {
      method: 'PATCH',
      url: `/api/v1/calls/${row.id}/disposition`,
      payload: { dispositionId: interested.id, note: 'wants a quote' },
    });
    expect(disp.json<Envelope<{ disposition: { name: string } }>>().data.disposition.name).toBe(
      'Interested',
    );
  }, 30_000);

  it('missed inbound call from an unknown number → unknown-caller pop, missed status, notification, then linking a new contact', async () => {
    const socket = await agentSocket(agent);
    const ringing = waitFor<{ callId: string; contact: unknown; callerDisplay: string }>(
      socket,
      'call:ringing',
    );
    const callId = nextCallId();
    pbx.emit(inboundRinging(callId, '0733999999', '1001'));
    const pop = await ringing;
    expect(pop.contact).toBeNull();
    expect(pop.callerDisplay).toContain('0733');

    const cancelled = waitFor<{ reason: string }>(socket, 'call:cancelled');
    pbx.emit(inboundBye(callId, '0733999999', '1001'));
    expect((await cancelled).reason).toBe('caller_hung_up');
    pbx.emit(
      cdr(callId, {
        from: '0733999999',
        to: '1001',
        type: 'Inbound',
        status: 'NO ANSWER',
        talk: 0,
        total: 12,
      }),
    );
    await until(
      async () =>
        (await ctx.app.db.call.findFirst({ where: { pbxCallId: callId } }))?.status === 'missed',
    );

    const notif = await ctx.app.db.notification.findFirst({
      where: { userId: agent.id, type: 'call_missed' },
    });
    expect(notif?.title).toContain('Missed call');

    const created = await ctx.as(agent, {
      method: 'POST',
      url: '/api/v1/contacts',
      payload: {
        firstName: 'New',
        lastName: 'Caller',
        phones: [{ number: '0733999999' }],
        linkCallId: pop.callId,
      },
    });
    expect(created.statusCode, created.body).toBe(201);
    const contactId = created.json<Envelope<{ id: string }>>().data.id;
    const call = await ctx.app.db.call.findUniqueOrThrow({ where: { id: pop.callId } });
    expect(call.contactId).toBe(contactId);
    const timeline = await ctx.as(agent, {
      method: 'GET',
      url: `/api/v1/contacts/${contactId}/timeline?types=call`,
    });
    expect(timeline.json<Envelope<unknown[]>>().data).toHaveLength(1);

    const unmatched = await ctx.as(admin, { method: 'GET', url: '/api/v1/calls?unmatched=true' });
    expect(unmatched.json<Envelope<unknown[]>>().data).toHaveLength(0);
  });

  it('click-to-call dials through the PBX in national format and the outbound call is logged', async () => {
    const contact = (
      await ctx.as(agent, {
        method: 'POST',
        url: '/api/v1/contacts',
        payload: { firstName: 'Out', phones: [{ number: '+254 745 000 111' }] },
      })
    ).json<Envelope<{ id: string; phones: { id: string }[] }>>().data;
    const socket = await agentSocket(agent);
    const dialing = waitFor<{ pbxCallId: string }>(socket, 'call:dialing');
    const res = await ctx.as(agent, {
      method: 'POST',
      url: '/api/v1/calls/dial',
      payload: { contactId: contact.id, phoneId: contact.phones[0]!.id },
    });
    expect(res.statusCode, res.body).toBe(202);
    const dial = res.json<Envelope<{ callId: string; pbxCallId: string; callee: string }>>().data;
    expect(dial.callee).toBe('0745000111');
    expect((await dialing).pbxCallId).toBe(dial.pbxCallId);
    const sent = pbx.requestsTo('/openapi/v1.0/call/dial')[0]?.body as {
      caller: string;
      callee: string;
    };
    expect(sent).toEqual({ caller: '1001', callee: '0745000111' });

    pbx.emit(outboundRinging(dial.pbxCallId, '1001', '0745000111'));
    const logged = waitFor<{ status: string; contactId: string }>(socket, 'call:logged');
    pbx.emit(
      cdr(dial.pbxCallId, {
        from: '1001',
        to: '0745000111',
        type: 'Outbound',
        status: 'ANSWERED',
        talk: 20,
        total: 25,
      }),
    );
    expect(await logged).toMatchObject({ status: 'completed', contactId: contact.id });
    const rows = await ctx.app.db.call.findMany({ where: { pbxCallId: dial.pbxCallId } });
    expect(rows).toHaveLength(1); // the pre-seeded row was reused, not duplicated
    expect(rows[0]).toMatchObject({
      direction: 'outbound',
      userId: agent.id,
      contactId: contact.id,
      externalE164: '+254745000111',
    });

    // do-not-call is enforced for agents
    await ctx.as(agent, {
      method: 'PATCH',
      url: `/api/v1/contacts/${contact.id}`,
      payload: { doNotCall: true },
    });
    const blocked = await ctx.as(agent, {
      method: 'POST',
      url: '/api/v1/calls/dial',
      payload: { phoneId: contact.phones[0]!.id },
    });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json<{ error: { code: string } }>().error.code).toBe('DO_NOT_CALL');
  });

  it('in-call controls reach the PBX with the agent leg channel and are audited', async () => {
    const socket = await agentSocket(agent);
    const ringing = waitFor<{ callId: string }>(socket, 'call:ringing');
    const callId = nextCallId();
    pbx.emit(inboundAnswered(callId, '0712000002', '1001'));
    const { callId: crmCallId } = await ringing;
    // the pop is emitted mid-event; wait for the machine to persist the answered leg
    await until(
      async () => (await ctx.app.cti.machine.loadState(callId))?.answeredExtension === '1001',
    );
    const hold = await ctx.as(agent, {
      method: 'POST',
      url: `/api/v1/calls/${crmCallId}/control`,
      payload: { action: 'hold' },
    });
    expect(hold.statusCode, hold.body).toBe(200);
    const sent = pbx.requestsTo('/openapi/v1.0/call/hold')[0]?.body as { channel_id: string };
    expect(sent.channel_id).toBe(`PJSIP/1001-${callId}`);
    const hangup = await ctx.as(agent, {
      method: 'POST',
      url: `/api/v1/calls/${crmCallId}/control`,
      payload: { action: 'hangup' },
    });
    expect(hangup.statusCode).toBe(200);
    expect(
      await ctx.app.db.auditLog.count({
        where: { action: 'call.control.hangup', entityId: crmCallId },
      }),
    ).toBe(1);
    // a different agent who is not on the call cannot control it
    const other = await ctx.createUser({ role: 'agent', extension: '1002' });
    const denied = await ctx.as(other, {
      method: 'POST',
      url: `/api/v1/calls/${crmCallId}/control`,
      payload: { action: 'mute' },
    });
    expect([403, 404]).toContain(denied.statusCode);
  });

  it('webhook receiver verifies HMAC signatures and enqueues events once', async () => {
    const raw = Buffer.from(
      JSON.stringify(
        cdr(nextCallId(), { from: '0712000003', to: '1001', type: 'Inbound', status: 'BUSY' }),
      ),
    );
    const bad = await ctx.app.inject({
      method: 'POST',
      url: '/webhooks/yeastar',
      headers: { 'content-type': 'application/json', 'x-signature': 'nope' },
      payload: raw,
    });
    expect(bad.statusCode).toBe(401);
    const sig = yeastarSignature(raw, WEBHOOK_SECRET);
    const ok = await ctx.app.inject({
      method: 'POST',
      url: '/webhooks/yeastar',
      headers: { 'content-type': 'application/json', 'x-signature': sig },
      payload: raw,
    });
    expect(ok.statusCode, ok.body).toBe(200);
    const again = await ctx.app.inject({
      method: 'POST',
      url: '/webhooks/yeastar',
      headers: { 'content-type': 'application/json', 'x-signature': sig },
      payload: raw,
    });
    expect(again.statusCode).toBe(200);
    const jobs = await ctx.app.queues.get('cti.event').getJobs(['waiting', 'delayed', 'completed']);
    expect(jobs).toHaveLength(1);
    const test = Buffer.from(
      JSON.stringify({ event: 'test', message: 'This is a webhook connectivity test.' }),
    );
    const probe = await ctx.app.inject({
      method: 'POST',
      url: '/webhooks/yeastar',
      headers: {
        'content-type': 'application/json',
        'x-signature': yeastarSignature(test, WEBHOOK_SECRET),
      },
      payload: test,
    });
    expect(probe.statusCode).toBe(200);
  });

  it('reconciliation pulls missed CDRs idempotently', async () => {
    const a = nextCallId();
    const b = nextCallId();
    pbx.cdrs = [
      cdr(a, { from: '0712000004', to: '1001', type: 'Inbound', status: 'ANSWERED', talk: 5 }).msg,
      cdr(b, { from: '1001', to: '0712000005', type: 'Outbound', status: 'NO ANSWER' }).msg,
    ];
    const deps = {
      client: ctx.app.cti.client!,
      machine: ctx.app.cti.machine,
      valkey: ctx.app.valkey,
      pbxTimeZone: 'Africa/Nairobi',
      log: ctx.app.log,
    };
    const first = await reconcileCdrs(deps);
    expect(first).toMatchObject({ scanned: 2, inserted: 2, updated: 0 });
    const second = await reconcileCdrs(deps);
    expect(second).toMatchObject({ scanned: 2, inserted: 0 });
    const via = await ctx.as(admin, { method: 'POST', url: '/api/v1/cti/reconcile', payload: {} });
    expect(via.statusCode, via.body).toBe(200);
    const outbound = await ctx.app.db.call.findFirstOrThrow({ where: { pbxCallId: b } });
    expect(outbound).toMatchObject({
      direction: 'outbound',
      status: 'failed',
      userId: agent.id,
      extension: '1001',
    });
    pbx.cdrs = [];
  });

  it('reports CTI status and survives a dropped PBX socket', async () => {
    pbx.dropSockets();
    await until(async () => pbx.sockets.size === 1, 15_000);
    await until(
      async () =>
        (await ctx.as(admin, { method: 'GET', url: '/api/v1/cti/status' })).json<
          Envelope<{ connected: boolean }>
        >().data.connected,
      5000,
    );
    const status = await ctx.as(admin, { method: 'GET', url: '/api/v1/cti/status' });
    expect(
      status.json<Envelope<{ enabled: boolean; connected: boolean; leader: string | null }>>().data,
    ).toMatchObject({ enabled: true, connected: true });
    expect(status.json<Envelope<{ leader: string | null }>>().data.leader).not.toBeNull();
    const caps = await ctx.as(agent, { method: 'GET', url: '/api/v1/cti/capabilities' });
    expect(caps.json<Envelope<{ dial: boolean; myExtension: string }>>().data).toMatchObject({
      dial: true,
      myExtension: '1001',
    });
  }, 30_000);
});
