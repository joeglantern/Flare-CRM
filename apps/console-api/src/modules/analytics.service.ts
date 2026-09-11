/**
 * What the console knows about its fleet, shaped for drawing (docs/21 §8).
 *
 * Every series that leaves here is dense: one point per day for the whole range, zeros included,
 * so the client never has to decide what a missing day meant. The server does the arithmetic
 * because the server is the only side that can do it once for everybody.
 *
 * Money is minor units throughout. Bytes are numbers rather than bigints by the time they leave,
 * because JSON has no bigint and a petabyte still fits in a double.
 */
import {
  ALERTS,
  type AlertDto,
  type AlertKind,
  type AlertLevel,
  type ConsoleOverviewDto,
  type CustomerAnalyticsDto,
  type RevenueAnalyticsDto,
  type SeriesPoint,
} from '@crm/shared';
import { Prisma } from '../generated/prisma/client.js';
import type { Db } from '../plugins/prisma.js';
import { dayKey, ROLLUP_TZ, RollupService } from './rollup.service.js';

const DAY_MS = 86_400_000;

export class AnalyticsService {
  constructor(private readonly db: Db) {}

  async overview(days: number, now = new Date()): Promise<ConsoleOverviewDto> {
    const from = startOfDay(new Date(now.getTime() - (days - 1) * DAY_MS));
    const [fleetDays, customers, entitlements, stacks, alerts, delivery] = await Promise.all([
      this.db.fleetDay.findMany({ where: { day: { gte: from } }, orderBy: { day: 'asc' } }),
      this.db.customer.findMany({ select: { id: true, name: true, status: true } }),
      this.db.customerEntitlement.findMany({ include: { plan: true } }),
      this.db.stack.findMany({
        where: { revokedAt: null },
        select: { id: true, customerId: true, connected: true, version: true, usage: true },
      }),
      this.openAlerts(),
      this.delivery(),
    ]);

    const active = customers.filter((c) => c.status === 'active');
    const byCustomer = new Map(customers.map((c) => [c.id, c]));

    let mrrMinor = 0;
    let seatsSold = 0;
    let seatsUnlimited = 0;
    let storageSold = 0;
    let storageUnlimited = 0;
    let currency = 'KES';
    const planMix = new Map<
      string,
      { planId: string | null; name: string; customers: number; mrrMinor: number }
    >();

    for (const e of entitlements) {
      const customer = byCustomer.get(e.customerId);
      if (customer?.status !== 'active') continue;
      const expired = e.expiresAt !== null && e.expiresAt.getTime() <= now.getTime();
      const price = expired ? 0 : RollupService.effectivePrice(e.plan, e.priceMonthlyMinorOverride);
      mrrMinor += price;
      if (e.plan?.currency) currency = e.plan.currency;

      const limits = mergeLimits(e.plan?.limits, e.limitOverrides);
      if (limits.seats === null) seatsUnlimited += 1;
      else seatsSold += limits.seats;
      if (limits.storage_gb === null) storageUnlimited += 1;
      else storageSold += limits.storage_gb * 1024 ** 3;

      const key = e.planId ?? 'none';
      const current = planMix.get(key) ?? {
        planId: e.planId,
        name: e.plan?.name ?? 'No plan',
        customers: 0,
        mrrMinor: 0,
      };
      planMix.set(key, {
        ...current,
        customers: current.customers + 1,
        mrrMinor: current.mrrMinor + price,
      });
    }

    let seatsUsed = 0;
    let storageUsed = 0;
    const liveCustomers = new Set<string>();
    const versions = new Map<string, number>();
    for (const stack of stacks) {
      const usage = (stack.usage ?? null) as { seatsActive?: number; storageBytes?: number } | null;
      seatsUsed += usage?.seatsActive ?? 0;
      storageUsed += usage?.storageBytes ?? 0;
      if (stack.connected) liveCustomers.add(stack.customerId);
      if (stack.version !== null)
        versions.set(stack.version, (versions.get(stack.version) ?? 0) + 1);
    }

    const expiring = entitlements
      .filter((e) => e.expiresAt !== null && byCustomer.get(e.customerId)?.status === 'active')
      .map((e) => {
        // The filter above proves it, but the compiler wants it said once.
        const expiresAt = e.expiresAt ?? new Date();
        return {
          customerId: e.customerId,
          name: byCustomer.get(e.customerId)?.name ?? 'Unknown',
          expiresAt: expiresAt.toISOString(),
          days: Math.ceil((expiresAt.getTime() - now.getTime()) / DAY_MS),
          mrrMinor: RollupService.effectivePrice(e.plan, e.priceMonthlyMinorOverride),
        };
      })
      .filter((e) => e.days <= 90)
      .sort((a, b) => a.days - b.days);

    const dayList = denseDays(from, now);
    const pick = (
      key: 'customers' | 'customersLive' | 'seatsUsed' | 'seatsSold' | 'storageBytes' | 'mrrMinor',
    ): SeriesPoint[] =>
      dayList.map((t) => {
        const row = fleetDays.find((f) => dayKey(f.day, 'UTC') === t);
        return { t, v: row === undefined ? 0 : Number(row[key]) };
      });

    return {
      generatedAt: now.toISOString(),
      rangeDays: days,
      hasData: fleetDays.length > 0,
      now: {
        customers: customers.length,
        customersActive: active.length,
        customersLive: liveCustomers.size,
        stacks: stacks.length,
        seats: { used: seatsUsed, sold: seatsSold, unlimited: seatsUnlimited },
        storage: { usedBytes: storageUsed, soldBytes: storageSold, unlimited: storageUnlimited },
        currency,
        mrrMinor,
        arpuMinor: active.length === 0 ? 0 : Math.round(mrrMinor / active.length),
        openAlerts: alerts.length,
      },
      series: {
        customers: pick('customers'),
        live: pick('customersLive'),
        seatsUsed: pick('seatsUsed'),
        seatsSold: pick('seatsSold'),
        storageBytes: pick('storageBytes'),
        mrrMinor: pick('mrrMinor'),
      },
      planMix: [...planMix.values()].sort((a, b) => b.customers - a.customers),
      versions: [...versions.entries()]
        .map(([version, count]) => ({ version, stacks: count }))
        .sort((a, b) => b.stacks - a.stacks),
      expiring,
      delivery,
      alerts,
    };
  }

