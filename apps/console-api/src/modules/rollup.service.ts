/**
 * Turning samples into days (docs/21 §8).
 *
 * A month of charts should be thirty rows, not eight thousand. Every ten minutes this folds the
 * raw samples of today and yesterday into one row per stack per day, and writes one row for the
 * whole fleet. Yesterday is included because a tick that fires at ten past midnight would otherwise
 * leave the last hour of the previous day unrolled forever.
 *
 * The fleet row is a snapshot rather than a recomputation: seats sold and monthly revenue are what
 * they are today, and yesterday's row keeps what they were yesterday. Backfilling them from today's
 * plans would quietly rewrite history every time a price changed.
 */
import { Prisma } from '../generated/prisma/client.js';
import type { Db } from '../plugins/prisma.js';

/** Everything is bucketed in this zone, so a "day" means what the owner means by it. */
export const ROLLUP_TZ = 'Africa/Nairobi';

/** A sample stands for the five minutes it gates, capped at a full day. */
const MINUTES_PER_SAMPLE = 5;

export interface RollupSummary {
  stackDays: number;
  fleetDay: string;
  mrrMinor: number;
}

/** Everything that decides what a customer pays, in one object so no caller forgets a field. */
export interface Agreement {
  plan: { priceMonthlyMinor: number | null } | null;
  priceMonthlyMinorOverride: number | null;
  expiresAt: Date | null;
  trialEndsAt: Date | null;
  discountPercent: number | null;
  discountUntil: Date | null;
}

export type ChargeState = 'trial' | 'discounted' | 'expired' | 'full';

export interface Charge {
  /** What the plan says, or what this customer negotiated as their own price. */
  listMinor: number;
  /** What they are actually billed this month. */
  chargedMinor: number;
  state: ChargeState;
}

export class RollupService {
  constructor(private readonly db: Db) {}

  /**
   * What a customer is actually charged this month, and why.
   *
   * Four things can hold the figure down and they are not the same thing. A trial pays nothing and
   * then pays in full on a date. A discount takes a percentage off, sometimes until a date. An
   * expired plan earns nothing, because their CRM is read only. Anything else pays the list price,
   * which is the plan's unless this customer negotiated their own.
   *
   * All of it lives here rather than at the three places that ask, because those three used to
   * re-implement the expiry rule separately and a fourth caller would have re-implemented it again.
   */
  static effectivePrice(agreement: Agreement, now: Date): Charge {
    const listMinor = agreement.priceMonthlyMinorOverride ?? agreement.plan?.priceMonthlyMinor ?? 0;

    if (agreement.expiresAt !== null && agreement.expiresAt.getTime() <= now.getTime()) {
      return { listMinor, chargedMinor: 0, state: 'expired' };
    }
    if (agreement.trialEndsAt !== null && agreement.trialEndsAt.getTime() > now.getTime()) {
      return { listMinor, chargedMinor: 0, state: 'trial' };
    }
    const percent = agreement.discountPercent;
    const stillOff =
      percent !== null &&
      percent > 0 &&
      (agreement.discountUntil === null || agreement.discountUntil.getTime() > now.getTime());
    if (stillOff) {
      return {
        listMinor,
        chargedMinor: Math.round((listMinor * (100 - percent)) / 100),
        state: 'discounted',
      };
    }
    return { listMinor, chargedMinor: listMinor, state: 'full' };
  }

  async run(now = new Date()): Promise<RollupSummary> {
    const from = new Date(now.getTime() - 36 * 60 * 60 * 1000);
    const stackDays = await this.rollStacks(from, now);
    const fleet = await this.rollFleet(now);
    return { stackDays, fleetDay: fleet.day, mrrMinor: fleet.mrrMinor };
  }

