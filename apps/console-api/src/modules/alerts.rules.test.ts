/**
 * The judgements the sweep makes, argued with here rather than in production.
 *
 * These used to be constants inside a loop that needed a database and a fleet to exercise, which
 * meant the thresholds were never really tested at all.
 */
import { DEFAULT_ALERT_THRESHOLDS } from '@crm/shared';
import { describe, expect, it } from 'vitest';
import {
  backupStale,
  driftedFrom,
  expiryState,
  fleetVersion,
  isOffline,
  neverConnected,
  trialEnding,
  undelivered,
  worstCapRatio,
} from './alerts.rules.js';

const NOW = new Date('2026-09-12T12:00:00.000Z');
const T = DEFAULT_ALERT_THRESHOLDS;
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe('a stack that has gone quiet', () => {
  it('is offline once it passes the threshold, and not before', () => {
    expect(isOffline(ago(9 * MINUTE), NOW, T)).toBe(false);
    expect(isOffline(ago(11 * MINUTE), NOW, T)).toBe(true);
  });

  it('is not offline when it has never reported at all', () => {
    // That is a different fault with a different answer, and it has its own check.
    expect(isOffline(null, NOW, T)).toBe(false);
  });
});

describe('a stack that has never connected', () => {
  it('is only a fault once it has had long enough to come up', () => {
    const fresh = { lastSeenAt: null, createdAt: ago(2 * HOUR), revokedAt: null };
    expect(neverConnected(fresh, NOW, T)).toBe(false);
    const stale = { lastSeenAt: null, createdAt: ago(30 * HOUR), revokedAt: null };
    expect(neverConnected(stale, NOW, T)).toBe(true);
  });

  it('says nothing about one that has reported, or one that was revoked', () => {
    expect(
      neverConnected({ lastSeenAt: ago(HOUR), createdAt: ago(30 * HOUR), revokedAt: null }, NOW, T),
    ).toBe(false);
    expect(
      neverConnected({ lastSeenAt: null, createdAt: ago(30 * HOUR), revokedAt: ago(HOUR) }, NOW, T),
    ).toBe(false);
  });
});

describe('backups', () => {
  it('counts never having run as stale', () => {
    expect(backupStale(null, NOW, T)).toBe(true);
  });

  it('allows a backup from last night and refuses one from last week', () => {
    expect(backupStale(ago(12 * HOUR), NOW, T)).toBe(false);
    expect(backupStale(ago(7 * DAY), NOW, T)).toBe(true);
  });
});

describe('how close a customer is to their ceiling', () => {
  const usage = { seatsActive: 9, storageBytes: 2 * 1024 ** 3 };

  it('picks whichever is nearest its limit', () => {
    const worst = worstCapRatio(usage, { seats: 10, storageGb: 100 });
    expect(worst?.what).toBe('seats');
    expect(worst?.ratio).toBeCloseTo(0.9);
  });

  it('ignores anything the plan does not cap', () => {
    const worst = worstCapRatio(usage, { seats: null, storageGb: 4 });
    expect(worst?.what).toBe('storage');
  });

  it('has nothing to say without usage, or without any cap at all', () => {
    expect(worstCapRatio(null, { seats: 10, storageGb: 20 })).toBeNull();
    expect(worstCapRatio(usage, { seats: null, storageGb: null })).toBeNull();
  });
});

describe('plans and trials running out', () => {
  it('separates gone from going', () => {
    expect(expiryState(ago(3 * DAY), NOW, T)).toEqual({ state: 'expired', days: 3 });
    expect(expiryState(new Date(NOW.getTime() + 5 * DAY), NOW, T)?.state).toBe('expiring');
    expect(expiryState(new Date(NOW.getTime() + 100 * DAY), NOW, T)).toBeNull();
    expect(expiryState(null, NOW, T)).toBeNull();
  });

  it('mentions a trial only while it is still ahead', () => {
    expect(trialEnding(new Date(NOW.getTime() + 3 * DAY), NOW, T)?.days).toBe(3);
    expect(trialEnding(new Date(NOW.getTime() + 30 * DAY), NOW, T)).toBeNull();
    // One that has already ended is not ending: they are simply paying now.
    expect(trialEnding(ago(DAY), NOW, T)).toBeNull();
  });
});

describe('a document that has not been applied', () => {
  it('only counts against a stack that is actually connected', () => {
    const waiting = { issuedAt: ago(2 * HOUR), status: 'pending' };
    expect(undelivered(waiting, true, NOW, T)).toBe(true);
    // An offline stack has an obvious reason, and an alert of its own that says so.
    expect(undelivered(waiting, false, NOW, T)).toBe(false);
  });

  it('gives it a reasonable while before complaining', () => {
    expect(undelivered({ issuedAt: ago(5 * MINUTE), status: 'pending' }, true, NOW, T)).toBe(false);
  });

  it('says nothing about one that was applied or refused', () => {
    expect(undelivered({ issuedAt: ago(2 * HOUR), status: 'acked' }, true, NOW, T)).toBe(false);
    expect(undelivered(null, true, NOW, T)).toBe(false);
  });
});

describe('what the fleet is running', () => {
  it('needs a majority, not merely the most common', () => {
    expect(fleetVersion(['a', 'a', 'a', 'b'])).toBe('a');
    // Three ways split is a disagreement, and calling any of them behind would be a coin toss.
    expect(fleetVersion(['a', 'b', 'c'])).toBeNull();
  });

  it('says nothing about a fleet too small to have an opinion', () => {
    expect(fleetVersion(['a', 'a'])).toBeNull();
    expect(fleetVersion([null, null, null])).toBeNull();
  });

  it('calls a stack behind only when there is something to be behind', () => {
    expect(driftedFrom('old', 'new')).toBe(true);
    expect(driftedFrom('new', 'new')).toBe(false);
    expect(driftedFrom('old', null)).toBe(false);
    expect(driftedFrom(null, 'new')).toBe(false);
  });
});
