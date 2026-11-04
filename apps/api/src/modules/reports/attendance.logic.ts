/**
 * Turns recorded presence events into what the attendance reports show. Pure, so the awkward cases
 * (a closed laptop, a crash, midnight) can be reasoned about and tested without a database.
 */
import type { LogoutReason, PresenceState } from '@crm/shared';

export interface PresenceEventRow {
  channel: string;
  state: string;
  reason: string | null;
  inferred: boolean;
  at: Date;
}

export interface Transition {
  at: Date;
  state: PresenceState;
  inferred: boolean;
  reason: LogoutReason | null;
  /** On a move to online: whether a real sign-in caused it. */
  viaSignIn: boolean;
}

export interface SignedInInterval {
  start: Date | null;
  startInferred: boolean;
  /** Null while still signed in. */
  end: Date | null;
  endInferred: boolean;
  endReason: LogoutReason | null;
}

/** A dropped connection shorter than this is a wifi blip or a deploy, not someone leaving. */
export const RECONNECT_GRACE_MS = 15 * 60 * 1000;
/**
 * The socket refreshes `lastSeenAt` about once a minute. Well past that with no disconnect recorded,
 * the server lost track of the connection (a crash), and the agent is no longer provably there.
 */
export const STALE_AFTER_MS = 5 * 60 * 1000;
/** A session lasts twelve hours, so a new connection later than that cannot be the same stay. */
const SESSION_MAX_MS = 12 * 60 * 60 * 1000;
/** A sign-out's own tab takes a moment to disconnect. Later than this, another browser was open. */
const SIGN_OUT_SETTLE_MS = 60 * 1000;

const LOGOUT_REASONS = new Set<string>(['sign_out', 'idle', 'session_ended']);

const lostSignal = (at: Date): Transition => ({
  at,
  state: 'disconnected',
  inferred: true,
  reason: 'no_signal',
  viaSignIn: false,
});

/**
 * Reduces the CRM events to real changes of state, and supplies the ones that never arrived. A
 * browser that closes without signing out leaves no sign-out, and a crash leaves no disconnect, so
 * an agent must not read as present forever because of them.
 */
export function crmTransitions(
  events: readonly PresenceEventRow[],
  now: Date,
  lastSeenAt: Date | null,
): Transition[] {
  const out: Transition[] = [];
  let lastActivity: Date | null = null;

  for (const e of events) {
    const cur = out[out.length - 1];
    if (e.state === 'signed_in' || e.state === 'online') {
      let lost = false;
      if (
        cur?.state === 'online' &&
        lastActivity !== null &&
        e.at.getTime() - lastActivity.getTime() > SESSION_MAX_MS
      ) {
        out.push(lostSignal(lastActivity));
        lost = true;
      }
      if (lost || cur?.state !== 'online') {
        out.push({
          at: e.at,
          state: 'online',
          inferred: false,
          reason: null,
          viaSignIn: e.state === 'signed_in',
        });
      }
    } else if (e.state === 'offline') {
      if (cur?.state === 'online') {
        out.push({
          at: e.at,
          state: 'disconnected',
          inferred: e.inferred,
          reason: 'disconnected',
          viaSignIn: false,
        });
      } else if (
        cur?.state === 'signed_out' &&
        e.at.getTime() - cur.at.getTime() > SIGN_OUT_SETTLE_MS
      ) {
        // Signed out in one browser while another stayed connected, until now.
        out.pop();
        out.push({
          at: e.at,
          state: 'disconnected',
          inferred: true,
          reason: 'disconnected',
          viaSignIn: false,
        });
      }
    } else if (e.state === 'signed_out' && cur?.state !== 'signed_out') {
      out.push({
        at: e.at,
        state: 'signed_out',
        inferred: false,
        reason: LOGOUT_REASONS.has(e.reason ?? '') ? (e.reason as LogoutReason) : 'sign_out',
        viaSignIn: false,
      });
    }
    lastActivity = e.at;
  }

  if (out[out.length - 1]?.state === 'online' && lastActivity !== null) {
    const seen =
      lastSeenAt !== null && lastSeenAt.getTime() > lastActivity.getTime()
        ? lastSeenAt
        : lastActivity;
    if (now.getTime() - seen.getTime() > STALE_AFTER_MS) out.push(lostSignal(seen));
  }
  return out;
}

/** Signed-in stretches, with short drops folded into the stretch around them. */
export function signedInIntervals(
  transitions: readonly Transition[],
  now: Date,
): SignedInInterval[] {
  const out: SignedInInterval[] = [];
  let open: SignedInInterval | null = null;
  let drop: Transition | null = null;

  const dropIsFinal = (d: Transition, at: Date): boolean =>
    d.reason === 'no_signal' || at.getTime() - d.at.getTime() > RECONNECT_GRACE_MS;

  for (const t of transitions) {
    if (t.state === 'online') {
      if (open !== null && drop !== null && dropIsFinal(drop, t.at)) {
        out.push({
          ...open,
          end: drop.at,
          endInferred: true,
          endReason: drop.reason ?? 'disconnected',
        });
        open = null;
      }
      drop = null;
      open ??= {
        start: t.at,
        startInferred: !t.viaSignIn,
        end: null,
        endInferred: false,
        endReason: null,
      };
    } else if (t.state === 'disconnected') {
      drop = t;
    } else if (t.state === 'signed_out') {
      const reason = t.reason ?? 'sign_out';
      const last = out[out.length - 1];
      if (open !== null) {
        out.push({ ...open, end: t.at, endInferred: false, endReason: reason });
        open = null;
      } else if (last?.endInferred === true) {
        // The browser had gone, then came back just long enough to sign out: that sign-out is real.
        last.end = t.at;
        last.endInferred = false;
        last.endReason = reason;
      } else {
        out.push({
          start: null,
          startInferred: false,
          end: t.at,
          endInferred: false,
          endReason: reason,
        });
      }
      drop = null;
    }
  }
  if (open !== null) {
    if (drop !== null && dropIsFinal(drop, now)) {
      out.push({
        ...open,
        end: drop.at,
        endInferred: true,
        endReason: drop.reason ?? 'disconnected',
      });
    } else {
      out.push(open);
    }
  }
  return out;
}

