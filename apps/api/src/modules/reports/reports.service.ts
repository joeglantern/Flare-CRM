/**
 * Reporting aggregates (R-7.6). SQL via Prisma tagged templates only (docs/08 E4).
 * Scope: agents → own records, managers → team, admins → all (docs/07 §4 + report:view_* permissions).
 */
import type { VisibilityScope } from '@crm/shared';
import type { FastifyInstance } from 'fastify';
import { Prisma } from '../../generated/prisma/client.js';
import { NotFoundError } from '../../lib/errors.js';

export interface ReportRange {
  from: Date;
  to: Date;
  tz: string;
}

function callScopeSql(scope: VisibilityScope): Prisma.Sql {
  switch (scope.kind) {
    case 'all':
      return Prisma.sql`TRUE`;
    case 'team':
      return Prisma.sql`(c.user_id IN (SELECT id FROM users WHERE team_id = ${scope.teamId}::uuid) OR c.user_id IS NULL)`;
    case 'own':
      return Prisma.sql`c.user_id = ${scope.userId}::uuid`;
  }
}

function dealScopeSql(scope: VisibilityScope): Prisma.Sql {
  switch (scope.kind) {
    case 'all':
      return Prisma.sql`TRUE`;
    case 'team':
      return Prisma.sql`(d.owner_id IN (SELECT id FROM users WHERE team_id = ${scope.teamId}::uuid) OR d.owner_id IS NULL)`;
    case 'own':
      return Prisma.sql`d.owner_id = ${scope.userId}::uuid`;
  }
}

const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const round = (v: number, d = 1): number => Math.round(v * 10 ** d) / 10 ** d;

export class ReportsService {
  constructor(private readonly app: FastifyInstance) {}

  private get db() {
    return this.app.db;
  }

