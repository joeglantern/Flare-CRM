/**
 * What the console watches for, what an owner can do about it, and the words for both.
 *
 * An alert is a fact with a timestamp. Acknowledging one says a person has seen it and stops the
 * console mentioning it again; snoozing says "not now"; muting says "never, for this customer";
 * closing says "this is dealt with", and if the underlying thing is still true the next sweep opens
 * a fresh one rather than pretending otherwise. None of those make the fact go away.
 */
import { z } from 'zod';

/** How an open alert stands with whoever is looking after it. */
export const ALERT_STATES = ['open', 'acked', 'snoozed', 'resolved', 'closed'] as const;
export type AlertState = (typeof ALERT_STATES)[number];

export const ALERT_STATE_COPY: Record<AlertState, { label: string; description: string }> = {
  open: { label: 'Open', description: 'Nobody has looked at this yet.' },
  acked: { label: 'Acknowledged', description: 'Somebody has seen it and it is in hand.' },
  snoozed: { label: 'Snoozed', description: 'Set aside until a time that has not come yet.' },
  resolved: { label: 'Cleared', description: 'The thing it was about stopped being true.' },
  closed: { label: 'Closed', description: 'Closed by hand, whether or not it was still true.' },
};

/**
 * How long the console waits before calling something a problem, and who hears about it.
 *
 * The defaults are what these were as constants in the sweep, so writing the settings row for the
 * first time changes nothing. Every one is a judgement about somebody else's business, which is why
 * they belong in a screen rather than in a source file.
 */
export const alertThresholds = z.object({
  offlineMinutes: z.number().int().min(1).max(1440).default(10),
  unhealthyMinutes: z.number().int().min(1).max(1440).default(15),
  backupStaleHours: z.number().int().min(1).max(720).default(48),
  expiryWarningDays: z.number().int().min(1).max(180).default(14),
  capNearRatio: z.number().min(0.1).max(1).default(0.8),
  /** A stack registered this long ago that has still never said hello. */
  neverConnectedHours: z.number().int().min(1).max(720).default(24),
  /** A document a connected stack has not applied after this long. */
  undeliveredMinutes: z.number().int().min(1).max(1440).default(30),
  /** A stack this far behind the version most of the fleet is running. */
  versionDriftDays: z.number().int().min(1).max(365).default(14),
  /** A trial ending within this many days is worth knowing about. */
  trialEndingDays: z.number().int().min(1).max(180).default(7),
});
export type AlertThresholds = z.infer<typeof alertThresholds>;

export const DEFAULT_ALERT_THRESHOLDS: AlertThresholds = alertThresholds.parse({});

/** Where each kind is sent. Anything without its own list goes to the default one. */
export const alertRecipients = z.object({
  default: z.array(z.email().max(254)).max(10).default([]),
  byKind: z.record(z.string(), z.array(z.email().max(254)).max(10)).default({}),
});
export type AlertRecipients = z.infer<typeof alertRecipients>;

/** Muting is per kind, per customer, or both: "never tell me about backups at this one". */
export const alertMuteBody = z
  .object({
    kind: z.string().max(40).optional(),
    customerId: z.uuid().optional(),
    reason: z.string().trim().min(1).max(300),
    expiresAt: z.iso.datetime({ offset: true }).nullable().default(null),
  })
  .refine((v) => v.kind !== undefined || v.customerId !== undefined, {
    message: 'Mute a kind, a customer, or both. Muting everything is not a setting.',
  });

export const SNOOZE_OPTIONS = [
  { hours: 1, label: 'An hour' },
  { hours: 8, label: 'Today' },
  { hours: 24, label: 'A day' },
  { hours: 24 * 7, label: 'A week' },
] as const;

/** The longest anything can be set aside for, so nothing is quietly ignored forever. */
export const MAX_SNOOZE_DAYS = 30;

export const CONSOLE_SETTING_KEYS = {
  ownerContact: 'ownerContact',
  alertThresholds: 'alerts.thresholds',
  alertRecipients: 'alerts.recipients',
  retention: 'retention',
} as const;

/** How long the console keeps what it has finished with. Audit rows are not in this list. */
export const retentionSettings = z.object({
  resolvedAlertDays: z.number().int().min(7).max(3650).default(180),
  issueDays: z.number().int().min(30).max(3650).default(365),
  sampleDays: z.number().int().min(7).max(400).default(30),
  stackDayDays: z.number().int().min(30).max(3650).default(400),
});
export type RetentionSettings = z.infer<typeof retentionSettings>;

export const DEFAULT_RETENTION: RetentionSettings = retentionSettings.parse({});
