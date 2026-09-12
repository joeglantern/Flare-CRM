/**
 * The alert inbox (docs/21 §8).
 *
 * An alert is a fact the sweep found. What an owner does about it is recorded beside it rather than
 * instead of it: acknowledging says somebody has seen it, snoozing says not now, closing says it is
 * dealt with, and muting says never for this customer. None of them make the underlying thing
 * untrue, which is why a closed alert whose cause is still there opens again as a new row.
 */
import {
  ALERT_STATES,
  alertCopy,
  alertMuteBody,
  alertRecipients,
  alertThresholds,
  CONSOLE_SETTING_KEYS,
  dataResponse,
  MAX_SNOOZE_DAYS,
  offsetListResponse,
} from '@crm/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { ConflictError, NotFoundError } from '../lib/errors.js';
import { newId } from '../lib/ids.js';
import { auditContext, requireUser } from '../lib/request.js';

const uuid = z.uuid();

const alertDto = z.object({
  id: z.string(),
  kind: z.string(),
  level: z.enum(['info', 'warning', 'danger']),
  state: z.enum(ALERT_STATES),
  customerId: z.string(),
  customerName: z.string(),
  stackId: z.string().nullable(),
  summary: z.string(),
  openedAt: z.string(),
  resolvedAt: z.string().nullable(),
  acknowledgedAt: z.string().nullable(),
  acknowledgedByName: z.string().nullable(),
  snoozedUntil: z.string().nullable(),
  closedAt: z.string().nullable(),
  closeReason: z.string().nullable(),
  context: z.record(z.string(), z.unknown()),
});

const muteDto = z.object({
  id: z.string(),
  kind: z.string().nullable(),
  customerId: z.string().nullable(),
  customerName: z.string().nullable(),
  reason: z.string(),
  createdAt: z.string(),
  expiresAt: z.string().nullable(),
});

interface AlertRow {
  id: string;
  kind: string;
  level: string;
  customerId: string;
  stackId: string | null;
  summary: string | null;
  openedAt: Date;
  resolvedAt: Date | null;
  acknowledgedAt: Date | null;
  acknowledgedById: string | null;
  snoozedUntil: Date | null;
  closedAt: Date | null;
  closeReason: string | null;
  context: unknown;
  customer: { name: string };
}

/**
 * Where one alert stands. Closed and cleared are endings; of the rest, being set aside is the
 * strongest thing anybody has said about it, then having been seen, then nothing at all.
 */
function stateOf(alert: AlertRow, now: Date): (typeof ALERT_STATES)[number] {
  if (alert.closedAt !== null) return 'closed';
  if (alert.resolvedAt !== null) return 'resolved';
  if (alert.snoozedUntil !== null && alert.snoozedUntil.getTime() > now.getTime()) return 'snoozed';
  if (alert.acknowledgedAt !== null) return 'acked';
  return 'open';
}

