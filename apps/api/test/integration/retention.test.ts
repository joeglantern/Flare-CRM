import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runRetention } from '../../src/jobs/retention.js';
import { newId } from '../../src/lib/ids.js';
import type { MemoryStorage } from '../../src/integrations/storage/storage.js';
import { TestContext } from '../setup/test-app.js';

const DAY = 24 * 60 * 60 * 1000;
const ago = (days: number) => new Date(Date.now() - days * DAY);

describe('retention job', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await TestContext.create();
  });
  beforeEach(async () => {
    await ctx.reset();
  });
  afterAll(async () => {
    await ctx.close();
  });

  it('purges expired soft-deletes, pbx events, raw payloads and recordings — and nothing else', async () => {
    const admin = await ctx.createUser({ role: 'admin' });
    const db = ctx.app.db;
    const storage = ctx.app.storage as MemoryStorage;

    // soft-deleted contacts: one past the 90-day purge, one recent
    const oldContact = newId();
    const recentContact = newId();
    await db.contact.createMany({
      data: [
        {
          id: oldContact,
          firstName: 'Old',
          displayName: 'Old',
          ownerId: admin.id,
          deletedAt: ago(120),
        },
        {
          id: recentContact,
          firstName: 'New',
          displayName: 'New',
          ownerId: admin.id,
          deletedAt: ago(5),
        },
      ],
    });
    // pbx events
    await db.pbxEvent.createMany({
      data: [
        { id: newId(), eventType: 30011, payload: {}, receivedAt: ago(45) },
        { id: newId(), eventType: 30011, payload: {}, receivedAt: ago(2) },
      ],
    });
    // messages with raw payloads
    const channel = await db.channel.create({
      data: { id: newId(), type: 'whatsapp', name: 'WA', externalId: 'p1', config: {} },
    });
    const conv = await db.conversation.create({
      data: { id: newId(), channelId: channel.id, externalId: '254700000001', status: 'open' },
    });
    const oldMsg = newId();
    const newMsg = newId();
    await db.message.createMany({
      data: [
        {
          id: oldMsg,
          conversationId: conv.id,
          direction: 'inbound',
          contentType: 'text',
          body: 'a',
          status: 'received',
          sentAt: ago(100),
          raw: { secret: 'x' },
        },
        {
          id: newMsg,
          conversationId: conv.id,
          direction: 'inbound',
          contentType: 'text',
          body: 'b',
          status: 'received',
          sentAt: ago(1),
          raw: { secret: 'y' },
        },
      ],
    });
    // recordings
    await storage.put('recordings/old.wav', Buffer.from('old'), 'audio/wav');
    await storage.put('recordings/new.wav', Buffer.from('new'), 'audio/wav');
    const oldCall = newId();
    const newCall = newId();
    await db.call.createMany({
      data: [
        {
          id: oldCall,
          pbxCallId: 'c1',
          direction: 'inbound',
          status: 'answered',
          fromNumber: '+254700000001',
          toNumber: '100',
          startedAt: ago(400),
          recordingStatus: 'stored',
          recordingKey: 'recordings/old.wav',
        },
        {
          id: newCall,
          pbxCallId: 'c2',
          direction: 'inbound',
          status: 'answered',
          fromNumber: '+254700000001',
          toNumber: '100',
          startedAt: ago(10),
          recordingStatus: 'stored',
          recordingKey: 'recordings/new.wav',
        },
      ],
    });

    const summary = await runRetention(ctx.app);
    expect(summary).toMatchObject({
      pbxEvents: 1,
      rawPayloads: 1,
      recordings: 1,
      recordingErrors: 0,
    });
    expect(summary.purged.contacts).toBe(1);

    expect(
      await db.contact.findFirst({ where: { id: oldContact }, includeDeleted: true } as never),
    ).toBeNull();
    expect(
      await db.contact.findFirst({ where: { id: recentContact }, includeDeleted: true } as never),
    ).not.toBeNull();
    expect(await db.pbxEvent.count()).toBe(1);
    expect((await db.message.findUniqueOrThrow({ where: { id: oldMsg } })).raw).toBeNull();
    expect((await db.message.findUniqueOrThrow({ where: { id: newMsg } })).raw).toEqual({
      secret: 'y',
    });
    expect(storage.objects.has('recordings/old.wav')).toBe(false);
    expect(storage.objects.has('recordings/new.wav')).toBe(true);
    const cleared = await db.call.findUniqueOrThrow({ where: { id: oldCall } });
    expect(cleared).toMatchObject({ recordingStatus: 'none', recordingKey: null });
    expect(
      await db.auditLog.count({ where: { action: 'recording.expired', entityId: oldCall } }),
    ).toBe(1);
    expect(await db.auditLog.count({ where: { action: 'retention.run' } })).toBe(1);

    // idempotent
    const again = await runRetention(ctx.app);
    expect(again).toMatchObject({ pbxEvents: 0, rawPayloads: 0, recordings: 0 });
  });
});