  async callsSummary(
    scope: VisibilityScope,
    range: ReportRange,
    filters: { userId?: string | undefined; teamId?: string | undefined },
  ) {
    const userFilter = filters.userId
      ? Prisma.sql`AND c.user_id = ${filters.userId}::uuid`
      : Prisma.empty;
    const teamFilter = filters.teamId
      ? Prisma.sql`AND c.user_id IN (SELECT id FROM users WHERE team_id = ${filters.teamId}::uuid)`
      : Prisma.empty;
    const cond = Prisma.sql`c.started_at >= ${range.from} AND c.started_at < ${range.to} AND ${callScopeSql(scope)} ${userFilter} ${teamFilter}`;
    const base = Prisma.sql`FROM calls c WHERE ${cond}`;

    const [totals] = await this.db.$queryRaw<
      {
        calls: bigint;
        inbound: bigint;
        outbound: bigint;
        internal: bigint;
        answered: bigint;
        missed: bigint;
        abandoned: bigint;
        busy: bigint;
        voicemail: bigint;
        failed: bigint;
        avg_talk: number | null;
        avg_ring: number | null;
        total_talk: bigint | null;
      }[]
    >(Prisma.sql`
      SELECT count(*) AS calls,
        count(*) FILTER (WHERE c.direction = 'inbound') AS inbound,
        count(*) FILTER (WHERE c.direction = 'outbound') AS outbound,
        count(*) FILTER (WHERE c.direction = 'internal') AS internal,
        count(*) FILTER (WHERE c.status = 'completed') AS answered,
        count(*) FILTER (WHERE c.status = 'missed') AS missed,
        count(*) FILTER (WHERE c.status = 'abandoned') AS abandoned,
        count(*) FILTER (WHERE c.status = 'busy') AS busy,
        count(*) FILTER (WHERE c.status = 'voicemail') AS voicemail,
        count(*) FILTER (WHERE c.status = 'failed') AS failed,
        avg(c.talk_duration_sec) FILTER (WHERE c.status = 'completed') AS avg_talk,
        avg(c.ring_duration_sec) FILTER (WHERE c.direction = 'inbound') AS avg_ring,
        sum(c.talk_duration_sec) AS total_talk
      ${base}`);

    const series = await this.db.$queryRaw<
      { day: Date; inbound: bigint; outbound: bigint; missed: bigint; answered: bigint }[]
    >(Prisma.sql`
      SELECT date_trunc('day', c.started_at AT TIME ZONE ${range.tz}) AS day,
        count(*) FILTER (WHERE c.direction = 'inbound') AS inbound,
        count(*) FILTER (WHERE c.direction = 'outbound') AS outbound,
        count(*) FILTER (WHERE c.status IN ('missed','abandoned')) AS missed,
        count(*) FILTER (WHERE c.status = 'completed') AS answered
      ${base}
      GROUP BY 1 ORDER BY 1`);

    const hours = await this.db.$queryRaw<
      { hour: number; inbound: bigint; outbound: bigint; missed: bigint; answered: bigint }[]
    >(Prisma.sql`
      SELECT extract(hour FROM c.started_at AT TIME ZONE ${range.tz})::int AS hour,
        count(*) FILTER (WHERE c.direction = 'inbound') AS inbound,
        count(*) FILTER (WHERE c.direction = 'outbound') AS outbound,
        count(*) FILTER (WHERE c.status IN ('missed','abandoned')) AS missed,
        count(*) FILTER (WHERE c.status = 'completed') AS answered
      ${base}
      GROUP BY 1 ORDER BY 1`);
    const byHourMap = new Map(hours.map((h) => [h.hour, h]));
    const byHour = Array.from({ length: 24 }, (_, hour) => {
      const h = byHourMap.get(hour);
      return {
        hour,
        inbound: num(h?.inbound ?? 0n),
        outbound: num(h?.outbound ?? 0n),
        missed: num(h?.missed ?? 0n),
        answered: num(h?.answered ?? 0n),
      };
    });

    const dispositions = await this.db.$queryRaw<
      { disposition_id: string | null; name: string | null; count: bigint }[]
    >(Prisma.sql`
      SELECT c.disposition_id, d.name, count(*) AS count
      FROM calls c LEFT JOIN call_dispositions d ON d.id = c.disposition_id
      WHERE ${cond}
      GROUP BY 1, 2 ORDER BY 3 DESC`);
    const byDisposition = dispositions.map((r) => ({
      dispositionId: r.disposition_id,
      name: r.name ?? 'Not set',
      count: num(r.count),
    }));

    const t = totals ?? {
      calls: 0n,
      inbound: 0n,
      outbound: 0n,
      internal: 0n,
      answered: 0n,
      missed: 0n,
      abandoned: 0n,
      busy: 0n,
      voicemail: 0n,
      failed: 0n,
      avg_talk: null,
      avg_ring: null,
      total_talk: null,
    };
    const inbound = num(t.inbound);
    const answeredInbound =
      inbound - num(t.missed) - num(t.abandoned) - num(t.voicemail) - num(t.busy);
    return {
      from: range.from.toISOString(),
      to: range.to.toISOString(),
      totals: {
        calls: num(t.calls),
        inbound,
        outbound: num(t.outbound),
        internal: num(t.internal),
        answered: num(t.answered),
        missed: num(t.missed),
        abandoned: num(t.abandoned),
        busy: num(t.busy),
        voicemail: num(t.voicemail),
        failed: num(t.failed),
      },
      answerRate: inbound > 0 ? round(Math.max(0, answeredInbound) / inbound, 3) : 0,
      avgTalkSec: round(num(t.avg_talk)),
      avgRingSec: round(num(t.avg_ring)),
      totalTalkSec: num(t.total_talk),
      byHour,
      byDisposition,
      series: series.map((s) => ({
        date: s.day.toISOString().slice(0, 10),
        inbound: num(s.inbound),
        outbound: num(s.outbound),
        missed: num(s.missed),
        answered: num(s.answered),
      })),
    };
  }