const alertsRoutes: FastifyPluginAsyncZod = (app) => {
  const toDto = (alert: AlertRow, names: Map<string, string>, now: Date) => ({
    id: alert.id,
    kind: alert.kind,
    level: alert.level as 'info' | 'warning' | 'danger',
    state: stateOf(alert, now),
    customerId: alert.customerId,
    customerName: alert.customer.name,
    stackId: alert.stackId,
    // Older rows kept it in the context blob; either way the inbox gets a sentence.
    summary:
      alert.summary ??
      (alert.context as { summary?: string } | null)?.summary ??
      alertCopy(alert.kind).description,
    openedAt: alert.openedAt.toISOString(),
    resolvedAt: alert.resolvedAt?.toISOString() ?? null,
    acknowledgedAt: alert.acknowledgedAt?.toISOString() ?? null,
    acknowledgedByName:
      alert.acknowledgedById === null ? null : (names.get(alert.acknowledgedById) ?? null),
    snoozedUntil: alert.snoozedUntil?.toISOString() ?? null,
    closedAt: alert.closedAt?.toISOString() ?? null,
    closeReason: alert.closeReason,
    context: (alert.context ?? {}) as Record<string, unknown>,
  });

  const namesOf = async (alerts: AlertRow[]): Promise<Map<string, string>> => {
    const ids = [...new Set(alerts.map((a) => a.acknowledgedById).filter((id) => id !== null))];
    if (ids.length === 0) return new Map();
    const owners = await app.db.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true },
    });
    return new Map(owners.map((o) => [o.id, o.name]));
  };

  const alertOr404 = async (id: string) => {
    const alert = await app.db.consoleAlert.findUnique({
      where: { id },
      include: { customer: { select: { name: true } } },
    });
    if (!alert) throw new NotFoundError('Alert');
    return alert;
  };

  app.get('/alerts', {
    config: { auth: { permission: 'alert:read' } },
    schema: {
      tags: ['console'],
      querystring: z.object({
        state: z.enum(ALERT_STATES).optional(),
        kind: z.string().max(40).optional(),
        level: z.enum(['info', 'warning', 'danger']).optional(),
        customerId: uuid.optional(),
        q: z.string().trim().max(120).optional(),
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(200).default(50),
      }),
      response: { 200: offsetListResponse(alertDto) },
    },
    handler: async (request) => {
      const q = request.query;
      const now = new Date();
      const and: Record<string, unknown>[] = [];
      if (q.kind !== undefined) and.push({ kind: q.kind });
      if (q.level !== undefined) and.push({ level: q.level });
      if (q.customerId !== undefined) and.push({ customerId: q.customerId });
      if (q.q !== undefined && q.q !== '') {
        and.push({
          OR: [
            { summary: { contains: q.q, mode: 'insensitive' } },
            { customer: { name: { contains: q.q, mode: 'insensitive' } } },
          ],
        });
      }
      // State is stored as a handful of timestamps rather than a column, so each one is the shape
      // of those timestamps rather than an equality.
      if (q.state === 'closed') and.push({ closedAt: { not: null } });
      if (q.state === 'resolved') and.push({ closedAt: null, resolvedAt: { not: null } });
      if (q.state === 'snoozed') {
        and.push({ closedAt: null, resolvedAt: null, snoozedUntil: { gt: now } });
      }
      if (q.state === 'acked') {
        and.push({
          closedAt: null,
          resolvedAt: null,
          acknowledgedAt: { not: null },
          OR: [{ snoozedUntil: null }, { snoozedUntil: { lte: now } }],
        });
      }
      if (q.state === 'open') {
        and.push({
          closedAt: null,
          resolvedAt: null,
          acknowledgedAt: null,
          OR: [{ snoozedUntil: null }, { snoozedUntil: { lte: now } }],
        });
      }
      const where = and.length === 0 ? {} : { AND: and };

      const [total, rows] = await Promise.all([
        app.db.consoleAlert.count({ where }),
        app.db.consoleAlert.findMany({
          where,
          include: { customer: { select: { name: true } } },
          // Newest first. Not by level: the words sort alphabetically, which would put info above
          // warning, and the screen has a level filter for when severity is the question.
          orderBy: { openedAt: 'desc' },
          skip: (q.page - 1) * q.pageSize,
          take: q.pageSize,
        }),
      ]);
      const names = await namesOf(rows);
      return {
        data: rows.map((a) => toDto(a, names, now)),
        page: { page: q.page, pageSize: q.pageSize, total },
      };
    },
  });

  /** The counts behind the nav badge, so a screen never fetches a page to show a number. */
  app.get('/alerts/summary', {
    config: { auth: { permission: 'alert:read' } },
    schema: {
      tags: ['console'],
      response: {
        200: dataResponse(
          z.object({
            open: z.number().int(),
            acked: z.number().int(),
            snoozed: z.number().int(),
            byLevel: z.object({
              danger: z.number().int(),
              warning: z.number().int(),
              info: z.number().int(),
            }),
          }),
        ),
      },
    },
    handler: async () => {
      const now = new Date();
      const live = { closedAt: null, resolvedAt: null };
      const notSnoozed = { OR: [{ snoozedUntil: null }, { snoozedUntil: { lte: now } }] };
      const [open, acked, snoozed, danger, warning, info] = await Promise.all([
        app.db.consoleAlert.count({ where: { ...live, acknowledgedAt: null, ...notSnoozed } }),
        app.db.consoleAlert.count({
          where: { ...live, acknowledgedAt: { not: null }, ...notSnoozed },
        }),
        app.db.consoleAlert.count({ where: { ...live, snoozedUntil: { gt: now } } }),
        app.db.consoleAlert.count({ where: { ...live, level: 'danger' } }),
        app.db.consoleAlert.count({ where: { ...live, level: 'warning' } }),
        app.db.consoleAlert.count({ where: { ...live, level: 'info' } }),
      ]);
      return { data: { open, acked, snoozed, byLevel: { danger, warning, info } } };
    },
  });

  app.post('/alerts/:id/ack', {
    config: { auth: { permission: 'alert:ack' } },
    schema: {
      tags: ['console'],
      params: z.object({ id: uuid }),
      body: z.object({ note: z.string().trim().max(300).optional() }).strict(),
      response: { 200: dataResponse(alertDto) },
    },
    handler: async (request) => {
      const before = await alertOr404(request.params.id);
      if (before.resolvedAt !== null || before.closedAt !== null) {
        throw new ConflictError('That alert is already finished with');
      }
      const actor = requireUser(request);
      await app.db.consoleAlert.update({
        where: { id: before.id },
        data: {
          acknowledgedAt: new Date(),
          acknowledgedById: actor.id,
          acknowledgeNote: request.body.note ?? null,
        },
      });
      await app.audit.write(auditContext(request), {
        action: 'alert.ack',
        entity: 'alert',
        entityId: before.id,
        after: {
          kind: before.kind,
          customerId: before.customerId,
          note: request.body.note ?? null,
        },
      });
      const after = await alertOr404(before.id);
      return { data: toDto(after, await namesOf([after]), new Date()) };
    },
  });

  app.post('/alerts/:id/snooze', {
    config: { auth: { permission: 'alert:ack' } },
    schema: {
      tags: ['console'],
      params: z.object({ id: uuid }),
      body: z
        .object({
          hours: z
            .number()
            .int()
            .min(1)
            .max(MAX_SNOOZE_DAYS * 24),
        })
        .strict(),
      response: { 200: dataResponse(alertDto) },
    },
    handler: async (request) => {
      const before = await alertOr404(request.params.id);
      if (before.resolvedAt !== null || before.closedAt !== null) {
        throw new ConflictError('That alert is already finished with');
      }
      const until = new Date(Date.now() + request.body.hours * 3_600_000);
      await app.db.consoleAlert.update({
        where: { id: before.id },
        data: { snoozedUntil: until },
      });
      await app.audit.write(auditContext(request), {
        action: 'alert.snooze',
        entity: 'alert',
        entityId: before.id,
        after: { kind: before.kind, until: until.toISOString() },
      });
      const after = await alertOr404(before.id);
      return { data: toDto(after, await namesOf([after]), new Date()) };
    },
  });

  /**
   * Closing one by hand. If the sweep still finds whatever this was about, it opens a new alert
   * rather than reopening this: the decision to close it was a real one and it stays on the record.
   */
  app.post('/alerts/:id/close', {
    config: { auth: { permission: 'alert:ack' } },
    schema: {
      tags: ['console'],
      params: z.object({ id: uuid }),
      body: z.object({ reason: z.string().trim().min(1).max(300) }).strict(),
      response: { 200: dataResponse(alertDto) },
    },
    handler: async (request) => {
      const before = await alertOr404(request.params.id);
      if (before.closedAt !== null) throw new ConflictError('That alert is already closed');
      const actor = requireUser(request);
      await app.db.consoleAlert.update({
        where: { id: before.id },
        data: {
          closedAt: new Date(),
          closedById: actor.id,
          closeReason: request.body.reason,
        },
      });
      await app.audit.write(auditContext(request), {
        action: 'alert.close',
        entity: 'alert',
        entityId: before.id,
        after: {
          kind: before.kind,
          customerId: before.customerId,
          reason: request.body.reason,
        },
      });
      const after = await alertOr404(before.id);
      return { data: toDto(after, await namesOf([after]), new Date()) };
    },
  });

  // ── what the sweep looks for, and who hears about it ─────────────────────────────────
  app.get('/alerts/settings', {
    config: { auth: { permission: 'alert:read' } },
    schema: {
      tags: ['console'],
      response: {
        200: dataResponse(z.object({ thresholds: alertThresholds, recipients: alertRecipients })),
      },
    },
    handler: async () => ({
      data: {
        thresholds: await app.settings.alertThresholds(),
        recipients: await app.settings.alertRecipients(),
      },
    }),
  });

  app.put('/alerts/settings', {
    config: { auth: { permission: 'alert:manage' } },
    schema: {
      tags: ['console'],
      body: z
        .object({ thresholds: alertThresholds.optional(), recipients: alertRecipients.optional() })
        .strict(),
      response: { 200: dataResponse(z.object({ ok: z.literal(true) })) },
    },
    handler: async (request) => {
      const before = {
        thresholds: await app.settings.alertThresholds(),
        recipients: await app.settings.alertRecipients(),
      };
      if (request.body.thresholds !== undefined) {
        await app.settings.write(CONSOLE_SETTING_KEYS.alertThresholds, request.body.thresholds);
      }
      if (request.body.recipients !== undefined) {
        await app.settings.write(CONSOLE_SETTING_KEYS.alertRecipients, request.body.recipients);
      }
      await app.audit.write(auditContext(request), {
        action: 'alert.settings_update',
        entity: 'settings',
        before,
        after: request.body,
      });
      return { data: { ok: true as const } };
    },
  });

  app.get('/alerts/mutes', {
    config: { auth: { permission: 'alert:read' } },
    schema: { tags: ['console'], response: { 200: dataResponse(z.array(muteDto)) } },
    handler: async () => {
      const rows = await app.db.alertMute.findMany({
        orderBy: { createdAt: 'desc' },
        include: { customer: { select: { name: true } } },
      });
      return {
        data: rows.map((m) => ({
          id: m.id,
          kind: m.kind,
          customerId: m.customerId,
          customerName: m.customer?.name ?? null,
          reason: m.reason,
          createdAt: m.createdAt.toISOString(),
          expiresAt: m.expiresAt?.toISOString() ?? null,
        })),
      };
    },
  });

  app.post('/alerts/mutes', {
    config: { auth: { permission: 'alert:manage' } },
    schema: {
      tags: ['console'],
      body: alertMuteBody,
      response: { 201: dataResponse(z.object({ id: z.string() })) },
    },
    handler: async (request, reply) => {
      const b = request.body;
      const created = await app.db.alertMute.create({
        data: {
          id: newId(),
          kind: b.kind ?? null,
          customerId: b.customerId ?? null,
          reason: b.reason,
          createdById: requireUser(request).id,
          expiresAt: b.expiresAt === null ? null : new Date(b.expiresAt),
        },
      });
      await app.audit.write(auditContext(request), {
        action: 'alert.mute',
        entity: 'alert',
        entityId: created.id,
        after: { kind: b.kind ?? null, customerId: b.customerId ?? null, reason: b.reason },
      });
      return reply.status(201).send({ data: { id: created.id } });
    },
  });

  app.delete('/alerts/mutes/:id', {
    config: { auth: { permission: 'alert:manage' } },
    schema: {
      tags: ['console'],
      params: z.object({ id: uuid }),
      response: { 200: dataResponse(z.object({ ok: z.literal(true) })) },
    },
    handler: async (request) => {
      const before = await app.db.alertMute.findUnique({ where: { id: request.params.id } });
      if (!before) throw new NotFoundError('Mute');
      await app.db.alertMute.delete({ where: { id: before.id } });
      await app.audit.write(auditContext(request), {
        action: 'alert.unmute',
        entity: 'alert',
        entityId: before.id,
        before: { kind: before.kind, customerId: before.customerId },
      });
      return { data: { ok: true as const } };
    },
  });

  return Promise.resolve();
};

export default alertsRoutes;
