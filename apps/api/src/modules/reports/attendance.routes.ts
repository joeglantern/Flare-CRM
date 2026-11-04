import {
  attendanceAgentDto,
  attendanceQuery,
  attendanceReportDto,
  dataResponse,
  FEATURES,
  offsetListResponse,
  presenceChangeDto,
  presenceChangesQuery,
  roleHasPermission,
  type LogoutReason,
  type PresenceState,
  type VisibilityScope,
} from '@crm/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { csvStream } from '../../lib/csv.js';
import { FeatureNotInPlanError, ForbiddenError } from '../../lib/errors.js';
import { auditContext, requireUser } from '../../lib/request.js';
import { scopeOf } from '../../lib/scope.js';
import { AttendanceService } from './attendance.service.js';

const STATE_LABELS: Record<PresenceState, string> = {
  online: 'Online',
  disconnected: 'Disconnected',
  signed_out: 'Signed out',
  phone_offline: 'Phone offline',
  phone_idle: 'Phone available',
  phone_ringing: 'Phone ringing',
  phone_on_call: 'On a call',
};

const REASON_LABELS: Record<LogoutReason, string> = {
  sign_out: 'Signed out',
  idle: 'Idle timeout',
  session_ended: 'Session ended',
  disconnected: 'Connection closed',
  no_signal: 'Connection lost',
};

/** Spreadsheet-friendly wall-clock time in the workspace zone, which is what the screen shows. */
function localTime(iso: string | null, timeZone: string): string {
  if (iso === null) return '';
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone,
    dateStyle: 'short',
    timeStyle: 'medium',
  }).format(new Date(iso));
}

const attendanceRoutes: FastifyPluginAsyncZod = async (app) => {
  const service = new AttendanceService(app);

  // The same rule as the other reports, whose scope helper is private to their routes.
  const reportScope = async (request: FastifyRequest): Promise<VisibilityScope> => {
    const { actor } = await scopeOf(app, request);
    const teamReports = await app.entitlements.has('reports_team');
    if (teamReports && roleHasPermission(actor.role, 'report:view_all')) return { kind: 'all' };
    if (teamReports && roleHasPermission(actor.role, 'report:view_team') && actor.teamId)
      return { kind: 'team', teamId: actor.teamId, includeUnassigned: true };
    if (teamReports && roleHasPermission(actor.role, 'report:view_team')) return { kind: 'all' };
    return { kind: 'own', userId: actor.id, includeUnassigned: false };
  };

  // Exporting is its own permission and its own sold feature, as on the other reports.
  const sendCsv = async (
    request: FastifyRequest,
    reply: FastifyReply,
    name: string,
    headers: string[],
    rows: unknown[][],
  ) => {
    const user = requireUser(request);
    if (!roleHasPermission(user.role ?? 'agent', 'report:export')) throw new ForbiddenError();
    if (!(await app.entitlements.has('exports')))
      throw new FeatureNotInPlanError('exports', FEATURES.exports.label);
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

  app.get('/reports/attendance/agents', {
    config: { auth: { permission: 'report:view_own', feature: ['reports'] } },
    schema: {
      tags: ['reports'],
      response: { 200: dataResponse(z.array(attendanceAgentDto)) },
    },
    handler: async (request, reply) => {
      const data = await service.listAgents(await reportScope(request));
      return reply.send({ data });
    },
  });

  app.get('/reports/attendance', {
    config: { auth: { permission: 'report:view_own', feature: ['reports'] } },
    schema: {
      tags: ['reports'],
      querystring: attendanceQuery,
      response: { 200: dataResponse(attendanceReportDto) },
    },
    handler: async (request, reply) => {
      const data = await service.attendance(await reportScope(request), request.query);
      if (request.query.format === 'csv') {
        const tz = data.timeZone;
        return sendCsv(
          request,
          reply,
          'attendance',
          [
            'date',
            'agent',
            'extension',
            'firstLogin',
            'firstLoginInferred',
            'signedInBeforeDay',
            'lastLogout',
            'lastLogoutInferred',
            'lastLogoutReason',
            'stillSignedIn',
            'continuedNextDay',
            'firstCallHandled',
            'calls',
            'inbound',
            'outbound',
            'answered',
            'missed',
            'talkSec',
            'timeZone',
          ],
          data.days.map((d) => [
            d.date,
            d.name,
            d.extension,
            localTime(d.firstLoginAt, tz),
            d.firstLoginInferred,
            d.signedInBeforeDay,
            localTime(d.lastLogoutAt, tz),
            d.lastLogoutInferred,
            d.lastLogoutReason ? REASON_LABELS[d.lastLogoutReason] : '',
            d.stillSignedIn,
            d.continuedNextDay,
            localTime(d.firstCallAt, tz),
            d.calls.total,
            d.calls.inbound,
            d.calls.outbound,
            d.calls.answered,
            d.calls.missed,
            d.calls.talkSec,
            tz,
          ]),
        );
      }
      return reply.send({ data });
    },
  });

  app.get('/reports/attendance/presence', {
    config: { auth: { permission: 'report:view_own', feature: ['reports'] } },
    schema: {
      tags: ['reports'],
      querystring: presenceChangesQuery,
      response: { 200: offsetListResponse(presenceChangeDto) },
    },
    handler: async (request, reply) => {
      const q = request.query;
      const rows = await service.presence(await reportScope(request), q);
      if (q.format === 'csv') {
        const tz = await app.settings.get('timezone');
        return sendCsv(
          request,
          reply,
          'presence-changes',
          ['at', 'agent', 'source', 'from', 'to', 'lastedSec', 'inferred', 'timeZone'],
          rows.map((r) => [
            localTime(r.at, tz),
            r.name,
            r.channel === 'crm' ? 'CRM' : 'Phone',
            r.from ? STATE_LABELS[r.from] : '',
            STATE_LABELS[r.to],
            r.durationSec,
            r.inferred,
            tz,
          ]),
        );
      }
      const start = (q.page - 1) * q.pageSize;
      return reply.send({
        data: rows.slice(start, start + q.pageSize),
        page: {
          page: q.page,
          pageSize: q.pageSize,
          total: rows.length,
        },
      });
    },
  });
};

export default attendanceRoutes;
