/**
 * The questions the sweep asks, as plain functions.
 *
 * Every one of these is a judgement about somebody else's business, and every one used to be a
 * constant buried in a loop that needed a database and a fleet to exercise. Here they take numbers
 * and return answers, so the thresholds can be argued with in a test rather than in production.
 */
import type { AlertThresholds } from '@crm/shared';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** A stack that has said nothing for longer than we are willing to wait. */
export function isOffline(lastSeenAt: Date | null, now: Date, t: AlertThresholds): boolean {
  if (lastSeenAt === null) return false;
  return now.getTime() - lastSeenAt.getTime() > t.offlineMinutes * MINUTE;
}

/**
 * A stack that was given credentials and has never once reported in.
 *
 * Deliberately not the same as offline: nobody is waiting for it to come back, because it has never
 * been anywhere. This is the credential pasted onto a server that was never started, and it is the
 * failure that otherwise goes unnoticed for months.
 */
export function neverConnected(
  stack: { lastSeenAt: Date | null; createdAt: Date; revokedAt: Date | null },
  now: Date,
  t: AlertThresholds,
): boolean {
  if (stack.revokedAt !== null || stack.lastSeenAt !== null) return false;
  return now.getTime() - stack.createdAt.getTime() > t.neverConnectedHours * HOUR;
}

/** A backup that is too old, or one that has never been taken at all. */
export function backupStale(lastBackupAt: Date | null, now: Date, t: AlertThresholds): boolean {
  if (lastBackupAt === null) return true;
  return now.getTime() - lastBackupAt.getTime() > t.backupStaleHours * HOUR;
}

export interface CapRatio {
  what: 'seats' | 'storage';
  used: number;
  max: number;
  ratio: number;
}

/** Whichever of seats or storage is closest to its ceiling, ignoring anything uncapped. */
export function worstCapRatio(
  usage: { seatsActive: number; storageBytes: number } | null,
  limits: { seats: number | null; storageGb: number | null },
): CapRatio | null {
  if (usage === null) return null;
  const ratios: CapRatio[] = [];
  if (limits.seats !== null && limits.seats > 0) {
    ratios.push({
      what: 'seats',
      used: usage.seatsActive,
      max: limits.seats,
      ratio: usage.seatsActive / limits.seats,
    });
  }
  if (limits.storageGb !== null && limits.storageGb > 0) {
    const max = limits.storageGb * 1024 ** 3;
    ratios.push({
      what: 'storage',
      used: usage.storageBytes,
      max,
      ratio: usage.storageBytes / max,
    });
  }
  return ratios.sort((a, b) => b.ratio - a.ratio)[0] ?? null;
}

/** Where a plan stands against its expiry: gone, going, or nothing to say. */
export function expiryState(
  expiresAt: Date | null,
  now: Date,
  t: AlertThresholds,
): { state: 'expired' | 'expiring'; days: number } | null {
  if (expiresAt === null) return null;
  const days = Math.ceil((expiresAt.getTime() - now.getTime()) / DAY);
  if (days < 0) return { state: 'expired', days: Math.abs(days) };
  if (days <= t.expiryWarningDays) return { state: 'expiring', days };
  return null;
}

/** A trial about to turn into an invoice. */
export function trialEnding(
  trialEndsAt: Date | null,
  now: Date,
  t: AlertThresholds,
): { days: number } | null {
  if (trialEndsAt === null) return null;
  const remaining = trialEndsAt.getTime() - now.getTime();
  if (remaining < 0) return null;
  const days = Math.ceil(remaining / DAY);
  return days <= t.trialEndingDays ? { days } : null;
}

/**
 * A document a connected stack has had long enough to apply and has not.
 *
 * Only for a stack that is talking to us: one that is offline has an obvious reason for not having
 * applied anything, and it already has an alert of its own saying so.
 */
export function undelivered(
  issue: { issuedAt: Date; status: string } | null,
  connected: boolean,
  now: Date,
  t: AlertThresholds,
): boolean {
  if (!connected || issue === null) return false;
  if (issue.status !== 'pending' && issue.status !== 'delivered') return false;
  return now.getTime() - issue.issuedAt.getTime() > t.undeliveredMinutes * MINUTE;
}

/**
 * The version most of the fleet is on, when there is a clear answer.
 *
 * With two stacks running two versions there is no majority, only a disagreement, and calling one
 * of them behind would be a coin toss. Below three reporting stacks this says nothing at all.
 */
export function fleetVersion(versions: (string | null)[]): string | null {
  const seen = versions.filter((v): v is string => v !== null);
  if (seen.length < 3) return null;
  const counts = new Map<string, number>();
  for (const v of seen) counts.set(v, (counts.get(v) ?? 0) + 1);
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const top = ranked[0];
  if (top === undefined) return null;
  // A majority, not merely the most common of many.
  return top[1] * 2 > seen.length ? top[0] : null;
}

/** A stack running something other than what the fleet has settled on. */
export function driftedFrom(version: string | null, fleet: string | null): boolean {
  return fleet !== null && version !== null && version !== fleet;
}
