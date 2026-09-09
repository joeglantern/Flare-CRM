import { createHmac } from 'node:crypto';
import { io as connect, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FakeMeta, inboundImage, inboundText, statusUpdate } from '../setup/fake-meta.js';
import { TestContext, type TestUser } from '../setup/test-app.js';

interface Envelope<T> {
  data: T;
}

const PHONE_ID = '1234567890';
const APP_SECRET = 'meta-app-secret';
const sig = (raw: Buffer) => `sha256=${createHmac('sha256', APP_SECRET).update(raw).digest('hex')}`;

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

describe('messaging: WhatsApp channel end to end', () => {
  let meta: FakeMeta;
  let ctx: TestContext;
  let url: string;
  let admin: TestUser;
  let agent: TestUser;
  const sockets: Socket[] = [];

  beforeAll(async () => {
    meta = new FakeMeta();
    const base = await meta.start();
    ctx = await TestContext.create({
      WHATSAPP_ENABLED: 'true',
      WHATSAPP_ACCESS_TOKEN: 'EAAtoken',
      WHATSAPP_APP_SECRET: APP_SECRET,
      WHATSAPP_VERIFY_TOKEN: 'verify-me',
      WHATSAPP_PHONE_NUMBER_ID: PHONE_ID,
      WHATSAPP_API_BASE_URL: base,
    });
    url = await ctx.app.listen({ host: '127.0.0.1', port: 0 });
  });
  beforeEach(async () => {
    await ctx.reset();
    await ctx.app.db.channel.create({
      data: {
        id: '01a00000-0000-7000-8000-00000000c0de',
        type: 'whatsapp',
        name: 'WhatsApp',
        externalId: PHONE_ID,
        config: {},
      },
    });
    admin = await ctx.createUser({ role: 'admin' });
    agent = await ctx.createUser({ role: 'agent' });
    meta.requests.length = 0;
  });
  afterAll(async () => {
    for (const s of sockets) s.disconnect();
    await ctx.close();
    await meta.stop();
  });

  const webhook = (payload: unknown, valid = true) => {
    const raw = Buffer.from(JSON.stringify(payload));
    return ctx.app.inject({
      method: 'POST',
      url: '/webhooks/whatsapp',
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': valid ? sig(raw) : 'sha256=bad',
      },
      payload: raw,
    });
  };
  const drainInbound = async () => {
    const jobs = await ctx.app.queues.get('messaging.inbound').getJobs(['waiting', 'delayed']);
    for (const job of jobs) {
      await ctx.app.messaging.handleInbound('whatsapp', job.data.payload);
      await job.remove();
    }
  };
  const drainOutbound = async () => {
    const jobs = await ctx.app.queues.get('messaging.outbound').getJobs(['waiting', 'delayed']);
    for (const job of jobs) {
      await ctx.app.messaging.deliver(job.data.messageId, 1, 4);
      await job.remove();
    }
  };

  it('verifies the webhook handshake and rejects bad signatures', async () => {
    const ok = await ctx.app.inject({
      method: 'GET',
      url: '/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=12345',
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.body).toBe('12345');
    const bad = await ctx.app.inject({
      method: 'GET',
      url: '/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=1',
    });
    expect(bad.statusCode).toBe(401);
    const forged = await webhook(inboundText(PHONE_ID, '254712000001', 'hi'), false);
    expect(forged.statusCode).toBe(401);
    expect(
      await ctx.app.db.auditLog.count({ where: { action: 'webhook.signature_rejected' } }),
    ).toBe(1);
  });

  it('inbound message → conversation matched to contact, timeline, notification, socket; agent replies within the window', async () => {
    const contact = (
      await ctx.as(admin, {
        method: 'POST',
        url: '/api/v1/contacts',
        payload: {
          firstName: 'Wa',
          lastName: 'Customer',
          phones: [{ number: '0712000001' }],
          ownerId: agent.id,
        },
      })
    ).json<Envelope<{ id: string }>>().data;
    const socket = connect(url, {
      transports: ['websocket'],
      extraHeaders: { cookie: agent.cookie },
      reconnection: false,
    });
    sockets.push(socket);
    await waitFor(socket, 'connect');
    const incoming = waitFor<{ preview: string; contact: { id: string } | null }>(
      socket,
      'message:new',
    );

    const payload = inboundText(PHONE_ID, '254712000001', 'Hello, is the office open?');
    const first = await webhook(payload);
    expect(first.statusCode, first.body).toBe(200);
    const dup = await webhook(payload); // provider retry: same body → same job id, same message id
    expect(dup.statusCode).toBe(200);
    await drainInbound();

    const evt = await incoming;
    expect(evt.preview).toContain('office open');
    expect(evt.contact?.id).toBe(contact.id);

    const list = await ctx.as(agent, { method: 'GET', url: '/api/v1/conversations?mine=true' });
    const convs = list.json<
      Envelope<
        {
          id: string;
          contactId: string;
          unreadCount: number;
          replyWindowOpen: boolean;
          externalDisplay: string;
          assigneeId: string;
        }[]
      >
    >().data;
    expect(convs).toHaveLength(1);
    expect(convs[0]).toMatchObject({
      contactId: contact.id,
      unreadCount: 1,
      replyWindowOpen: true,
      assigneeId: agent.id,
    });
    expect(convs[0]!.externalDisplay).toContain('0712');
    const convId = convs[0]!.id;

    const timeline = await ctx.as(agent, {
      method: 'GET',
      url: `/api/v1/contacts/${contact.id}/timeline?types=message`,
    });
    expect(timeline.json<Envelope<{ summary: string }[]>>().data[0]?.summary).toContain(
      'Inbound whatsapp',
    );
    const notif = await ctx.app.db.notification.findFirst({
      where: { userId: agent.id, type: 'message_new' },
    });
    expect(notif?.title).toContain('Wa Customer');

    // reply
    socket.emit('conv:join', { conversationId: convId });
    await new Promise((r) => setTimeout(r, 100));
    const statusEvt = waitFor<{ status: string }>(socket, 'message:status');
    const sent = await ctx.as(agent, {
      method: 'POST',
      url: `/api/v1/conversations/${convId}/messages`,
      payload: { body: 'Yes, until 6pm.' },
    });
    expect(sent.statusCode, sent.body).toBe(202);
    const msg = sent.json<Envelope<{ id: string; status: string; direction: string }>>().data;
    expect(msg.status).toBe('queued');
    await drainOutbound();
    expect((await statusEvt).status).toBe('sent');
    const sendReq = meta.requestsTo(`/${PHONE_ID}/messages`)[0];
    expect(sendReq?.auth).toBe('Bearer EAAtoken');
    expect(sendReq?.body).toMatchObject({
      messaging_product: 'whatsapp',
      to: '254712000001',
      type: 'text',
      text: { body: 'Yes, until 6pm.' },
    });
    const stored = await ctx.app.db.message.findUniqueOrThrow({ where: { id: msg.id } });
    expect(stored.externalMessageId).toMatch(/^wamid\.OUT/);

    // delivery + read receipts
    await webhook(statusUpdate(PHONE_ID, stored.externalMessageId!, 'delivered'));
    await webhook(statusUpdate(PHONE_ID, stored.externalMessageId!, 'read'));
    await drainInbound();
    const after = await ctx.app.db.message.findUniqueOrThrow({ where: { id: msg.id } });
    expect(after.status).toBe('read');
    expect(after.readAt).not.toBeNull();

    const messages = await ctx.as(agent, {
      method: 'GET',
      url: `/api/v1/conversations/${convId}/messages`,
    });
    expect(messages.json<Envelope<{ direction: string }[]>>().data.map((m) => m.direction)).toEqual(
      ['outbound', 'inbound'],
    );
    const read = await ctx.as(agent, {
      method: 'POST',
      url: `/api/v1/conversations/${convId}/read`,
    });
    expect(read.json<Envelope<{ unreadCount: number }>>().data.unreadCount).toBe(0);
  });

  it('inbound media is stored as an attachment; unknown senders create unassigned conversations visible to managers', async () => {
    await webhook(inboundImage(PHONE_ID, '254733000009', 'm1'));
    await drainInbound();
    const manager = await ctx.createUser({ role: 'manager' });
    const list = await ctx.as(manager, {
      method: 'GET',
      url: '/api/v1/conversations?unassigned=true',
    });
    const conv =
      list.json<Envelope<{ id: string; contactId: string | null; assigneeId: string | null }[]>>()
        .data[0];
    expect(conv).toMatchObject({ contactId: null, assigneeId: null });
    const messages = await ctx.as(manager, {
      method: 'GET',
      url: `/api/v1/conversations/${conv!.id}/messages`,
    });
    const m = messages.json<
      Envelope<
        {
          contentType: string;
          body: string | null;
          attachments: { mimeType: string; url: string }[];
        }[]
      >
    >().data[0]!;
    expect(m.contentType).toBe('image');
    expect(m.body).toBe('photo');
    expect(m.attachments[0]?.mimeType).toBe('image/png');
    const file = await ctx.as(manager, { method: 'GET', url: m.attachments[0]!.url });
    expect(file.statusCode).toBe(200);
    expect(file.headers['content-type']).toBe('image/png');
    // agents (owned scope) do not see unassigned conversations of unknown people
    const agentList = await ctx.as(agent, { method: 'GET', url: '/api/v1/conversations' });
    expect(agentList.json<Envelope<unknown[]>>().data).toHaveLength(0);
    // manager assigns it → agent sees it and gets a notification
    const assigned = await ctx.as(manager, {
      method: 'POST',
      url: `/api/v1/conversations/${conv!.id}/assign`,
      payload: { assigneeId: agent.id },
    });
    expect(assigned.statusCode, assigned.body).toBe(200);
    expect(
      (await ctx.as(agent, { method: 'GET', url: '/api/v1/conversations' })).json<
        Envelope<unknown[]>
      >().data,
    ).toHaveLength(1);
  });

  it('enforces the 24-hour window (template required) and surfaces provider failures', async () => {
    const contact = (
      await ctx.as(agent, {
        method: 'POST',
        url: '/api/v1/contacts',
        payload: { firstName: 'Old', phones: [{ number: '0712000002' }] },
      })
    ).json<Envelope<{ id: string }>>().data;
    const channels = (await ctx.as(agent, { method: 'GET', url: '/api/v1/channels' })).json<
      Envelope<{ id: string }[]>
    >().data;
    const started = await ctx.as(agent, {
      method: 'POST',
      url: '/api/v1/conversations',
      payload: { channelId: channels[0]!.id, contactId: contact.id },
    });
    expect(started.statusCode, started.body).toBe(201);
    const conv = started.json<Envelope<{ id: string; replyWindowOpen: boolean }>>().data;
    expect(conv.replyWindowOpen).toBe(false);

    const blocked = await ctx.as(agent, {
      method: 'POST',
      url: `/api/v1/conversations/${conv.id}/messages`,
      payload: { body: 'free text' },
    });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json<{ error: { code: string } }>().error.code).toBe('TEMPLATE_REQUIRED');

    const tpl = await ctx.as(agent, {
      method: 'POST',
      url: `/api/v1/conversations/${conv.id}/messages`,
      payload: { template: { name: 'appointment_reminder', language: 'en', params: ['Tuesday'] } },
    });
    expect(tpl.statusCode, tpl.body).toBe(202);
    await drainOutbound();
    const sendReq = meta.requestsTo(`/${PHONE_ID}/messages`)[0]?.body as {
      type: string;
      template: { name: string; components: unknown[] };
    };
    expect(sendReq.type).toBe('template');
    expect(sendReq.template.name).toBe('appointment_reminder');

    // provider rejects the next send permanently → message failed, not retried
    meta.failNextSend = { status: 400, code: 131047, message: 'Re-engagement message' };
    const tpl2 = await ctx.as(agent, {
      method: 'POST',
      url: `/api/v1/conversations/${conv.id}/messages`,
      payload: { template: { name: 'x', language: 'en' } },
    });
    await drainOutbound();
    const failed = await ctx.app.db.message.findUniqueOrThrow({
      where: { id: tpl2.json<Envelope<{ id: string }>>().data.id },
    });
    expect(failed.status).toBe('failed');
    expect(failed.errorMessage).toContain('Re-engagement');
  });

  it('channel secrets are stored encrypted and never returned', async () => {
    const created = await ctx.as(admin, {
      method: 'POST',
      url: '/api/v1/channels',
      payload: {
        type: 'whatsapp',
        name: 'Second line',
        externalId: '999',
        secrets: { accessToken: 'EAAsecret' },
      },
    });
    expect(created.statusCode, created.body).toBe(201);
    const dto =
      created.json<Envelope<{ id: string; hasSecrets: boolean } & Record<string, unknown>>>().data;
    expect(dto.hasSecrets).toBe(true);
    expect(JSON.stringify(dto)).not.toContain('EAAsecret');
    const row = await ctx.app.db.channel.findUniqueOrThrow({ where: { id: dto.id } });
    expect(Buffer.from(row.secretsEncrypted!).toString('utf8')).not.toContain('EAAsecret');
    const ctxChannel = await ctx.app.messaging.channelContext(dto.id);
    expect(ctxChannel.secrets.accessToken).toBe('EAAsecret');
    const denied = await ctx.as(agent, {
      method: 'POST',
      url: '/api/v1/channels',
      payload: { type: 'sms', name: 'x' },
    });
    expect(denied.statusCode).toBe(403);
  });

  it('editing a channel updates its templates and can turn it off', async () => {
    const created = await ctx.as(admin, {
      method: 'POST',
      url: '/api/v1/channels',
      payload: { type: 'whatsapp', name: 'Support line' },
    });
    const id = created.json<Envelope<{ id: string; isActive: boolean }>>().data.id;

    const patched = await ctx.as(admin, {
      method: 'PATCH',
      url: `/api/v1/channels/${id}`,
      payload: {
        name: 'Support line (renamed)',
        config: {
          templates: [{ name: 'order_update', language: 'en', body: 'Your order {{1}} is {{2}}.' }],
        },
      },
    });
    expect(patched.statusCode, patched.body).toBe(200);
    const dto =
      patched.json<Envelope<{ name: string; config: { templates?: { name: string }[] } }>>().data;
    expect(dto.name).toBe('Support line (renamed)');
    // config is a free-form record: the server stores and returns it exactly as sent, it does not
    // recompute anything in it (the placeholder count is derived client side, not here).
    expect(dto.config.templates).toEqual([
      { name: 'order_update', language: 'en', body: 'Your order {{1}} is {{2}}.' },
    ]);

    const off = await ctx.as(admin, {
      method: 'PATCH',
      url: `/api/v1/channels/${id}`,
      payload: { isActive: false },
    });
    expect(off.json<Envelope<{ isActive: boolean }>>().data.isActive).toBe(false);

    const deniedEdit = await ctx.as(agent, {
      method: 'PATCH',
      url: `/api/v1/channels/${id}`,
      payload: { name: 'Should not apply' },
    });
    expect(deniedEdit.statusCode).toBe(403);
  });
});