  async customer(
    customerId: string,
    days: number,
    now = new Date(),
  ): Promise<CustomerAnalyticsDto> {
    const from = startOfDay(new Date(now.getTime() - (days - 1) * DAY_MS));
    const [rows, entitlement, stacks, issues, alerts, announcements] = await Promise.all([
      this.db.stackDay.findMany({
        where: { customerId, day: { gte: from } },
        orderBy: { day: 'asc' },
      }),
      this.db.customerEntitlement.findUnique({ where: { customerId }, include: { plan: true } }),
      this.db.stack.findMany({
        where: { customerId, revokedAt: null },
        select: { id: true, lastBackupAt: true, createdAt: true },
      }),
      this.db.entitlementIssue.findMany({
        where: { customerId },
        orderBy: { issuedAt: 'desc' },
        take: 20,
      }),
      this.db.consoleAlert.findMany({
        where: { customerId },
        orderBy: { openedAt: 'desc' },
        take: 20,
      }),
      this.db.announcement.findMany({
        where: { customerId },
        orderBy: { sentAt: 'desc' },
        take: 10,
      }),
    ]);

    const limits = mergeLimits(entitlement?.plan?.limits, entitlement?.limitOverrides);
    const dayList = denseDays(from, now);
    const byDay = new Map(rows.map((r) => [dayKey(r.day, 'UTC'), r]));

    const seatsSeries = dayList.map((t) => ({ t, v: byDay.get(t)?.seatsMax ?? 0 }));
    const storageSeries = dayList.map((t) => ({
      t,
      v: Number(byDay.get(t)?.storageMaxBytes ?? 0n),
    }));
    const uptimeDays = dayList.map((t) => ({
      t,
      connectedMinutes: byDay.get(t)?.connectedMinutes ?? 0,
      readyFailures: byDay.get(t)?.readyFailures ?? 0,
    }));
    const measured = uptimeDays.filter((d) => d.connectedMinutes > 0);
    const percent =
      measured.length === 0
        ? null
        : Math.round(
            (measured.reduce((sum, d) => sum + Math.min(d.connectedMinutes, 1440), 0) /
              (uptimeDays.length * 1440)) *
              1000,
          ) / 10;

    const lastBackupAt = stacks
      .map((s) => s.lastBackupAt)
      .filter((d): d is Date => d !== null)
      .sort((a, b) => b.getTime() - a.getTime())[0];

    const versions: { from: string; version: string }[] = [];
    for (const t of dayList) {
      const seen = byDay.get(t)?.versions ?? [];
      for (const version of seen) {
        if (versions.at(-1)?.version !== version) versions.push({ from: t, version });
      }
    }

    const events: CustomerAnalyticsDto['events'] = [
      ...issues.map((i) => ({
        at: i.issuedAt.toISOString(),
        kind: 'issue' as const,
        label: `Entitlements ${i.status}`,
        detail: i.rejectReason,
      })),
      ...alerts.map((a) => ({
        at: a.openedAt.toISOString(),
        kind: 'alert' as const,
        label: ALERTS[a.kind as AlertKind].label,
        detail: (a.context as { summary?: string }).summary ?? null,
      })),
      ...announcements.map((a) => ({
        at: a.sentAt.toISOString(),
        kind: 'announce' as const,
        label: 'Announcement',
        detail: a.message,
      })),
      ...stacks.map((s) => ({
        at: s.createdAt.toISOString(),
        kind: 'stack' as const,
        label: 'Stack registered',
        detail: s.id,
      })),
    ]
      .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
      .slice(0, 40);

    return {
      customerId,
      rangeDays: days,
      hasData: rows.length > 0,
      seats: {
        series: seatsSeries,
        cap: limits.seats,
        latest: rows.at(-1)?.seatsMax ?? null,
      },
      storage: {
        series: storageSeries,
        capBytes: limits.storage_gb === null ? null : limits.storage_gb * 1024 ** 3,
        latestBytes:
          rows.length === 0 ? null : Number(rows[rows.length - 1]?.storageMaxBytes ?? 0n),
        projection: projectFull(storageSeries, limits.storage_gb),
      },
      uptime: { percent, days: uptimeDays },
      backups: {
        lastAt: lastBackupAt?.toISOString() ?? null,
        ageHours:
          lastBackupAt === undefined
            ? null
            : Math.round(((now.getTime() - lastBackupAt.getTime()) / 3_600_000) * 10) / 10,
        days: dayList.map((t) => ({ t, seen: byDay.get(t)?.backupSeenAt != null })),
      },
      versions,
      events,
    };
  }

