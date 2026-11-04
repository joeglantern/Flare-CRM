import { describe, expect, it } from 'vitest';
import {
  attendanceDays,
  crmTransitions,
  dayEndInstant,
  dayKey,
  dayStartInstant,
  phoneTransitions,
  presenceChanges,
  signedInIntervals,
  type PresenceEventRow,
} from './attendance.logic.js';

const NAIROBI = 'Africa/Nairobi';

const ev = (state: string, at: string, reason: string | null = null): PresenceEventRow => ({
  channel: 'crm',
  state,
  reason,
  inferred: false,
  at: new Date(at),
});

const intervals = (events: PresenceEventRow[], now: string, lastSeen: string | null = null) =>
  signedInIntervals(
    crmTransitions(events, new Date(now), lastSeen ? new Date(lastSeen) : null),
    new Date(now),
  );

describe('signed-in intervals', () => {
  it('reads a sign-in and a sign-out as they happened', () => {
    const [only] = intervals(
      [
        ev('signed_in', '2026-11-03T05:00:00Z'),
        ev('online', '2026-11-03T05:00:01Z'),
        ev('signed_out', '2026-11-03T14:00:00Z', 'sign_out'),
        ev('offline', '2026-11-03T14:00:01Z'),
      ],
      '2026-11-04T00:00:00Z',
    );
    expect(only).toMatchObject({
      start: new Date('2026-11-03T05:00:00Z'),
      startInferred: false,
      end: new Date('2026-11-03T14:00:00Z'),
      endInferred: false,
      endReason: 'sign_out',
    });
  });

  it('folds a short drop into the same stretch', () => {
    const result = intervals(
      [
        ev('signed_in', '2026-11-03T05:00:00Z'),
        ev('offline', '2026-11-03T07:00:00Z'),
        ev('online', '2026-11-03T07:05:00Z'),
        ev('signed_out', '2026-11-03T14:00:00Z'),
      ],
      '2026-11-04T00:00:00Z',
    );
    expect(result).toHaveLength(1);
  });

  it('does not let a closed browser read as signed in forever', () => {
    const [only] = intervals(
      [ev('signed_in', '2026-11-03T05:00:00Z'), ev('offline', '2026-11-03T14:00:00Z')],
      '2026-11-04T00:00:00Z',
    );
    expect(only).toMatchObject({
      end: new Date('2026-11-03T14:00:00Z'),
      endInferred: true,
      endReason: 'disconnected',
    });
  });

  it('closes a connection the server lost at the last sign of life', () => {
    const [only] = intervals(
      [ev('signed_in', '2026-11-03T05:00:00Z'), ev('online', '2026-11-03T05:00:01Z')],
      '2026-11-04T00:00:00Z',
      '2026-11-03T09:30:00Z',
    );
    expect(only).toMatchObject({
      end: new Date('2026-11-03T09:30:00Z'),
      endInferred: true,
      endReason: 'no_signal',
    });
  });

  it('keeps an agent with a fresh heartbeat signed in', () => {
    const [only] = intervals(
      [ev('signed_in', '2026-11-03T05:00:00Z'), ev('online', '2026-11-03T05:00:01Z')],
      '2026-11-03T14:00:00Z',
      '2026-11-03T13:59:30Z',
    );
    expect(only?.end).toBeNull();
  });

  it('marks a start as inferred when the session predates the connection', () => {
    const [only] = intervals(
      [ev('online', '2026-11-03T05:00:00Z'), ev('signed_out', '2026-11-03T06:00:00Z')],
      '2026-11-04T00:00:00Z',
    );
    expect(only?.startInferred).toBe(true);
  });

  it('keeps the agent present when one of two browsers signs out', () => {
    const transitions = crmTransitions(
      [
        ev('signed_in', '2026-11-03T05:00:00Z'),
        ev('signed_out', '2026-11-03T06:00:00Z'),
        ev('offline', '2026-11-03T12:00:00Z'),
      ],
      new Date('2026-11-04T00:00:00Z'),
      null,
    );
    expect(transitions.map((t) => t.state)).toEqual(['online', 'disconnected']);
  });

  it('gives a real sign-out priority over a guess made before it', () => {
    const [only] = intervals(
      [
        ev('signed_in', '2026-11-03T05:00:00Z'),
        ev('offline', '2026-11-03T06:00:00Z'),
        ev('online', '2026-11-03T08:00:00Z'),
        ev('offline', '2026-11-03T08:01:00Z'),
        ev('signed_out', '2026-11-03T09:00:00Z', 'idle'),
      ],
      '2026-11-04T00:00:00Z',
    );
    expect(only?.start).toEqual(new Date('2026-11-03T05:00:00Z'));
    expect(only).toBeDefined();
  });
});

