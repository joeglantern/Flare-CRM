/**
 * Attendance capture and reports, end to end: real sign-ins and sockets produce the events, and the
 * report reads them back in the workspace's days.
 */
import { io as connect, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { newId } from '../../src/lib/ids.js';
import { TestContext, type TestUser } from '../setup/test-app.js';

interface Day {
  date: string;
  userId: string;
  dayStart: string;
  dayEnd: string;
  firstLoginAt: string | null;
  firstLoginInferred: boolean;
  signedInBeforeDay: boolean;
  lastLogoutAt: string | null;
  lastLogoutInferred: boolean;
  lastLogoutReason: string | null;
  stillSignedIn: boolean;
  continuedNextDay: boolean;
  firstCallAt: string | null;
  calls: { total: number; answered: number; missed: number; talkSec: number };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('attendance', () => {
  let ctx: TestContext;
  let url: string;
  let admin: TestUser;
  let agent: TestUser;

  beforeAll(async () => {
    ctx = await TestContext.create();
    url = await ctx.app.listen({ host: '127.0.0.1', port: 0 });
  });
  beforeEach(async () => {
    await ctx.reset();
    await ctx.app.settings.set('timezone', 'Africa/Nairobi', null);
    admin = await ctx.createUser({ role: 'admin', extension: '1000' });
    agent = await ctx.createUser({ role: 'agent', extension: '1001' });
    // Creating a test user signs in for real, which is recorded at today's date.
    await ctx.app.db.agentPresenceEvent.deleteMany();
  });
  afterAll(async () => {
    await ctx.close();
  });

  const eventsOf = (userId: string) =>
    ctx.app.db.agentPresenceEvent.findMany({ where: { userId }, orderBy: { at: 'asc' } });

  const seed = (userId: string, state: string, at: string, reason: string | null = null) =>
    ctx.app.db.agentPresenceEvent.create({
      data: { id: newId(), userId, channel: 'crm', state, reason, at: new Date(at) },
    });

  const report = async (user: TestUser, query: string) => {
    const res = await ctx.as(user, { method: 'GET', url: `/api/v1/reports/attendance?${query}` });
    expect(res.statusCode, res.body).toBe(200);
    return res.json<{ data: { days: Day[]; timeZone: string; recordingSince: string | null } }>()
      .data;
  };

  describe('capture', () => {
    const signIn = (email: string, password: string) =>
      ctx.app.inject({
        method: 'POST',
        url: '/api/auth/sign-in/email',
        headers: { 'content-type': 'application/json', origin: ctx.app.config.APP_URL },
        payload: { email, password },
      });

    it('records a sign-in, and a failed one records nothing', async () => {
      const user = await ctx.createUser({ role: 'agent' });
      const { email, password } = user;
      await ctx.app.db.agentPresenceEvent.deleteMany({ where: { userId: user.id } });

      const bad = await signIn(email, 'wrong-password-entirely');
      expect(bad.statusCode).toBe(401);
      expect(await eventsOf(user.id)).toHaveLength(0);

      const good = await signIn(email, password);
      expect(good.statusCode, good.body).toBe(200);
      expect((await eventsOf(user.id)).map((e) => e.state)).toEqual(['signed_in']);
    });

    it('records who signed out, and why', async () => {
      const out = await ctx.app.inject({
        method: 'POST',
        url: '/api/auth/sign-out',
        headers: {
          cookie: agent.cookie,
          origin: ctx.app.config.APP_URL,
          'content-type': 'application/json',
          'x-sign-out-reason': 'idle',
        },
        payload: {},
      });
      expect(out.statusCode, out.body).toBe(200);
      const last = (await eventsOf(agent.id)).at(-1);
      expect(last).toMatchObject({ state: 'signed_out', reason: 'idle' });
    });

    it('records one connection across tabs, and the disconnect only when the last tab goes', async () => {
      const open = async (): Promise<Socket> => {
        const s = connect(url, {
          transports: ['websocket'],
          extraHeaders: { cookie: agent.cookie },
          reconnection: false,
        });
        await new Promise<void>((resolve, reject) => {
          s.once('connect', () => {
            resolve();
          });
          s.once('connect_error', reject);
        });
        return s;
      };
      const crm = async () => (await eventsOf(agent.id)).map((e) => e.state);

      const first = await open();
      const second = await open();
      await sleep(100);
      expect((await crm()).filter((s) => s === 'online')).toHaveLength(1);

      first.disconnect();
      await sleep(100);
      expect(await crm()).not.toContain('offline');

      second.disconnect();
      await sleep(100);
      expect((await crm()).at(-1)).toBe('offline');
    });

    it('keeps phone state, ignoring a repeat', async () => {
      await ctx.app.presence.phone(agent.id, '1001', { registered: true });
      await ctx.app.presence.phone(agent.id, '1001', { callState: 'idle' });
      await ctx.app.presence.phone(agent.id, '1001', { callState: 'busy' });
      const phone = (await eventsOf(agent.id)).filter((e) => e.channel === 'phone');
      expect(phone.map((e) => e.state)).toEqual(['idle', 'on_call']);
    });

    it('closes connections a crash left open, at the last sign of life', async () => {
      await seed(agent.id, 'online', '2026-11-03T05:00:00Z');
      await ctx.app.db.user.update({
        where: { id: agent.id },
        data: { lastSeenAt: new Date('2026-11-03T09:00:00Z') },
      });
      await ctx.app.presence.closeConnectionsLostInRestart();
      const last = (await eventsOf(agent.id)).at(-1);
      expect(last).toMatchObject({
        state: 'offline',
        inferred: true,
        at: new Date('2026-11-03T09:00:00Z'),
      });
    });

    it('refuses to edit a recorded time', async () => {
      const row = await seed(agent.id, 'signed_in', '2026-11-03T05:00:00Z');
      await expect(
        ctx.app.db.agentPresenceEvent.update({
          where: { id: row.id },
          data: { at: new Date('2026-11-03T04:00:00Z') },
        }),
      ).rejects.toThrow();
    });
  });

  describe('report', () => {
    const range = 'from=2026-10-01T21:00:00.000Z&to=2026-10-04T21:00:00.000Z';

    it('buckets by the workspace day across midnight, whatever UTC says', async () => {
      // 23:30 in Nairobi on the 2nd to 01:15 on the 3rd.
      await seed(agent.id, 'signed_in', '2026-10-02T20:30:00Z');
      await seed(agent.id, 'signed_out', '2026-10-02T22:15:00Z', 'sign_out');
      const { days, timeZone } = await report(admin, `${range}&userId=${agent.id}`);
      expect(timeZone).toBe('Africa/Nairobi');

      const byDate = new Map(days.map((d) => [d.date, d]));
      expect(byDate.get('2026-10-02')).toMatchObject({
        firstLoginAt: '2026-10-02T20:30:00.000Z',
        lastLogoutAt: null,
        continuedNextDay: true,
      });
      expect(byDate.get('2026-10-03')).toMatchObject({
        firstLoginAt: null,
        signedInBeforeDay: true,
        lastLogoutAt: '2026-10-02T22:15:00.000Z',
        lastLogoutInferred: false,
      });
    });

    it('moves the same events to other days when the workspace zone changes', async () => {
      await seed(agent.id, 'signed_in', '2026-10-02T20:30:00Z');
      await seed(agent.id, 'signed_out', '2026-10-02T20:45:00Z');
      await ctx.app.settings.set('timezone', 'UTC', null);
      const { days } = await report(admin, `${range}&userId=${agent.id}`);
      expect(days.map((d) => d.date)).toEqual(['2026-10-02']);
    });

    it('says when a logout was inferred from a session nobody closed', async () => {
      await seed(agent.id, 'signed_in', '2026-10-02T05:00:00Z');
      await seed(agent.id, 'online', '2026-10-02T05:00:01Z');
      await seed(agent.id, 'offline', '2026-10-02T14:00:00Z');
      const { days } = await report(admin, `${range}&userId=${agent.id}`);
      expect(days).toHaveLength(1);
      expect(days[0]).toMatchObject({
        lastLogoutAt: '2026-10-02T14:00:00.000Z',
        lastLogoutInferred: true,
        lastLogoutReason: 'disconnected',
        stillSignedIn: false,
      });
    });

    it('does not carry a session with no end through every later day', async () => {
      // No disconnect, no heartbeat: all that is known is that it began.
      await seed(agent.id, 'signed_in', '2026-10-02T05:00:00Z');
      await seed(agent.id, 'online', '2026-10-02T05:00:01Z');
      const { days } = await report(admin, `${range}&userId=${agent.id}`);
      expect(days.map((d) => d.date)).toEqual(['2026-10-02']);
      expect(days[0]).toMatchObject({ lastLogoutInferred: true, lastLogoutReason: 'no_signal' });
    });

    it('sees a session already open before the range began', async () => {
      await seed(agent.id, 'signed_in', '2026-10-01T05:00:00Z');
      await seed(agent.id, 'signed_out', '2026-10-02T05:00:00Z');
      const { days } = await report(admin, `${range}&userId=${agent.id}`);
      expect(days.find((d) => d.date === '2026-10-02')).toMatchObject({
        firstLoginAt: null,
        signedInBeforeDay: true,
        lastLogoutAt: '2026-10-02T05:00:00.000Z',
      });
    });

    it('adds the first call handled and the day totals, on the workspace day', async () => {
      const call = (at: string, status: string, talk: number) =>
        ctx.app.db.call.create({
          data: {
            id: newId(),
            pbxCallId: `att.${newId()}`,
            pbxCdrUid: newId(),
            direction: 'inbound',
            status,
            fromNumber: '0712000000',
            toNumber: '1001',
            userId: agent.id,
            extension: '1001',
            startedAt: new Date(at),
            answeredAt: status === 'completed' ? new Date(at) : null,
            talkDurationSec: talk,
          },
        });
      // 23:00 on the 2nd in Nairobi, after a missed call earlier that day.
      await call('2026-10-02T06:00:00Z', 'missed', 0);
      await call('2026-10-02T20:00:00Z', 'completed', 90);
      // 00:30 on the 3rd in Nairobi, though still the 2nd in UTC.
      await call('2026-10-02T21:30:00Z', 'completed', 30);

      const { days } = await report(admin, `${range}&userId=${agent.id}`);
      const byDate = new Map(days.map((d) => [d.date, d]));
      expect(byDate.get('2026-10-02')).toMatchObject({
        firstCallAt: '2026-10-02T20:00:00.000Z',
        firstLoginAt: null,
        calls: { total: 2, answered: 1, missed: 1, talkSec: 90 },
      });
      expect(byDate.get('2026-10-03')).toMatchObject({
        firstCallAt: '2026-10-02T21:30:00.000Z',
        calls: { total: 1, answered: 1, talkSec: 30 },
      });
    });

    it('shows an agent only themselves, whatever they ask for', async () => {
      await seed(agent.id, 'signed_in', '2026-10-02T05:00:00Z');
      await seed(admin.id, 'signed_in', '2026-10-02T05:00:00Z');
      const mine = await report(agent, range);
      expect(new Set(mine.days.map((d) => d.userId))).toEqual(new Set([agent.id]));
      const theirs = await report(agent, `${range}&userId=${admin.id}`);
      expect(theirs.days).toHaveLength(0);
    });

    it('gates the export on its own permission', async () => {
      const res = await ctx.as(agent, {
        method: 'GET',
        url: `/api/v1/reports/attendance?${range}&format=csv`,
      });
      expect(res.statusCode).toBe(403);
      const ok = await ctx.as(admin, {
        method: 'GET',
        url: `/api/v1/reports/attendance?${range}&format=csv`,
      });
      expect(ok.statusCode, ok.body).toBe(200);
      expect(ok.headers['content-type']).toContain('text/csv');
    });

    it('refuses a range too long to work out', async () => {
      const res = await ctx.as(admin, {
        method: 'GET',
        url: '/api/v1/reports/attendance?from=2025-01-01T00:00:00.000Z&to=2026-01-01T00:00:00.000Z',
      });
      expect(res.statusCode).toBe(400);
    });

    it('lists presence changes, newest first, with how long each lasted', async () => {
      await seed(agent.id, 'signed_in', '2026-10-02T05:00:00Z');
      await seed(agent.id, 'signed_out', '2026-10-02T06:00:00Z');
      await ctx.app.db.agentPresenceEvent.create({
        data: {
          id: newId(),
          userId: agent.id,
          channel: 'phone',
          state: 'on_call',
          at: new Date('2026-10-02T05:30:00Z'),
        },
      });
      const res = await ctx.as(admin, {
        method: 'GET',
        url: `/api/v1/reports/attendance/presence?${range}&userId=${agent.id}&channel=crm`,
      });
      expect(res.statusCode, res.body).toBe(200);
      const body = res.json<{
        data: { from: string | null; to: string; durationSec: number | null }[];
        page: { total: number };
      }>();
      expect(body.page.total).toBe(2);
      expect(body.data.map((r) => [r.from, r.to, r.durationSec])).toEqual([
        ['online', 'signed_out', null],
        [null, 'online', 3600],
      ]);
    });

    it('returns nothing, and no invented history, before recording began', async () => {
      const { days, recordingSince } = await report(admin, range);
      expect(days).toHaveLength(0);
      expect(recordingSince).toBeNull();
    });
  });
});