  async revenue(months = 12, now = new Date()): Promise<RevenueAnalyticsDto> {
    const from = startOfDay(new Date(now.getTime() - months * 31 * DAY_MS));
    const [fleetDays, entitlements, customers] = await Promise.all([
      this.db.fleetDay.findMany({ where: { day: { gte: from } }, orderBy: { day: 'asc' } }),
      this.db.customerEntitlement.findMany({ include: { plan: true } }),
      this.db.customer.findMany({ select: { id: true, status: true } }),
    ]);

    const active = new Set(customers.filter((c) => c.status === 'active').map((c) => c.id));
    let mrrMinor = 0;
    let paying = 0;
    let currency = 'KES';
    let atRiskMinor = 0;
    let atRiskCustomers = 0;
    const byPlan = new Map<
      string,
      { planId: string | null; name: string; customers: number; mrrMinor: number }
    >();

    for (const e of entitlements) {
      if (!active.has(e.customerId)) continue;
      const expired = e.expiresAt !== null && e.expiresAt.getTime() <= now.getTime();
      const price = expired ? 0 : RollupService.effectivePrice(e.plan, e.priceMonthlyMinorOverride);
      mrrMinor += price;
      if (price > 0) paying += 1;
      if (e.plan?.currency) currency = e.plan.currency;
      if (
        e.expiresAt !== null &&
        !expired &&
        e.expiresAt.getTime() - now.getTime() <= 30 * DAY_MS
      ) {
        atRiskMinor += price;
        atRiskCustomers += 1;
      }
      const key = e.planId ?? 'none';
      const current = byPlan.get(key) ?? {
        planId: e.planId,
        name: e.plan?.name ?? 'No plan',
        customers: 0,
        mrrMinor: 0,
      };
      byPlan.set(key, {
        ...current,
        customers: current.customers + 1,
        mrrMinor: current.mrrMinor + price,
      });
    }

    // One point a month: the last day of each month we have a row for.
    const lastOfMonth = new Map<string, number>();
    for (const row of fleetDays) lastOfMonth.set(dayKey(row.day, 'UTC').slice(0, 7), row.mrrMinor);

    return {
      currency,
      mrrMinor,
      arpuMinor: active.size === 0 ? 0 : Math.round(mrrMinor / active.size),
      payingCustomers: paying,
      months: [...lastOfMonth.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([month, v]) => ({ t: `${month}-01`, v })),
      byPlan: [...byPlan.values()].sort((a, b) => b.mrrMinor - a.mrrMinor),
      atRisk: { minor: atRiskMinor, customers: atRiskCustomers, withinDays: 30 },
    };
  }