/** The calendar day of an instant in a time zone, as YYYY-MM-DD. */
export function dayKey(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}

/** How far a zone is ahead of UTC at an instant, in milliseconds. */
function zoneOffsetMs(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(at);
  const part = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const wall = Date.UTC(
    part('year'),
    part('month') - 1,
    part('day'),
    part('hour'),
    part('minute'),
    part('second'),
  );
  return wall - Math.floor(at.getTime() / 1000) * 1000;
}

/** The instant a calendar day begins in a zone. Measured twice, in case the clocks change that day. */
export function dayStartInstant(key: string, timeZone: string): Date {
  const utcMidnight = new Date(`${key}T00:00:00.000Z`).getTime();
  const first = utcMidnight - zoneOffsetMs(new Date(utcMidnight), timeZone);
  return new Date(utcMidnight - zoneOffsetMs(new Date(first), timeZone));
}

const nextDay = (key: string): string => {
  const d = new Date(`${key}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

export function dayEndInstant(key: string, timeZone: string): Date {
  return dayStartInstant(nextDay(key), timeZone);
}

export interface DayAttendance {
  date: string;
  firstLoginAt: Date | null;
  firstLoginInferred: boolean;
  signedInBeforeDay: boolean;
  lastLogoutAt: Date | null;
  lastLogoutInferred: boolean;
  lastLogoutReason: LogoutReason | null;
  stillSignedIn: boolean;
  continuedNextDay: boolean;
}

/**
 * One entry per calendar day an interval touches. Compared as day names rather than instants, so a
 * day is whatever the zone says it is.
 */
export function attendanceDays(
  intervals: readonly SignedInInterval[],
  timeZone: string,
  firstDay: string,
  lastDay: string,
  now: Date,
): Map<string, DayAttendance> {
  const days = new Map<string, DayAttendance>();
  const today = dayKey(now, timeZone);
  const row = (date: string): DayAttendance => {
    let d = days.get(date);
    if (!d) {
      d = {
        date,
        firstLoginAt: null,
        firstLoginInferred: false,
        signedInBeforeDay: false,
        lastLogoutAt: null,
        lastLogoutInferred: false,
        lastLogoutReason: null,
        stillSignedIn: false,
        continuedNextDay: false,
      };
      days.set(date, d);
    }
    return d;
  };

  for (const interval of intervals) {
    const endDay = interval.end ? dayKey(interval.end, timeZone) : today;
    const startDay = interval.start ? dayKey(interval.start, timeZone) : endDay;
    // Starting at the range's edge keeps a long-open interval from walking years of days.
    let date = startDay < firstDay ? firstDay : startDay;
    const stop = endDay > lastDay ? lastDay : endDay;
    while (date <= stop) {
      const d = row(date);
      if (date !== startDay) {
        if (d.firstLoginAt === null) d.signedInBeforeDay = true;
      } else if (interval.start !== null && d.firstLoginAt === null) {
        d.firstLoginAt = interval.start;
        d.firstLoginInferred = interval.startInferred;
      }
      if (date === endDay && interval.end !== null) {
        d.lastLogoutAt = interval.end;
        d.lastLogoutInferred = interval.endInferred;
        d.lastLogoutReason = interval.endReason;
        d.stillSignedIn = false;
        d.continuedNextDay = false;
      } else {
        // Whatever ended earlier today is not the day's last word: this stretch ran on.
        d.lastLogoutAt = null;
        d.lastLogoutInferred = false;
        d.lastLogoutReason = null;
        d.stillSignedIn = interval.end === null && date === today;
        d.continuedNextDay = !d.stillSignedIn;
      }
      date = nextDay(date);
    }
  }
  return days;
}

const PHONE_STATES: Record<string, PresenceState> = {
  offline: 'phone_offline',
  idle: 'phone_idle',
  ringing: 'phone_ringing',
  on_call: 'phone_on_call',
};

type Change = Pick<Transition, 'at' | 'state' | 'inferred'>;

/** Phone events reduced to changes. The PBX repeats itself, and a repeat is not a change. */
export function phoneTransitions(events: readonly PresenceEventRow[]): Change[] {
  const out: Change[] = [];
  for (const e of events) {
    const state = PHONE_STATES[e.state];
    if (state !== undefined && out[out.length - 1]?.state !== state)
      out.push({ at: e.at, state, inferred: e.inferred });
  }
  return out;
}

export interface PresenceChange {
  from: PresenceState | null;
  to: PresenceState;
  at: Date;
  durationSec: number | null;
  inferred: boolean;
}

/** The changes inside the range. Earlier transitions only supply the state each one came from. */
export function presenceChanges(
  transitions: readonly Change[],
  from: Date,
  to: Date,
): PresenceChange[] {
  const out: PresenceChange[] = [];
  transitions.forEach((t, i) => {
    if (t.at < from || t.at >= to) return;
    const next = transitions[i + 1];
    out.push({
      from: transitions[i - 1]?.state ?? null,
      to: t.state,
      at: t.at,
      durationSec: next ? Math.round((next.at.getTime() - t.at.getTime()) / 1000) : null,
      inferred: t.inferred,
    });
  });
  return out;
}