  async agentPerformance(
    scope: VisibilityScope,
    range: ReportRange,
    filters: { teamId?: string | undefined },
  ) {
    const teamFilter = filters.teamId
      ? Prisma.sql`AND u.team_id = ${filters.teamId}::uuid`
      : Prisma.empty;
    const rows = await this.db.$queryRaw<
      {
        user_id: string;
        name: string;
        extension: string | null;
        total: bigint;
        inbound: bigint;
        outbound: bigint;
        answered: bigint;
        missed: bigint;
        total_talk: bigint | null;
        avg_talk: number | null;
        avg_ring: number | null;
      }[]
    >(Prisma.sql`
      SELECT u.id AS user_id, u.name, u.extension,
        count(c.id) AS total,
        count(c.id) FILTER (WHERE c.direction = 'inbound') AS inbound,
        count(c.id) FILTER (WHERE c.direction = 'outbound') AS outbound,
        count(c.id) FILTER (WHERE c.status = 'completed') AS answered,
        count(c.id) FILTER (WHERE c.status IN ('missed','abandoned')) AS missed,
        sum(c.talk_duration_sec) AS total_talk,
        avg(c.talk_duration_sec) FILTER (WHERE c.status = 'completed') AS avg_talk,
        avg(c.ring_duration_sec) FILTER (WHERE c.direction = 'inbound') AS avg_ring
      FROM users u
      LEFT JOIN calls c ON c.user_id = u.id AND c.started_at >= ${range.from} AND c.started_at < ${range.to}
      WHERE u.is_active = TRUE AND u.extension IS NOT NULL ${teamFilter}
        AND ${scope.kind === 'all' ? Prisma.sql`TRUE` : scope.kind === 'team' ? Prisma.sql`u.team_id = ${scope.teamId}::uuid` : Prisma.sql`u.id = ${scope.userId}::uuid`}
      GROUP BY u.id ORDER BY total DESC, u.name`);
    return rows.map((r) => ({
      userId: r.user_id,
      name: r.name,
      extension: r.extension,
      total: num(r.total),
      inbound: num(r.inbound),
      outbound: num(r.outbound),
      answered: num(r.answered),
      missed: num(r.missed),
      totalTalkSec: num(r.total_talk),
      avgTalkSec: round(num(r.avg_talk)),
      avgRingSec: round(num(r.avg_ring)),
    }));
  }

  private async pipelineFor(id: string | undefined) {
    const pipeline = id
      ? await this.db.pipeline.findUnique({
          where: { id },
          include: { stages: { orderBy: { sortOrder: 'asc' } } },
        })
      : await this.db.pipeline.findFirst({
          where: { isDefault: true },
          include: { stages: { orderBy: { sortOrder: 'asc' } } },
        });
    if (!pipeline) throw new NotFoundError('Pipeline');
    return pipeline;
  }

  async pipelineSummary(
    scope: VisibilityScope,
    range: ReportRange,
    filters: { pipelineId?: string | undefined; ownerId?: string | undefined },
  ) {
    const pipeline = await this.pipelineFor(filters.pipelineId);
    const ownerFilter = filters.ownerId
      ? Prisma.sql`AND d.owner_id = ${filters.ownerId}::uuid`
      : Prisma.empty;
    const open = await this.db.$queryRaw<
      { stage_id: string; cnt: bigint; value: number | null; weighted: number | null }[]
    >(Prisma.sql`
      SELECT d.stage_id, count(*) AS cnt, sum(d.value) AS value, sum(d.value * d.probability / 100.0) AS weighted
      FROM deals d WHERE d.pipeline_id = ${pipeline.id}::uuid AND d.status = 'open' AND d.deleted_at IS NULL AND ${dealScopeSql(scope)} ${ownerFilter}
      GROUP BY d.stage_id`);
    const closed = await this.db.$queryRaw<
      { status: string; cnt: bigint; value: number | null }[]
    >(Prisma.sql`
      SELECT d.status, count(*) AS cnt, sum(d.value) AS value
      FROM deals d WHERE d.pipeline_id = ${pipeline.id}::uuid AND d.status IN ('won','lost') AND d.deleted_at IS NULL AND ${dealScopeSql(scope)} ${ownerFilter}
        AND coalesce(d.won_at, d.lost_at) >= ${range.from} AND coalesce(d.won_at, d.lost_at) < ${range.to}
      GROUP BY d.status`);
    const byStage = new Map(open.map((o) => [o.stage_id, o]));
    const won = closed.find((c) => c.status === 'won');
    const lost = closed.find((c) => c.status === 'lost');
    const wonCount = num(won?.cnt);
    const lostCount = num(lost?.cnt);
    return {
      pipelineId: pipeline.id,
      stages: pipeline.stages
        .filter((s) => s.type === 'open')
        .map((s) => ({
          stageId: s.id,
          name: s.name,
          type: s.type,
          openCount: num(byStage.get(s.id)?.cnt),
          openValue: round(num(byStage.get(s.id)?.value), 2),
          weightedValue: round(num(byStage.get(s.id)?.weighted), 2),
        })),
      won: { count: wonCount, value: round(num(won?.value), 2) },
      lost: { count: lostCount, value: round(num(lost?.value), 2) },
      winRate: wonCount + lostCount > 0 ? round(wonCount / (wonCount + lostCount), 3) : 0,
      currency: await this.app.settings.get('currency'),
    };
  }