  async openAlerts(): Promise<AlertDto[]> {
    const rows = await this.db.consoleAlert.findMany({
      where: { resolvedAt: null },
      orderBy: [{ level: 'asc' }, { openedAt: 'desc' }],
      include: { customer: { select: { name: true } } },
    });
    return rows.map((a) => ({
      id: a.id,
      kind: a.kind as AlertKind,
      level: a.level as AlertLevel,
      customerId: a.customerId,
      customerName: a.customer.name,
      stackId: a.stackId,
      openedAt: a.openedAt.toISOString(),
      resolvedAt: a.resolvedAt?.toISOString() ?? null,
      context: (a.context ?? {}) as Record<string, unknown>,
    }));
  }

  /** How long a stack takes to apply what it is sent, and what is still outstanding. */
  private async delivery(): Promise<ConsoleOverviewDto['delivery']> {
    const [median, pending, rejected] = await Promise.all([
      this.db.$queryRaw<{ seconds: number | null }[]>(Prisma.sql`
        SELECT percentile_cont(0.5) WITHIN GROUP (
          ORDER BY EXTRACT(EPOCH FROM (acked_at - issued_at))
        )::float AS seconds
        FROM entitlement_issues
        WHERE acked_at IS NOT NULL AND issued_at > now() - interval '90 days'`),
      this.db.entitlementIssue.count({ where: { status: { in: ['pending', 'delivered'] } } }),
      this.db.entitlementIssue.count({ where: { status: 'rejected' } }),
    ]);
    return {
      medianAckSeconds: median[0]?.seconds ?? null,
      pending,
      rejected,
    };
  }
}

function mergeLimits(
  planLimits: unknown,
  overrides: unknown,
): { seats: number | null; storage_gb: number | null } {
  const merged = {
    ...((planLimits ?? {}) as Record<string, number | null>),
    ...((overrides ?? {}) as Record<string, number | null>),
  };
  const seats = typeof merged.seats === 'number' ? merged.seats : null;
  const storage = typeof merged.storage_gb === 'number' ? merged.storage_gb : null;
  return { seats, storage_gb: storage };
}

function startOfDay(at: Date): Date {
  return new Date(`${dayKey(at, ROLLUP_TZ)}T00:00:00.000Z`);
}

/**
 * Every day in the range, so a chart never has to guess what a gap meant.
 *
 * Both ends are days, not instants. `startOfDay` names a day in Nairobi and then stands it at
 * midnight UTC, so comparing the walk against the raw `to` dropped the last day for the three hours
 * each night when Nairobi is already on tomorrow's date and UTC is not: a fortnight came back
 * thirteen days long between midnight and three in the morning, and correct the rest of the day.
 */
function denseDays(from: Date, to: Date): string[] {
  const out: string[] = [];
  const last = startOfDay(to).getTime();
  for (let t = from.getTime(); t <= last; t += DAY_MS) {
    out.push(dayKey(new Date(t), 'UTC'));
  }
  return out;
}

/**
 * When storage will reach the cap, from a straight line through the last fortnight. Offered only
 * when it is growing and there is a cap to reach: a projection that says "never" is noise, and one
 * drawn from three days of data is a guess dressed as a fact.
 */
function projectFull(
  series: SeriesPoint[],
  capGb: number | null,
): { fullOn: string; perDayBytes: number } | null {
  if (capGb === null) return null;
  const recent = series.slice(-14).filter((p) => p.v > 0);
  if (recent.length < 7) return null;
  const first = recent[0];
  const last = recent[recent.length - 1];
  if (first === undefined || last === undefined) return null;
  const spanDays = (Date.parse(last.t) - Date.parse(first.t)) / DAY_MS;
  if (spanDays <= 0) return null;
  const perDayBytes = (last.v - first.v) / spanDays;
  if (perDayBytes <= 0) return null;
  const capBytes = capGb * 1024 ** 3;
  const remaining = capBytes - last.v;
  if (remaining <= 0) return { fullOn: last.t, perDayBytes };
  const daysLeft = Math.ceil(remaining / perDayBytes);
  if (daysLeft > 365 * 2) return null;
  return {
    fullOn: dayKey(new Date(Date.parse(last.t) + daysLeft * DAY_MS), 'UTC'),
    perDayBytes,
  };
}