describe('days in the workspace zone', () => {
  it('puts 22:30 UTC on the next day in Nairobi', () => {
    expect(dayKey(new Date('2026-11-03T22:30:00Z'), NAIROBI)).toBe('2026-11-04');
    expect(dayKey(new Date('2026-11-03T20:59:59Z'), NAIROBI)).toBe('2026-11-03');
  });

  it('finds where a day begins, including on a day the clocks change', () => {
    expect(dayStartInstant('2026-11-04', NAIROBI).toISOString()).toBe('2026-11-03T21:00:00.000Z');
    expect(dayEndInstant('2026-11-04', NAIROBI).toISOString()).toBe('2026-11-04T21:00:00.000Z');
    // New York leaves daylight time on 1 November 2026, so that day runs 25 hours.
    const start = dayStartInstant('2026-11-01', 'America/New_York');
    const end = dayEndInstant('2026-11-01', 'America/New_York');
    expect(start.toISOString()).toBe('2026-11-01T04:00:00.000Z');
    expect(end.getTime() - start.getTime()).toBe(25 * 60 * 60 * 1000);
  });

  it('splits a stretch across midnight into both days', () => {
    const days = attendanceDays(
      intervals(
        [ev('signed_in', '2026-11-03T18:00:00Z'), ev('signed_out', '2026-11-03T23:00:00Z')],
        '2026-11-05T00:00:00Z',
      ),
      NAIROBI,
      '2026-11-01',
      '2026-11-05',
      new Date('2026-11-05T00:00:00Z'),
    );
    expect(days.get('2026-11-03')).toMatchObject({
      firstLoginAt: new Date('2026-11-03T18:00:00Z'),
      lastLogoutAt: null,
      continuedNextDay: true,
    });
    expect(days.get('2026-11-04')).toMatchObject({
      firstLoginAt: null,
      signedInBeforeDay: true,
      lastLogoutAt: new Date('2026-11-03T23:00:00Z'),
      continuedNextDay: false,
    });
  });

  it('shows the day as still running when the last stretch has not ended', () => {
    const now = new Date('2026-11-04T09:00:00Z');
    const days = attendanceDays(
      signedInIntervals(
        crmTransitions(
          [
            ev('signed_in', '2026-11-04T05:00:00Z'),
            ev('signed_out', '2026-11-04T06:00:00Z'),
            ev('signed_in', '2026-11-04T07:00:00Z'),
          ],
          now,
          new Date('2026-11-04T08:59:00Z'),
        ),
        now,
      ),
      NAIROBI,
      '2026-11-01',
      '2026-11-04',
      now,
    );
    expect(days.get('2026-11-04')).toMatchObject({
      firstLoginAt: new Date('2026-11-04T05:00:00Z'),
      lastLogoutAt: null,
      stillSignedIn: true,
    });
  });

  it('does not walk days outside the range for a stretch that started long ago', () => {
    const now = new Date('2026-11-04T09:00:00Z');
    const days = attendanceDays(
      [
        {
          start: new Date('2020-01-01T00:00:00Z'),
          startInferred: false,
          end: null,
          endInferred: false,
          endReason: null,
        },
      ],
      NAIROBI,
      '2026-11-03',
      '2026-11-04',
      now,
    );
    expect([...days.keys()]).toEqual(['2026-11-03', '2026-11-04']);
  });
});

describe('presence changes', () => {
  it('gives each change its from, to and how long it lasted, inside the range only', () => {
    const transitions = crmTransitions(
      [
        ev('signed_in', '2026-11-02T05:00:00Z'),
        ev('offline', '2026-11-03T05:00:00Z'),
        ev('online', '2026-11-03T05:10:00Z'),
        ev('signed_out', '2026-11-03T06:10:00Z'),
      ],
      new Date('2026-11-04T00:00:00Z'),
      null,
    );
    const rows = presenceChanges(
      transitions,
      new Date('2026-11-03T00:00:00Z'),
      new Date('2026-11-04T00:00:00Z'),
    );
    expect(rows.map((r) => [r.from, r.to, r.durationSec])).toEqual([
      ['online', 'disconnected', 600],
      ['disconnected', 'online', 3600],
      ['online', 'signed_out', null],
    ]);
  });

  it('treats a repeated phone report as no change', () => {
    const rows = phoneTransitions([
      { ...ev('idle', '2026-11-03T05:00:00Z'), channel: 'phone' },
      { ...ev('idle', '2026-11-03T05:01:00Z'), channel: 'phone' },
      { ...ev('on_call', '2026-11-03T05:02:00Z'), channel: 'phone' },
    ]);
    expect(rows.map((r) => r.state)).toEqual(['phone_idle', 'phone_on_call']);
  });
});
