/**
 * Attendance and presence reports. Everything is worked out from `agent_presence_events` at read
 * time, so a better rule for an unclosed session also corrects the days already recorded.
 */
import type { AttendanceDayDto, PresenceChangeDto, VisibilityScope } from '@crm/shared';
import type { FastifyInstance } from 'fastify';
import { Prisma } from '../../generated/prisma/client.js';
import { BadRequestError } from '../../lib/errors.js';
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

export interface AttendanceFilters {
  from?: string | undefined;
  to?: string | undefined;
  userId?: string | undefined;
  teamId?: string | undefined;
}

const MAX_RANGE_DAYS = 92;
const DAY_MS = 24 * 60 * 60 * 1000;
const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));

interface AgentRow {
  id: string;
  name: string;
  extension: string | null;
  lastSeenAt: Date | null;
}

export class AttendanceService {
  constructor(private readonly app: FastifyInstance) {}

  private get db() {
    return this.app.db;
  }

  /** The filters narrow the caller's scope and can never widen it. */
  private agentsWhere(scope: VisibilityScope, filters: AttendanceFilters): Prisma.UserWhereInput {
    const within: Prisma.UserWhereInput =
      scope.kind === 'all'
        ? {}
        : scope.kind === 'team'
          ? { teamId: scope.teamId }
          : { id: scope.userId };
    return {
      AND: [
        within,
        ...(filters.userId ? [{ id: filters.userId }] : []),
        ...(filters.teamId ? [{ teamId: filters.teamId }] : []),
      ],
    };
  }

  private rangeOf(filters: AttendanceFilters): { from: Date; to: Date } {
    const to = filters.to ? new Date(filters.to) : new Date();
    const from = filters.from ? new Date(filters.from) : new Date(to.getTime() - 30 * DAY_MS);
    if (from >= to) throw new BadRequestError('The start of the range must be before its end');
    if (to.getTime() - from.getTime() > (MAX_RANGE_DAYS + 1) * DAY_MS) {
      throw new BadRequestError(`Choose a range of ${String(MAX_RANGE_DAYS)} days or less`);
    }
    return { from, to };
  }

  private async agents(scope: VisibilityScope, filters: AttendanceFilters): Promise<AgentRow[]> {
    return this.db.user.findMany({
      where: this.agentsWhere(scope, filters),
      select: { id: true, name: true, extension: true, lastSeenAt: true },
      orderBy: { name: 'asc' },
    });
  }

  /**
   * Each agent's events from the start of the range onward, led by the last one before it, which is
   * what says whether they were already signed in. There is deliberately no upper bound: whether an
   * interval open at the end of a past range ever closed is decided by what came after it.
   */
  private async eventsByAgent(
    agentIds: string[],
    channel: 'crm' | 'phone',
    from: Date,
  ): Promise<Map<string, PresenceEventRow[]>> {
    const byAgent = new Map<string, PresenceEventRow[]>();
    if (agentIds.length === 0) return byAgent;
    const before = await this.db.$queryRaw<(PresenceEventRow & { user_id: string })[]>(Prisma.sql`
      SELECT DISTINCT ON (user_id) user_id, channel, state, reason, inferred, at
      FROM agent_presence_events
      WHERE channel = ${channel} AND at < ${from} AND user_id = ANY(${agentIds}::uuid[])
      ORDER BY user_id, at DESC`);
    for (const e of before) byAgent.set(e.user_id, [e]);
    const rows = await this.db.agentPresenceEvent.findMany({
      where: { channel, at: { gte: from }, userId: { in: agentIds } },
      orderBy: { at: 'asc' },
      select: { userId: true, channel: true, state: true, reason: true, inferred: true, at: true },
    });
    for (const e of rows) {
      const list = byAgent.get(e.userId);
      if (list) list.push(e);
      else byAgent.set(e.userId, [e]);
    }
    return byAgent;
  }