  /**
   * One row per stack per day, rewritten in place while the day is still running. `connected` is
   * inferred from how many samples arrived rather than from connection events, because a stack that
   * reports in was, by definition, up.
   */
  private async rollStacks(from: Date, to: Date): Promise<number> {
    const rows = await this.db.$executeRaw(Prisma.sql`
      INSERT INTO stack_days (
        stack_id, customer_id, day, samples, connected_minutes,
        seats_max, seats_avg, storage_max_bytes, ready_failures, versions, backup_seen_at
      )
      SELECT
        s.stack_id,
        s.customer_id,
        (s.at AT TIME ZONE ${ROLLUP_TZ})::date AS day,
        count(*)::int,
        LEAST(count(*)::int * ${MINUTES_PER_SAMPLE}, 1440),
        max(s.seats_active)::int,
        round(avg(s.seats_active))::int,
        max(s.storage_bytes),
        count(*) FILTER (WHERE NOT s.ready_ok)::int,
        array_agg(DISTINCT s.version),
        max(s.last_backup_at)
      FROM stack_samples s
      WHERE s.at >= ${from} AND s.at < ${to}
      GROUP BY 1, 2, 3
      ON CONFLICT (stack_id, day) DO UPDATE SET
        samples = EXCLUDED.samples,
        connected_minutes = EXCLUDED.connected_minutes,
        seats_max = EXCLUDED.seats_max,
        seats_avg = EXCLUDED.seats_avg,
        storage_max_bytes = EXCLUDED.storage_max_bytes,
        ready_failures = EXCLUDED.ready_failures,
        versions = EXCLUDED.versions,
        backup_seen_at = EXCLUDED.backup_seen_at`);
    return rows;
  }

  /** One row for the whole fleet, today, as it stands now. */
  private async rollFleet(now: Date): Promise<{ day: string; mrrMinor: number }> {
    const day = dayKey(now);
    const [customers, entitlements, today] = await Promise.all([
      this.db.customer.findMany({ select: { id: true, status: true } }),
      this.db.customerEntitlement.findMany({
        include: { plan: { select: { priceMonthlyMinor: true, currency: true, limits: true } } },
      }),
      this.db.stackDay.findMany({
        where: { day: new Date(`${day}T00:00:00.000Z`) },
        select: { customerId: true, connectedMinutes: true, seatsMax: true, storageMaxBytes: true },
      }),
    ]);

    const active = new Set(customers.filter((c) => c.status === 'active').map((c) => c.id));
    let mrrMinor = 0;
    let seatsSold = 0;
    let currency = 'KES';
    for (const e of entitlements) {
      if (!active.has(e.customerId)) continue;
      // A snapshot of what was true today, including nothing at all for a trial or an expired plan.
      mrrMinor += RollupService.effectivePrice(e, now).chargedMinor;
      if (e.plan?.currency) currency = e.plan.currency;
      const limits = (e.limitOverrides ?? {}) as { seats?: number | null };
      const planLimits = (e.plan?.limits ?? {}) as { seats?: number | null };
      const seats = limits.seats === undefined ? (planLimits.seats ?? null) : limits.seats;
      if (typeof seats === 'number') seatsSold += seats;
    }

    // One customer can have more than one stack; the fleet figures are per customer.
    const perCustomer = new Map<string, { live: boolean; seats: number; storage: bigint }>();
    for (const row of today) {
      const current = perCustomer.get(row.customerId) ?? { live: false, seats: 0, storage: 0n };
      perCustomer.set(row.customerId, {
        live: current.live || row.connectedMinutes > 0,
        seats: Math.max(current.seats, row.seatsMax),
        storage: current.storage > row.storageMaxBytes ? current.storage : row.storageMaxBytes,
      });
    }
    let seatsUsed = 0;
    let storageBytes = 0n;
    let customersLive = 0;
    for (const value of perCustomer.values()) {
      seatsUsed += value.seats;
      storageBytes += value.storage;
      if (value.live) customersLive += 1;
    }

    await this.db.fleetDay.upsert({
      where: { day: new Date(`${day}T00:00:00.000Z`) },
      create: {
        day: new Date(`${day}T00:00:00.000Z`),
        customers: customers.length,
        customersLive,
        seatsUsed,
        seatsSold,
        storageBytes,
        mrrMinor,
        currency,
      },
      update: {
        customers: customers.length,
        customersLive,
        seatsUsed,
        seatsSold,
        storageBytes,
        mrrMinor,
        currency,
      },
    });
    return { day, mrrMinor };
  }

  /**
   * Raw samples last a month; the days they were folded into last much longer. The fleet rows are
   * one a day forever, which is a rounding error in a database this size.
   */
  async prune(now = new Date()): Promise<{ samples: number; days: number }> {
    const sampleCutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const dayCutoff = new Date(now.getTime() - 400 * 24 * 60 * 60 * 1000);
    const [samples, days] = await Promise.all([
      this.db.stackSample.deleteMany({ where: { at: { lt: sampleCutoff } } }),
      this.db.stackDay.deleteMany({ where: { day: { lt: dayCutoff } } }),
    ]);
    return { samples: samples.count, days: days.count };
  }
}

/** `yyyy-mm-dd` in the rollup zone. */
export function dayKey(at: Date, tz = ROLLUP_TZ): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}
