/**
 * What the owner console measures, and the shape it hands to its own client (docs/21).
 *
 * Everything here is derived from what customer stacks report over the link: a sample every five
 * minutes, rolled up into a row per stack per day and a row per day for the whole fleet. The
 * console holds no business data of any customer, so nothing in this file describes one; these are
 * counts of seats, bytes, minutes connected, versions and money agreed.
 *
 * The server does every aggregation. A series arrives dense, one point per day with no gaps, so the
 * client draws it without deciding anything.
 */
import { z } from 'zod';
import { isoDate, isoDateTime } from './schemas/common.js';

/** One point on a daily series. `t` is the day, `v` is the figure for that day. */
export const seriesPoint = z.object({ t: isoDate, v: z.number() });
export type SeriesPoint = z.infer<typeof seriesPoint>;
const series = z.array(seriesPoint);

/** Money is minor units of the currency, never a float. 1500 KES is 150000. */
export const money = z.number().int();

export const ALERT_KINDS = [
  'stack_offline',
  'stack_unhealthy',
  'cap_near',
  'cap_reached',
  'plan_expiring',
  'plan_expired',
  'backup_stale',
  'document_rejected',
  'stack_never_connected',
  'document_undelivered',
  'version_drift',
  'trial_ending',
] as const;
export type AlertKind = (typeof ALERT_KINDS)[number];

export const ALERT_LEVELS = ['info', 'warning', 'danger'] as const;
export type AlertLevel = (typeof ALERT_LEVELS)[number];

/** What each kind is about, so the console and its emails say the same thing. */
export const ALERTS: Record<AlertKind, { label: string; description: string; level: AlertLevel }> =
  {
    stack_offline: {
      label: 'Stack offline',
      description: 'This customer’s stack has not reported in for more than ten minutes.',
      level: 'danger',
    },
    stack_unhealthy: {
      label: 'Stack unhealthy',
      description: 'The stack is reporting in but says one of its own checks is failing.',
      level: 'warning',
    },
    cap_near: {
      label: 'Close to a limit',
      description: 'Seats or storage have passed four fifths of what the plan allows.',
      level: 'warning',
    },
    cap_reached: {
      label: 'Limit reached',
      description: 'Seats or storage are at the plan limit, so the next attempt will be refused.',
      level: 'danger',
    },
    plan_expiring: {
      label: 'Plan expiring',
      description: 'This plan runs out within a fortnight; after that every change is refused.',
      level: 'warning',
    },
    plan_expired: {
      label: 'Plan expired',
      description: 'This customer can read their CRM and change nothing in it.',
      level: 'danger',
    },
    backup_stale: {
      label: 'Backup stale',
      description: 'No backup has run on this stack for more than two days.',
      level: 'warning',
    },
    document_rejected: {
      label: 'Document refused',
      description:
        'The stack refused the entitlements it was sent, and is running on the previous one.',
      level: 'danger',
    },
    stack_never_connected: {
      label: 'Never connected',
      description:
        'Credentials were issued for this stack and it has never once reported in, so nobody has noticed it is not running.',
      level: 'danger',
    },
    document_undelivered: {
      label: 'Document not applied',
      description:
        'The stack is connected but has not applied the document it was sent, so it is running on the previous one.',
      level: 'warning',
    },
    version_drift: {
      label: 'Behind the fleet',
      description: 'This stack is running an older version than the rest of the fleet.',
      level: 'warning',
    },
    trial_ending: {
      label: 'Trial ending',
      description: 'This customer stops paying nothing shortly, and starts paying the list price.',
      level: 'warning',
    },
  };

/**
 * The words for a kind, without assuming it is one we still watch for.
 *
 * A resolved alert is kept for months, so a kind retired from the sweep can still be read back out
 * of the log. Indexing `ALERTS` directly would throw on the screen showing it, which is a poor way
 * to learn that history outlives a constant.
 */
export function alertCopy(kind: string): { label: string; description: string; level: AlertLevel } {
  return (ALERT_KINDS as readonly string[]).includes(kind)
    ? ALERTS[kind as AlertKind]
    : { label: kind, description: 'A check the console no longer runs.', level: 'warning' };
}

export const alertDto = z.object({
  id: z.string(),
  kind: z.enum(ALERT_KINDS),
  level: z.enum(ALERT_LEVELS),
  customerId: z.string(),
  customerName: z.string(),
  stackId: z.string().nullable(),
  openedAt: isoDateTime,
  resolvedAt: isoDateTime.nullable(),
  /** Whatever the check measured: used, max, hours, a version. Rendered as a sentence. */
  context: z.record(z.string(), z.unknown()),
});
export type AlertDto = z.infer<typeof alertDto>;

/** A count against a ceiling, where a null ceiling means the plan does not cap it. */
const against = z.object({ used: z.number(), sold: z.number(), unlimited: z.number().int() });