  async listAgents(scope: VisibilityScope) {
    const rows = await this.db.user.findMany({
      where: { AND: [this.agentsWhere(scope, {}), { isActive: true }] },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
    return rows;
  }

  async attendance(scope: VisibilityScope, filters: AttendanceFilters) {
    const { from, to } = this.rangeOf(filters);
    const timeZone = await this.app.settings.get('timezone');
    const now = new Date();
    const firstDay = dayKey(from, timeZone);
    // The range's end is exclusive: a range ending exactly at midnight does not include that day.
    const lastDay = dayKey(new Date(to.getTime() - 1), timeZone);

    const agents = await this.agents(scope, filters);
    const ids = agents.map((a) => a.id);
    const events = await this.eventsByAgent(ids, 'crm', from);

    const calls =
      ids.length === 0
        ? []
        : await this.db.$queryRaw<
            {
              user_id: string;
              day: string;
              total: bigint;
              inbound: bigint;
              outbound: bigint;
              answered: bigint;
              missed: bigint;
              talk: bigint | null;
              first_call: Date | null;
            }[]
          >(Prisma.sql`
            SELECT c.user_id,
              to_char(c.started_at AT TIME ZONE ${timeZone}, 'YYYY-MM-DD') AS day,
              count(*) AS total,
              count(*) FILTER (WHERE c.direction = 'inbound') AS inbound,
              count(*) FILTER (WHERE c.direction = 'outbound') AS outbound,
              count(*) FILTER (WHERE c.status = 'completed') AS answered,
              count(*) FILTER (WHERE c.status IN ('missed','abandoned')) AS missed,
              sum(c.talk_duration_sec) AS talk,
              min(COALESCE(c.answered_at, c.started_at)) FILTER (WHERE c.status = 'completed') AS first_call
            FROM calls c
            WHERE c.started_at >= ${from} AND c.started_at < ${to}
              AND c.user_id = ANY(${ids}::uuid[])
            GROUP BY 1, 2`);
    const callsOf = new Map(calls.map((c) => [`${c.user_id}|${c.day}`, c]));

    const days: AttendanceDayDto[] = [];
    for (const agent of agents) {
      const transitions = crmTransitions(events.get(agent.id) ?? [], now, agent.lastSeenAt);
      const intervals = signedInIntervals(transitions, now);
      const signedIn = attendanceDays(intervals, timeZone, firstDay, lastDay, now);
      const dates = new Set(signedIn.keys());
      for (const c of calls) if (c.user_id === agent.id) dates.add(c.day);

      for (const date of dates) {
        const d = signedIn.get(date);
        const c = callsOf.get(`${agent.id}|${date}`);
        days.push({
          date,
          dayStart: dayStartInstant(date, timeZone).toISOString(),
          dayEnd: dayEndInstant(date, timeZone).toISOString(),
          userId: agent.id,
          name: agent.name,
          extension: agent.extension,
          firstLoginAt: d?.firstLoginAt?.toISOString() ?? null,
          firstLoginInferred: d?.firstLoginInferred ?? false,
          signedInBeforeDay: d?.signedInBeforeDay ?? false,
          lastLogoutAt: d?.lastLogoutAt?.toISOString() ?? null,
          lastLogoutInferred: d?.lastLogoutInferred ?? false,
          lastLogoutReason: d?.lastLogoutReason ?? null,
          stillSignedIn: d?.stillSignedIn ?? false,
          continuedNextDay: d?.continuedNextDay ?? false,
          firstCallAt: c?.first_call?.toISOString() ?? null,
          calls: {
            total: num(c?.total),
            inbound: num(c?.inbound),
            outbound: num(c?.outbound),
            answered: num(c?.answered),
            missed: num(c?.missed),
            talkSec: num(c?.talk),
          },
        });
      }
    }
    days.sort((a, b) => b.date.localeCompare(a.date) || a.name.localeCompare(b.name));

    const since = await this.db.agentPresenceEvent.aggregate({ _min: { at: true } });
    return {
      timeZone,
      days,
      recordingSince: since._min.at?.toISOString() ?? null,
    };
  }

  /** Newest first. Worked out whole, then paged, because each row depends on its neighbours. */
  async presence(
    scope: VisibilityScope,
    filters: AttendanceFilters & { channel?: 'crm' | 'phone' | undefined },
  ): Promise<PresenceChangeDto[]> {
    const { from, to } = this.rangeOf(filters);
    const now = new Date();
    const agents = await this.agents(scope, filters);
    const ids = agents.map((a) => a.id);
    const crm =
      filters.channel === 'phone'
        ? new Map<string, PresenceEventRow[]>()
        : await this.eventsByAgent(ids, 'crm', from);
    const phone =
      filters.channel === 'crm'
        ? new Map<string, PresenceEventRow[]>()
        : await this.eventsByAgent(ids, 'phone', from);

    const rows: PresenceChangeDto[] = [];
    for (const agent of agents) {
      const lists = [
        {
          channel: 'crm' as const,
          transitions: crmTransitions(crm.get(agent.id) ?? [], now, agent.lastSeenAt),
        },
        { channel: 'phone' as const, transitions: phoneTransitions(phone.get(agent.id) ?? []) },
      ];
      for (const { channel, transitions } of lists) {
        for (const change of presenceChanges(transitions, from, to)) {
          rows.push({
            id: `${agent.id}:${channel}:${change.at.toISOString()}`,
            userId: agent.id,
            name: agent.name,
            channel,
            from: change.from,
            to: change.to,
            at: change.at.toISOString(),
            durationSec: change.durationSec,
            inferred: change.inferred,
          });
        }
      }
    }
    rows.sort((a, b) => b.at.localeCompare(a.at) || a.name.localeCompare(b.name));
    return rows;
  }
}
