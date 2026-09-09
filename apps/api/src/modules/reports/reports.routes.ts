import {
  agentPerformanceDto,
  callsReportQuery,
  callsSummaryDto,
  dataResponse,
  forecastDto,
  forecastQuery,
  missedCallDto,
  missedCallsQuery,
  offsetListResponse,
  pipelineConversionDto,
  pipelineReportQuery,
  pipelineSummaryDto,
  roleHasPermission,
  type VisibilityScope,
} from '@crm/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { csvStream } from '../../lib/csv.js';
import { auditContext, requireUser } from '../../lib/request.js';
import { scopeOf } from '../../lib/scope.js';
import { CallsService } from '../calls/calls.service.js';
import { ReportsService, type ReportRange } from './reports.service.js';

const DEFAULT_TZ = 'Africa/Nairobi';

const reportsRoutes: FastifyPluginAsyncZod = async (app) => {
  const service = new ReportsService(app);
  const calls = new CallsService(app);

  /** Report scope derives from report:* permissions, not from agentVisibility. */
  const reportScope = async (request: FastifyRequest): Promise<VisibilityScope> => {
    const { actor } = await scopeOf(app, request);
    const teamReports = await app.entitlements.has('reports_team');
    if (teamReports && roleHasPermission(actor.role, 'report:view_all')) return { kind: 'all' };
    if (teamReports && roleHasPermission(actor.role, 'report:view_team') && actor.teamId)
      return { kind: 'team', teamId: actor.teamId, includeUnassigned: true };
    if (teamReports && roleHasPermission(actor.role, 'report:view_team')) return { kind: 'all' }; // manager without a team sees everything (docs/07 §4)
    return { kind: 'own', userId: actor.id, includeUnassigned: false };
  };

  const rangeOf = (
    request: FastifyRequest,
    query: { from?: string | undefined; to?: string | undefined; tz?: string | undefined },
  ): ReportRange => {
    const to = query.to ? new Date(query.to) : new Date();
    const from = query.from
      ? new Date(query.from)
      : new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
    return { from, to, tz: query.tz ?? requireUser(request).timezone ?? DEFAULT_TZ };
  };

  const sendCsv = async (
    request: FastifyRequest,
    reply: FastifyReply,
    name: string,
    headers: string[],
    rows: unknown[][],
  ) => {
    await app.audit.write(auditContext(request), {
      action: 'report.export',
      entity: 'report',
      after: { report: name, rows: rows.length },
    });
    void reply.header('content-type', 'text/csv; charset=utf-8');
    void reply.header(
      'content-disposition',
      `attachment; filename="${name}-${new Date().toISOString().slice(0, 10)}.csv"`,
    );
    void reply.header('cache-control', 'private, no-store');
    const iter = (async function* () {
      for (const r of rows) yield r;
    })();
    return reply.send(csvStream(headers, iter));
  };

  app.get('/reports/calls/summary', {
    config: { auth: { permission: 'report:view_own', feature: ['reports', 'telephony'] } },
    schema: {
      tags: ['reports'],
      querystring: callsReportQuery,
      response: { 200: dataResponse(callsSummaryDto) },
    },
    handler: async (request, reply) => {
      const data = await service.callsSummary(
        await reportScope(request),
        rangeOf(request, request.query),
        { userId: request.query.userId, teamId: request.query.teamId },
      );
      if (request.query.format === 'csv')
        return sendCsv(
          request,
          reply,
          'calls-summary',
          ['date', 'inbound', 'outbound', 'answered', 'missed'],
          data.series.map((s) => [s.date, s.inbound, s.outbound, s.answered, s.missed]),
        );
      return reply.send({ data });
    },
  });

  app.get('/reports/calls/agents', {
    config: { auth: { permission: 'report:view_own', feature: ['reports', 'telephony'] } },
    schema: {
      tags: ['reports'],
      querystring: callsReportQuery,
      response: { 200: dataResponse(z.array(agentPerformanceDto)) },
    },
    handler: async (request, reply) => {
      const data = await service.agentPerformance(
        await reportScope(request),
        rangeOf(request, request.query),
        { teamId: request.query.teamId },
      );
      if (request.query.format === 'csv') {
        return sendCsv(
          request,
          reply,
          'agent-performance',
          [
            'agent',
            'extension',
            'total',
            'inbound',
            'outbound',
            'answered',
            'missed',
            'totalTalkSec',
            'avgTalkSec',
            'avgRingSec',
          ],
          data.map((a) => [
            a.name,
            a.extension,
            a.total,
            a.inbound,
            a.outbound,
            a.answered,
            a.missed,
            a.totalTalkSec,
            a.avgTalkSec,
            a.avgRingSec,
          ]),
        );
      }
      return reply.send({ data });
    },
  });

  app.get('/reports/calls/missed', {
    config: { auth: { permission: 'report:view_own', feature: ['reports', 'telephony'] } },
    schema: {
      tags: ['reports'],
      querystring: missedCallsQuery,
      response: { 200: offsetListResponse(missedCallDto) },
    },
    handler: async (request, reply) => {
      const q = request.query;
      const scope = await reportScope(request);
      const result = await calls.list(scope, requireUser(request).id, {
        page: q.page,
        pageSize: q.format === 'csv' ? 100 : q.pageSize,
        direction: 'inbound',
        status: 'missed',
        sort: [],
        ...(q.from ? { from: q.from } : {}),
        ...(q.to ? { to: q.to } : {}),
      });
      const numbers = [
        ...new Set(result.data.map((c) => c.externalNumber).filter((n) => n !== null)),
      ];
      const earliest = result.data.reduce<Date | null>((min, c) => {
        const t = new Date(c.startedAt);
        return min === null || t < min ? t : min;
      }, null);
      const ctx = await calls.missedContext(
        scope,
        numbers,
        { from: q.from ? new Date(q.from) : undefined, to: q.to ? new Date(q.to) : undefined },
        earliest ?? new Date(0),
      );
      const data = result.data.map((c) => {
        const back =
          c.externalNumber === null
            ? undefined
            : ctx.callbacks.find(
                (o) => o.externalE164 === c.externalNumber && o.startedAt > new Date(c.startedAt),
              );
        return {
          ...c,
          attempts: c.externalNumber === null ? 1 : (ctx.attempts.get(c.externalNumber) ?? 1),
          returned: back !== undefined,
          returnedAt: back?.startedAt.toISOString() ?? null,
        };
      });
      if (q.format === 'csv')
        return sendCsv(
          request,
          reply,
          'missed-calls',
          ['startedAt', 'number', 'contact', 'extension', 'ringSec', 'attempts', 'returnedAt'],
          data.map((c) => [
            c.startedAt,
            c.externalNumber,
            c.contact?.displayName ?? '',
            c.extension,
            c.ringDurationSec,
            c.attempts,
            c.returnedAt ?? '',
          ]),
        );
      return reply.send({ data, page: result.page });
    },
  });

  app.get('/reports/pipeline/summary', {
    config: { auth: { permission: 'report:view_own', feature: ['reports', 'deals'] } },
    schema: {
      tags: ['reports'],
      querystring: pipelineReportQuery,
      response: { 200: dataResponse(pipelineSummaryDto) },
    },
    handler: async (request, reply) => {
      const data = await service.pipelineSummary(
        await reportScope(request),
        rangeOf(request, request.query),
        { pipelineId: request.query.pipelineId, ownerId: request.query.ownerId },
      );
      if (request.query.format === 'csv')
        return sendCsv(
          request,
          reply,
          'pipeline-summary',
          ['stage', 'openCount', 'openValue', 'weightedValue'],
          data.stages.map((s) => [s.name, s.openCount, s.openValue, s.weightedValue]),
        );
      return reply.send({ data });
    },
  });

  app.get('/reports/pipeline/conversion', {
    config: { auth: { permission: 'report:view_own', feature: ['reports', 'deals'] } },
    schema: {
      tags: ['reports'],
      querystring: pipelineReportQuery,
      response: { 200: dataResponse(pipelineConversionDto) },
    },
    handler: async (request, reply) => {
      const data = await service.pipelineConversion(
        await reportScope(request),
        rangeOf(request, request.query),
        { pipelineId: request.query.pipelineId, ownerId: request.query.ownerId },
      );
      if (request.query.format === 'csv')
        return sendCsv(
          request,
          reply,
          'pipeline-conversion',
          ['stage', 'reached', 'pct'],
          data.stages.map((s) => [s.name, s.reached, s.pct]),
        );
      return reply.send({ data });
    },
  });

  app.get('/reports/pipeline/forecast', {
    config: { auth: { permission: 'report:view_own', feature: ['reports', 'deals'] } },
    schema: {
      tags: ['reports'],
      querystring: forecastQuery,
      response: { 200: dataResponse(forecastDto) },
    },
    handler: async (request, reply) => {
      const data = await service.forecast(await reportScope(request), {
        pipelineId: request.query.pipelineId,
        ownerId: request.query.ownerId,
        months: request.query.months,
      });
      if (request.query.format === 'csv')
        return sendCsv(
          request,
          reply,
          'forecast',
          ['month', 'count', 'value', 'weightedValue'],
          data.months.map((m) => [m.month, m.count, m.value, m.weightedValue]),
        );
      return reply.send({ data });
    },
  });
};

export default reportsRoutes;