  async pipelineConversion(
    scope: VisibilityScope,
    range: ReportRange,
    filters: { pipelineId?: string | undefined; ownerId?: string | undefined },
  ) {
    const pipeline = await this.pipelineFor(filters.pipelineId);
    const ownerFilter = filters.ownerId
      ? Prisma.sql`AND d.owner_id = ${filters.ownerId}::uuid`
      : Prisma.empty;
    const cohort = Prisma.sql`FROM deals d WHERE d.pipeline_id = ${pipeline.id}::uuid AND d.created_at >= ${range.from} AND d.created_at < ${range.to} AND d.deleted_at IS NULL AND ${dealScopeSql(scope)} ${ownerFilter}`;
    const [base] = await this.db.$queryRaw<
      { created: bigint; won: bigint; lost: bigint; avg_cycle: number | null }[]
    >(Prisma.sql`
      SELECT count(*) AS created, count(*) FILTER (WHERE d.status = 'won') AS won, count(*) FILTER (WHERE d.status = 'lost') AS lost,
        avg(EXTRACT(EPOCH FROM (d.won_at - d.created_at)) / 86400.0) FILTER (WHERE d.status = 'won') AS avg_cycle
      ${cohort}`);
    const reached = await this.db.$queryRaw<{ stage_id: string; reached: bigint }[]>(Prisma.sql`
      SELECT h.to_stage_id AS stage_id, count(DISTINCT h.deal_id) AS reached
      FROM deal_stage_history h WHERE h.deal_id IN (SELECT d.id ${cohort})
      GROUP BY h.to_stage_id`);
    const byStage = new Map(reached.map((r) => [r.stage_id, num(r.reached)]));
    const created = num(base?.created);
    const won = num(base?.won);
    const lost = num(base?.lost);
    return {
      pipelineId: pipeline.id,
      created,
      stages: pipeline.stages.map((s) => ({
        stageId: s.id,
        name: s.name,
        reached: byStage.get(s.id) ?? 0,
        pct: created > 0 ? round((byStage.get(s.id) ?? 0) / created, 3) : 0,
      })),
      won,
      lost,
      winRate: won + lost > 0 ? round(won / (won + lost), 3) : 0,
      avgCycleDays:
        base?.avg_cycle === null || base?.avg_cycle === undefined
          ? null
          : round(num(base.avg_cycle)),
    };
  }

  async forecast(
    scope: VisibilityScope,
    filters: { pipelineId?: string | undefined; ownerId?: string | undefined; months: number },
  ) {
    const pipeline = await this.pipelineFor(filters.pipelineId);
    const ownerFilter = filters.ownerId
      ? Prisma.sql`AND d.owner_id = ${filters.ownerId}::uuid`
      : Prisma.empty;
    const rows = await this.db.$queryRaw<
      { month: string | null; cnt: bigint; value: number | null; weighted: number | null }[]
    >(Prisma.sql`
      SELECT to_char(d.expected_close_date, 'YYYY-MM') AS month, count(*) AS cnt, sum(d.value) AS value, sum(d.value * d.probability / 100.0) AS weighted
      FROM deals d WHERE d.pipeline_id = ${pipeline.id}::uuid AND d.status = 'open' AND d.deleted_at IS NULL AND ${dealScopeSql(scope)} ${ownerFilter}
      GROUP BY 1 ORDER BY 1`);
    const now = new Date();
    const months: string[] = [];
    for (let i = 0; i < filters.months; i++) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + i, 1));
      months.push(d.toISOString().slice(0, 7));
    }
    const byMonth = new Map(rows.flatMap((r) => (r.month === null ? [] : [[r.month, r] as const])));
    const unscheduled = rows.find((r) => r.month === null);
    return {
      pipelineId: pipeline.id,
      currency: await this.app.settings.get('currency'),
      months: months.map((m) => ({
        month: m,
        count: num(byMonth.get(m)?.cnt),
        value: round(num(byMonth.get(m)?.value), 2),
        weightedValue: round(num(byMonth.get(m)?.weighted), 2),
      })),
      unscheduled: { count: num(unscheduled?.cnt), value: round(num(unscheduled?.value), 2) },
    };
  }
}
