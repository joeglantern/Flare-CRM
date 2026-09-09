/**
 * Calls (R-4.2, R-4.3): history, dispositions, click-to-call, in-call controls, recordings.
 */
import {
  formatNational,
  toDialable,
  toE164,
  type CallControlBody,
  type CallDto,
  type DialBody,
  type VisibilityScope,
  type listCallsQuery,
} from '@crm/shared';
import type { FastifyInstance } from 'fastify';
import type { CountryCode } from 'libphonenumber-js';
import type { z } from 'zod';
import type { Prisma } from '../../generated/prisma/client.js';
import { YeastarApiError } from '../../integrations/yeastar/client.js';
import { IS_TALKING } from '../../integrations/yeastar/normalize.js';
import {
  AppError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  PbxUnavailableError,
  ValidationError,
} from '../../lib/errors.js';
import { newId } from '../../lib/ids.js';
import { isoOrNull } from '../../lib/object.js';
import { SHAPES, scopeWhere } from '../../lib/scope.js';
import type { AuditContext } from '../audit/audit.service.js';

export const callSelect = {
  id: true,
  pbxCallId: true,
  direction: true,
  status: true,
  fromNumber: true,
  toNumber: true,
  externalE164: true,
  contactId: true,
  contact: { select: { id: true, displayName: true } },
  userId: true,
  user: { select: { id: true, name: true } },
  extension: true,
  trunkName: true,
  didNumber: true,
  callPath: true,
  startedAt: true,
  answeredAt: true,
  endedAt: true,
  ringDurationSec: true,
  talkDurationSec: true,
  totalDurationSec: true,
  dispositionId: true,
  disposition: { select: { id: true, name: true } },
  dispositionNote: true,
  recordingStatus: true,
  recordingKey: true,
  recordingFileName: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.CallSelect;

type CallRow = Prisma.CallGetPayload<{ select: typeof callSelect }>;

export function callToDto(r: CallRow): CallDto {
  return {
    id: r.id,
    pbxCallId: r.pbxCallId,
    direction: r.direction as CallDto['direction'],
    status: r.status as CallDto['status'],
    fromNumber: r.fromNumber,
    toNumber: r.toNumber,
    externalNumber: r.externalE164,
    externalDisplay: r.externalE164
      ? formatNational(r.externalE164)
      : r.direction === 'inbound'
        ? r.fromNumber || null
        : r.toNumber || null,
    contact: r.contact,
    contactId: r.contactId,
    user: r.user,
    userId: r.userId,
    extension: r.extension,
    trunkName: r.trunkName,
    didNumber: r.didNumber,
    callPath: r.callPath,
    startedAt: r.startedAt.toISOString(),
    answeredAt: isoOrNull(r.answeredAt),
    endedAt: isoOrNull(r.endedAt),
    ringDurationSec: r.ringDurationSec,
    talkDurationSec: r.talkDurationSec,
    totalDurationSec: r.totalDurationSec,
    disposition: r.disposition,
    dispositionNote: r.dispositionNote,
    recordingStatus: r.recordingStatus as CallDto['recordingStatus'],
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

export interface Actor {
  id: string;
  role: string;
  extension: string | null;
}

export class CallsService {
  constructor(private readonly app: FastifyInstance) {}

  private get db() {
    return this.app.db;
  }

  private callScope(scope: VisibilityScope): Prisma.CallWhereInput {
    if (scope.kind === 'all') return {};
    // a call is visible if the agent handled it, or the contact it belongs to is visible
    return { OR: [scopeWhere(scope, SHAPES.call), { contact: scopeWhere(scope, SHAPES.contact) }] };
  }

  /**
   * For a set of numbers: how many inbound calls from each were missed inside the window, and the
   * outbound calls to each after `since`. Bounded by the numbers on one page rather than by a page
   * of outbound calls, so a busy line cannot push a callback out of view.
   */
  async missedContext(
    scope: VisibilityScope,
    numbers: string[],
    window: { from?: Date | undefined; to?: Date | undefined },
    since: Date,
  ): Promise<{
    attempts: Map<string, number>;
    callbacks: { externalE164: string | null; startedAt: Date }[];
  }> {
    if (numbers.length === 0) return { attempts: new Map(), callbacks: [] };
    const inWindow = {
      ...(window.from ? { gte: window.from } : {}),
      ...(window.to ? { lte: window.to } : {}),
    };
    const [grouped, callbacks] = await Promise.all([
      this.db.call.groupBy({
        by: ['externalE164'],
        where: {
          AND: [
            this.callScope(scope),
            { direction: 'inbound', status: 'missed', externalE164: { in: numbers } },
            ...(Object.keys(inWindow).length > 0 ? [{ startedAt: inWindow }] : []),
          ],
        },
        _count: { _all: true },
      }),
      this.db.call.findMany({
        where: {
          AND: [
            this.callScope(scope),
            { direction: 'outbound', externalE164: { in: numbers }, startedAt: { gt: since } },
          ],
        },
        select: { externalE164: true, startedAt: true },
        orderBy: { startedAt: 'asc' },
      }),
    ]);
    const attempts = new Map<string, number>();
    for (const g of grouped) if (g.externalE164) attempts.set(g.externalE164, g._count._all);
    return { attempts, callbacks };
  }

  async list(scope: VisibilityScope, actorId: string, q: z.infer<typeof listCallsQuery>) {
    const digits = q.number?.replace(/\D/g, '') ?? '';
    const where: Prisma.CallWhereInput = {
      AND: [
        this.callScope(scope),
        ...(q.direction ? [{ direction: q.direction }] : []),
        ...(q.status ? [{ status: q.status }] : []),
        ...(q.userId ? [{ userId: q.userId }] : []),
        ...(q.mine === 'true' ? [{ userId: actorId }] : []),
        ...(q.contactId ? [{ contactId: q.contactId }] : []),
        ...(q.companyId ? [{ contact: { companyId: q.companyId } }] : []),
        ...(q.unmatched ? [{ contactId: null, direction: { not: 'internal' } }] : []),
        ...(q.hasRecording
          ? [{ recordingStatus: q.hasRecording === 'true' ? 'stored' : { not: 'stored' } }]
          : []),
        ...(digits.length >= 3
          ? [
              {
                OR: [
                  { externalE164: { contains: digits } },
                  { fromNumber: { contains: digits } },
                  { toNumber: { contains: digits } },
                ],
              },
            ]
          : []),
        ...(q.from || q.to
          ? [
              {
                startedAt: {
                  ...(q.from ? { gte: new Date(q.from) } : {}),
                  ...(q.to ? { lte: new Date(q.to) } : {}),
                },
              },
            ]
          : []),
      ],
    };
    const orderBy =
      q.sort.length > 0
        ? q.sort.map((s) => ({ [s.field]: s.direction }))
        : [{ startedAt: 'desc' as const }];
    const [rows, total] = await Promise.all([
      this.db.call.findMany({
        where,
        select: callSelect,
        orderBy,
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.db.call.count({ where }),
    ]);
    return { data: rows.map(callToDto), page: { page: q.page, pageSize: q.pageSize, total } };
  }

  async getVisible(scope: VisibilityScope, id: string): Promise<CallRow> {
    const row = await this.db.call.findFirst({
      where: { id, ...this.callScope(scope) },
      select: callSelect,
    });
    if (!row) throw new NotFoundError('Call');
    return row;
  }

  async get(scope: VisibilityScope, id: string): Promise<CallDto> {
    return callToDto(await this.getVisible(scope, id));
  }

  async setDisposition(
    scope: VisibilityScope,
    actor: Actor,
    id: string,
    body: { dispositionId: string | null; note?: string | null | undefined },
    ctx: AuditContext,
  ): Promise<CallDto> {
    const before = await this.getVisible(scope, id);
    if (body.dispositionId) {
      const d = await this.db.callDisposition.findFirst({
        where: { id: body.dispositionId, isActive: true },
      });
      if (!d)
        throw new ValidationError([{ path: 'dispositionId', message: 'Disposition not found' }]);
    }
    await this.db.$transaction(async (tx) => {
      await tx.call.update({
        where: { id },
        data: {
          dispositionId: body.dispositionId,
          dispositionNote: body.note ?? null,
          dispositionSetById: actor.id,
          dispositionSetAt: new Date(),
        },
      });
      const disposition = body.dispositionId
        ? await tx.callDisposition.findUnique({
            where: { id: body.dispositionId },
            select: { name: true },
          })
        : null;
      const activity = await tx.activity.findFirst({
        where: { refTable: 'calls', refId: id },
        select: { id: true, meta: true },
      });
      if (activity) {
        const meta = (activity.meta ?? {}) as Record<string, unknown>;
        await tx.activity.update({
          where: { id: activity.id },
          data: {
            meta: {
              ...meta,
              disposition: disposition?.name ?? null,
              dispositionNote: body.note ?? null,
              text: `${typeof meta.external === 'string' ? meta.external : ''} ${disposition?.name ?? ''} ${body.note ?? ''}`,
            },
          },
        });
      }
      await this.app.audit.writeWith(tx, ctx, {
        action: 'call.disposition',
        entity: 'call',
        entityId: id,
        before: { dispositionId: before.dispositionId },
        after: body,
      });
    });
    return this.get(scope, id);
  }

  async linkContact(
    scope: VisibilityScope,
    id: string,
    contactId: string,
    ctx: AuditContext,
  ): Promise<CallDto> {
    const call = await this.getVisible(scope, id);
    const contact = await this.db.contact.findFirst({
      where: { id: contactId, ...scopeWhere(scope, SHAPES.contact) },
      select: { id: true, companyId: true },
    });
    if (!contact) throw new ValidationError([{ path: 'contactId', message: 'Contact not found' }]);
    await this.db.$transaction(async (tx) => {
      await tx.call.update({ where: { id }, data: { contactId: contact.id } });
      await tx.activity.updateMany({
        where: { refTable: 'calls', refId: id },
        data: { contactId: contact.id, companyId: contact.companyId },
      });
      await this.app.audit.writeWith(tx, ctx, {
        action: 'call.link_contact',
        entity: 'call',
        entityId: id,
        before: { contactId: call.contactId },
        after: { contactId },
      });
    });
    return this.get(scope, id);
  }

  // ── click-to-call (docs/06 §10) ──────────────────────────────────────────────────────

  async dial(
    scope: VisibilityScope,
    actor: Actor,
    body: DialBody,
    ctx: AuditContext,
  ): Promise<{ callId: string; pbxCallId: string; callee: string }> {
    const cti = this.app.cti;
    if (!cti.enabled || !cti.client)
      throw new PbxUnavailableError('Telephony integration is not enabled');
    if (!actor.extension) throw new ConflictError('Your account has no PBX extension assigned');
    const settings = await this.app.settings.getAll();
    const country = settings.defaultCountry as CountryCode;

    let e164: string | null = null;
    let contactId: string | null = body.contactId ?? null;
    if (body.phoneId) {
      const phone = await this.db.contactPhone.findFirst({
        where: {
          id: body.phoneId,
          deletedAt: null,
          contact: { deletedAt: null, ...scopeWhere(scope, SHAPES.contact) },
        },
        select: { e164: true, contactId: true, contact: { select: { doNotCall: true } } },
      });
      if (!phone) throw new ValidationError([{ path: 'phoneId', message: 'Phone not found' }]);
      if (phone.contact.doNotCall && !this.can(actor, 'contact:override_dnc'))
        throw new AppError('DO_NOT_CALL', 403, 'This contact is marked do-not-call');
      e164 = phone.e164;
      contactId = phone.contactId;
    } else if (body.number) {
      e164 = toE164(body.number, country);
      if (!e164) throw new ValidationError([{ path: 'number', message: 'Invalid phone number' }]);
      if (!contactId) {
        const match = await this.db.contactPhone.findFirst({
          where: { e164, deletedAt: null, contact: { deletedAt: null } },
          select: { contactId: true, contact: { select: { doNotCall: true } } },
        });
        if (match?.contact.doNotCall && !this.can(actor, 'contact:override_dnc'))
          throw new AppError('DO_NOT_CALL', 403, 'This contact is marked do-not-call');
        contactId = match?.contactId ?? null;
      }
    }
    if (!e164) throw new ValidationError([{ path: 'number', message: 'Nothing to dial' }]);

    const callee = toDialable(
      e164,
      {
        stripPlus: settings.dialRules.stripPlus,
        outboundPrefix: settings.dialRules.outboundPrefix,
        e164ToDialable: settings.dialRules.e164ToDialable,
      },
      country,
    );
    let pbxCallId: string;
    try {
      const res = await cti.client.dial({
        caller: actor.extension,
        callee,
        ...(settings.dialRules.dialPermissionExtension
          ? { dial_permission: settings.dialRules.dialPermissionExtension }
          : {}),
      });
      pbxCallId = res.call_id;
    } catch (err) {
      if (err instanceof YeastarApiError)
        throw new PbxUnavailableError(`PBX refused the call: ${err.errmsg}`);
      throw err;
    }

    const callId = newId();
    await this.db.call.create({
      data: {
        id: callId,
        pbxCallId,
        direction: 'outbound',
        status: 'ringing',
        fromNumber: actor.extension,
        toNumber: callee,
        externalE164: e164,
        contactId,
        userId: actor.id,
        extension: actor.extension,
        startedAt: new Date(),
      },
    });
    // pre-seed live state so the first 30011 attaches to this row
    await this.app.valkey.set(
      `cti:call:${pbxCallId}`,
      JSON.stringify({
        pbxCallId,
        crmCallId: callId,
        direction: 'outbound',
        externalRaw: callee,
        externalE164: e164,
        externalDisplay: formatNational(e164),
        contactId,
        contactName: null,
        didNumber: null,
        trunkName: null,
        callPath: null,
        trunkChannelId: null,
        members: {},
        poppedUsers: [actor.id],
        ringingExtensions: [actor.extension],
        answeredExtension: null,
        answeredUserId: null,
        answeredAt: null,
        firstEventAt: new Date().toISOString(),
        ended: false,
      }),
      'EX',
      6 * 60 * 60,
    );
    await this.app.audit.write(ctx, {
      action: 'call.dial',
      entity: 'call',
      entityId: callId,
      after: { callee, contactId },
    });
    this.app.realtime
      .to(`user:${actor.id}`)
      .emit('call:dialing', { at: new Date().toISOString(), callId, pbxCallId, callee });
    return { callId, pbxCallId, callee };
  }

  // ── in-call controls (docs/06 §11) ───────────────────────────────────────────────────

  async control(
    scope: VisibilityScope,
    actor: Actor,
    id: string,
    body: CallControlBody,
    ctx: AuditContext,
  ): Promise<{ ok: true }> {
    const cti = this.app.cti;
    if (!cti.enabled || !cti.client)
      throw new PbxUnavailableError('Telephony integration is not enabled');
    // Participation is decided from the live call state, not the persisted row: the screen pop
    // reaches the agent before the DB row carries their userId, and they may act immediately.
    const call = await this.db.call.findUnique({ where: { id }, select: callSelect });
    if (!call) throw new NotFoundError('Call');
    const state = await cti.machine.loadState(call.pbxCallId);
    if (!state || state.ended) throw new ConflictError('This call is no longer active');

    const privileged =
      this.can(actor, 'call:control') &&
      (actor.role.includes('admin') || actor.role.includes('manager'));
    const myLeg = Object.entries(state.members).find(([, m]) => m.number === actor.extension);
    const participant = myLeg !== undefined || state.poppedUsers.includes(actor.id);
    if (!participant) {
      if (!privileged) throw new ForbiddenError('You are not a participant of this call');
      await this.getVisible(scope, id); // managers stay inside their team scope
    }
    const channel =
      myLeg?.[0] ??
      Object.entries(state.members).find(([, m]) => IS_TALKING.has(m.status))?.[0] ??
      Object.keys(state.members)[0];

    try {
      switch (body.action) {
        case 'answer':
          if (!state.trunkChannelId)
            throw new ConflictError('Answer via API requires "Control Inbound Call" on the trunk');
          await cti.client.acceptInbound({
            channel_id: state.trunkChannelId,
            ...(actor.extension ? { extension: actor.extension } : {}),
          });
          break;
        case 'decline':
          if (!state.trunkChannelId)
            throw new ConflictError('Decline via API requires "Control Inbound Call" on the trunk');
          await cti.client.refuseInbound(state.trunkChannelId);
          break;
        case 'hangup':
          await cti.client.hangup(channel ?? state.trunkChannelId ?? '');
          break;
        case 'hold':
          if (!channel) throw new ConflictError('No active leg');
          await cti.client.hold(channel);
          break;
        case 'unhold':
          if (!channel) throw new ConflictError('No active leg');
          await cti.client.unhold(channel);
          break;
        case 'mute':
          if (!channel) throw new ConflictError('No active leg');
          await cti.client.mute(channel);
          break;
        case 'unmute':
          if (!channel) throw new ConflictError('No active leg');
          await cti.client.unmute(channel);
          break;
        case 'transfer': {
          if (!channel) throw new ConflictError('No active leg');
          const settings = await this.app.settings.getAll();
          const target = body.number ?? '';
          const e164 = toE164(target, settings.defaultCountry as CountryCode);
          const number = /^\d{2,8}$/.test(target)
            ? target
            : e164
              ? toDialable(
                  e164,
                  {
                    stripPlus: settings.dialRules.stripPlus,
                    outboundPrefix: settings.dialRules.outboundPrefix,
                    e164ToDialable: settings.dialRules.e164ToDialable,
                  },
                  settings.defaultCountry as CountryCode,
                )
              : target;
          await cti.client.transfer({ channel_id: channel, number, type: body.transferType });
          break;
        }
      }
    } catch (err) {
      if (err instanceof YeastarApiError)
        throw new PbxUnavailableError(`PBX rejected ${body.action}: ${err.errmsg}`);
      throw err;
    }
    await this.app.audit.write(ctx, {
      action: `call.control.${body.action}`,
      entity: 'call',
      entityId: id,
      after: { number: body.number },
    });
    return { ok: true };
  }

  // ── recordings (docs/03 §3.3) ────────────────────────────────────────────────────────

  async recordingAccess(
    scope: VisibilityScope,
    actor: Actor,
    id: string,
    ctx: AuditContext,
  ): Promise<{ key: string; fileName: string }> {
    const call = await this.getVisible(scope, id);
    if (call.recordingStatus !== 'stored' || !call.recordingKey)
      throw new NotFoundError('Recording');
    const settings = await this.app.settings.getAll();
    const privileged = actor.role.includes('admin') || actor.role.includes('manager');
    if (!privileged && (!settings.recording.allowAgentPlayback || call.userId !== actor.id))
      throw new ForbiddenError('Recording playback is not allowed for this call');
    await this.app.audit.write(ctx, { action: 'recording.accessed', entity: 'call', entityId: id });
    return { key: call.recordingKey, fileName: call.recordingFileName ?? `${id}.wav` };
  }

  async deleteRecording(scope: VisibilityScope, id: string, ctx: AuditContext): Promise<void> {
    const call = await this.getVisible(scope, id);
    if (call.recordingKey) await this.app.storage.delete(call.recordingKey).catch(() => undefined);
    await this.db.call.update({
      where: { id },
      data: {
        recordingKey: null,
        recordingStatus: 'none',
        recordingSizeBytes: null,
        recordingSha256: null,
      },
    });
    await this.app.audit.write(ctx, {
      action: 'recording.deleted',
      entity: 'call',
      entityId: id,
      before: { key: call.recordingKey },
    });
  }

  private can(actor: Actor, permission: 'contact:override_dnc' | 'call:control'): boolean {
    // lightweight role check (full statement lives in @crm/shared); admins/managers hold both
    return (
      actor.role.includes('admin') ||
      actor.role.includes('manager') ||
      permission === 'call:control'
    );
  }
}