export const consoleOverviewDto = z.object({
  generatedAt: isoDateTime,
  rangeDays: z.number().int(),
  /** Empty until a stack has reported for the first time, which the screen says plainly. */
  hasData: z.boolean(),
  now: z.object({
    customers: z.number().int(),
    customersActive: z.number().int(),
    customersLive: z.number().int(),
    stacks: z.number().int(),
    seats: against,
    storage: z.object({
      usedBytes: z.number(),
      soldBytes: z.number(),
      unlimited: z.number().int(),
    }),
    currency: z.string(),
    mrrMinor: money,
    arpuMinor: money,
    openAlerts: z.number().int(),
    /** Customers paying nothing yet, and agreements coming round again within the month. */
    trials: z.number().int(),
    renewalsDue30d: z.number().int(),
  }),
  series: z.object({
    customers: series,
    live: series,
    seatsUsed: series,
    seatsSold: series,
    storageBytes: series,
    mrrMinor: series,
  }),
  planMix: z.array(
    z.object({
      planId: z.string().nullable(),
      name: z.string(),
      customers: z.number().int(),
      mrrMinor: money,
    }),
  ),
  versions: z.array(z.object({ version: z.string(), stacks: z.number().int() })),
  expiring: z.array(
    z.object({
      customerId: z.string(),
      name: z.string(),
      expiresAt: isoDateTime,
      days: z.number().int(),
      mrrMinor: money,
    }),
  ),
  delivery: z.object({
    medianAckSeconds: z.number().nullable(),
    pending: z.number().int(),
    rejected: z.number().int(),
  }),
  alerts: z.array(alertDto),
});
export type ConsoleOverviewDto = z.infer<typeof consoleOverviewDto>;

export const customerAnalyticsDto = z.object({
  customerId: z.string(),
  rangeDays: z.number().int(),
  hasData: z.boolean(),
  seats: z.object({
    series,
    cap: z.number().int().nullable(),
    latest: z.number().int().nullable(),
  }),
  storage: z.object({
    series,
    capBytes: z.number().nullable(),
    latestBytes: z.number().nullable(),
    /** Only present when storage is growing and the plan caps it. */
    projection: z.object({ fullOn: isoDate, perDayBytes: z.number() }).nullable(),
  }),
  uptime: z.object({
    percent: z.number().nullable(),
    days: z.array(
      z.object({ t: isoDate, connectedMinutes: z.number().int(), readyFailures: z.number().int() }),
    ),
  }),
  backups: z.object({
    lastAt: isoDateTime.nullable(),
    ageHours: z.number().nullable(),
    days: z.array(z.object({ t: isoDate, seen: z.boolean() })),
  }),
  versions: z.array(z.object({ from: isoDate, version: z.string() })),
  events: z.array(
    z.object({
      at: isoDateTime,
      kind: z.enum(['issue', 'entitlement', 'alert', 'announce', 'stack']),
      label: z.string(),
      detail: z.string().nullable(),
    }),
  ),
});
export type CustomerAnalyticsDto = z.infer<typeof customerAnalyticsDto>;

/**
 * Why money is at risk, in the four shapes it actually takes. A total on its own is a worry; with
 * the reason beside it, it is something somebody can go and do something about.
 */
export const AT_RISK_REASONS = [
  'expiring',
  'trial_ending',
  'suspended',
  'discount_ending',
] as const;
export type AtRiskReason = (typeof AT_RISK_REASONS)[number];

export const AT_RISK_REASON_COPY: Record<AtRiskReason, string> = {
  expiring: 'Plan runs out within the month',
  trial_ending: 'Trial ends within the month',
  suspended: 'Held read only, so earning nothing',
  discount_ending: 'Discount ends within the month',
};

export const revenueAnalyticsDto = z.object({
  currency: z.string(),
  mrrMinor: money,
  arpuMinor: money,
  payingCustomers: z.number().int(),
  months: z.array(z.object({ t: isoDate, v: money })),
  byPlan: z.array(
    z.object({
      planId: z.string().nullable(),
      name: z.string(),
      customers: z.number().int(),
      mrrMinor: money,
    }),
  ),
  atRisk: z.object({
    minor: money,
    customers: z.number().int(),
    withinDays: z.number().int(),
    byReason: z.array(
      z.object({
        reason: z.enum(AT_RISK_REASONS),
        minor: money,
        customers: z.number().int(),
      }),
    ),
  }),
  /** What trials would be worth if every one of them converted at the list price. */
  trials: z.object({ count: z.number().int(), minorWhenConverted: money }),
  /** What the discounts currently in force cost us a month. */
  discounts: z.object({ count: z.number().int(), minorGivenAway: money }),
});
export type RevenueAnalyticsDto = z.infer<typeof revenueAnalyticsDto>;

/** Query accepted by the two ranged endpoints. */
export const analyticsRange = z.object({
  days: z.coerce.number().int().min(1).max(400).default(30),
});
