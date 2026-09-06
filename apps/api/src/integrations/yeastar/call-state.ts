/**
 * CTI state machine (docs/06 §8). Live state per PBX call lives in Valkey; every transition is
 * processed sequentially per call_id and produces socket events + database writes.
 */
import type { CallStatus, ServerEventPayload } from '@crm/shared';
import type { FastifyInstance } from 'fastify';
import type { CountryCode } from 'libphonenumber-js';
import { QUEUES } from '../../jobs/queues.js';
import { newId } from '../../lib/ids.js';
import { nowIso, rooms } from '../../lib/realtime.js';
import { contactSummarySelect, contactToSummary } from '../../modules/contacts/contacts.mappers.js';
import {
  genericEvent,
  knownEvent,
  parsePbxTime,
  type YeastarCdr,
  type YeastarEvent,
  type YeastarMemberEntry,
} from './events.js';
import type { ExtensionMap } from './extension-map.js';
import {
  IS_RINGING,
  IS_TALKING,
  classifyMembers,
  displayFor,
  externalFromCdr,
  type Direction,
  type NormalizeOptions,
} from './normalize.js';

export interface LiveCallState {
  pbxCallId: string;
  crmCallId: string;
  direction: Direction;
  externalRaw: string | null;
  externalE164: string | null;
  externalDisplay: string;
  contactId: string | null;
  contactName: string | null;
  didNumber: string | null;
  trunkName: string | null;
  callPath: string | null;
  trunkChannelId: string | null;
  members: Record<string, { number: string; status: string; hold: boolean }>; // by channel id (extension legs)
  poppedUsers: string[];
  ringingExtensions: string[];
  answeredExtension: string | null;
  answeredUserId: string | null;
  answeredAt: string | null;
  firstEventAt: string;
  ended: boolean;
}

const STATE_TTL_SEC = 6 * 60 * 60;
const keyOf = (id: string) => `cti:call:${id}`;

export interface CallStateDeps {
  app: FastifyInstance;
  extMap: ExtensionMap;
  /** Provided by the capabilities computation (answer via API / webrtc / none). */
  capabilities: () => Promise<ServerEventPayload<'call:ringing'>['capabilities']>;
  pbxTimeZone: string;
  onPopLatency?: (ms: number) => void;
}

export class CallStateMachine {
  private readonly chains = new Map<string, Promise<void>>();

  constructor(private readonly deps: CallStateDeps) {}

  private get app() {
    return this.deps.app;
  }

  /** Entry point for raw JSON text from WebSocket or webhook. */
  async handleRaw(
    raw: unknown,
    source: 'websocket' | 'webhook' | 'reconcile',
    receivedAt = new Date(),
  ): Promise<void> {
    const generic = genericEvent.safeParse(raw);
    if (!generic.success) {
      this.app.log.warn({ issues: generic.error.issues.slice(0, 3) }, 'unparseable PBX event');
      return;
    }
    const callId = extractCallId(generic.data);
    this.app.db.pbxEvent
      .create({
        data: {
          id: newId(),
          eventType: generic.data.type,
          pbxCallId: callId,
          sn: generic.data.sn ?? null,
          payload: raw as object,
          receivedAt,
        },
      })
      .catch((err: unknown) => {
        this.app.log.error({ err }, 'pbx_events archive write failed');
      });
    const known = knownEvent.safeParse(raw);
    if (!known.success) {
      this.app.log.debug({ type: generic.data.type }, 'PBX event without handler archived');
      return;
    }
    const event = known.data;
    await this.serialized(callId ?? `evt:${String(event.type)}`, () =>
      this.handleEvent(event, receivedAt, source),
    );
  }

  private serialized(key: string, fn: () => Promise<void>): Promise<void> {
    const prev = this.chains.get(key) ?? Promise.resolve();
    const next = prev.then(fn, fn).catch((err: unknown) => {
      this.app.log.error({ err, key }, 'CTI event handling failed');
    });
    this.chains.set(key, next);
    void next.finally(() => {
      if (this.chains.get(key) === next) this.chains.delete(key);
    });
    return next;
  }

  async handleEvent(
    event: YeastarEvent,
    receivedAt: Date,
    source: 'websocket' | 'webhook' | 'reconcile',
  ): Promise<void> {
    switch (event.type) {
      case 30011:
      case 30016:
        await this.onCallState(event.msg.call_id, event.msg.members, receivedAt);
        return;
      case 30012:
        await this.applyCdr(event.msg, source);
        return;
      case 30008:
        await this.onExtensionCallState(event.msg.extension, event.msg.status);
        return;
      case 30007:
        await this.onExtensionRegistration(event.msg.extension, event.msg.status);
        return;
      case 30013:
        await this.onTransfer(event.msg);
        return;
      case 30015:
        await this.onFailure(event.msg);
        return;
      default:
        return;
    }
  }

  // ── state persistence ────────────────────────────────────────────────────────────────

  async loadState(pbxCallId: string): Promise<LiveCallState | null> {
    const raw = await this.app.valkey.get(keyOf(pbxCallId));
    return raw ? (JSON.parse(raw) as LiveCallState) : null;
  }

  private async saveState(state: LiveCallState): Promise<void> {
    await this.app.valkey.set(keyOf(state.pbxCallId), JSON.stringify(state), 'EX', STATE_TTL_SEC);
  }

  private async deleteState(pbxCallId: string): Promise<void> {
    await this.app.valkey.del(keyOf(pbxCallId));
  }

  async liveCalls(): Promise<LiveCallState[]> {
    const out: LiveCallState[] = [];
    let cursor = '0';
    do {
      const [next, keys] = await this.app.valkey.scan(cursor, 'MATCH', 'cti:call:*', 'COUNT', 200);
      cursor = next;
      if (keys.length > 0) {
        const values = await this.app.valkey.mget(...keys);
        for (const v of values) if (v) out.push(JSON.parse(v) as LiveCallState);
      }
    } while (cursor !== '0');
    return out.sort((a, b) => a.firstEventAt.localeCompare(b.firstEventAt));
  }

  private async normalizeOptions(): Promise<NormalizeOptions> {
    const settings = await this.app.settings.getAll();
    return {
      defaultCountry: settings.defaultCountry as CountryCode,
      internalExtensionLength: settings.dialRules.internalExtensionLength,
    };
  }

  // ── contact matching ─────────────────────────────────────────────────────────────────

  private async matchContact(e164: string | null): Promise<{
    id: string;
    displayName: string;
    companyId: string | null;
    ownerId: string | null;
  } | null> {
    if (!e164) return null;
    const phone = await this.app.db.contactPhone.findFirst({
      where: { e164, deletedAt: null, contact: { deletedAt: null } },
      select: {
        contact: { select: { id: true, displayName: true, companyId: true, ownerId: true } },
      },
    });
    return phone?.contact ?? null;
  }

  // ── 30011 / 30016 ────────────────────────────────────────────────────────────────────

  private async onCallState(
    pbxCallId: string,
    members: YeastarMemberEntry[],
    receivedAt: Date,
  ): Promise<void> {
    const opts = await this.normalizeOptions();
    const classified = classifyMembers(members, opts);
    let state = await this.loadState(pbxCallId);
    const settings = await this.app.settings.getAll();

    if (!state) {
      if (classified.direction === 'internal' && !settings.popup.popOnInternalCalls) {
        // still create the call row for logging; the CDR finalizes it
        state = await this.initState(pbxCallId, classified, receivedAt, false);
      } else {
        state = await this.initState(pbxCallId, classified, receivedAt, true);
      }
    } else {
      // refresh external party if it appears later (e.g. 30016 → 30011)
      if (!state.externalRaw && classified.externalRaw) {
        state.externalRaw = classified.externalRaw;
        state.externalE164 = classified.external?.kind === 'e164' ? classified.external.e164 : null;
        state.externalDisplay = displayFor(classified.external, classified.externalRaw);
        state.direction = classified.direction;
        const contact = await this.matchContact(state.externalE164);
        state.contactId = contact?.id ?? null;
        state.contactName = contact?.displayName ?? null;
        await this.app.db.call
          .update({
            where: { id: state.crmCallId },
            data: {
              direction: state.direction,
              externalE164: state.externalE164,
              contactId: state.contactId,
              ...(state.direction === 'inbound'
                ? { fromNumber: state.externalRaw }
                : { toNumber: state.externalRaw }),
            },
          })
          .catch(() => undefined);
      }
      if (classified.trunkChannelId) state.trunkChannelId = classified.trunkChannelId;
      if (classified.callPath) state.callPath = classified.callPath;
    }

    const popup = classified.direction !== 'internal' || settings.popup.popOnInternalCalls;

    for (const leg of classified.extensions) {
      const prev = state.members[leg.channelId];
      state.members[leg.channelId] = {
        number: leg.number,
        status: leg.status,
        hold:
          leg.status === 'HOLD'
            ? true
            : leg.status === 'ANSWERED' || leg.status === 'ANSWER'
              ? false
              : (prev?.hold ?? false),
      };
      const mapped = leg.number ? await this.deps.extMap.lookup(leg.number) : null;

      if (IS_RINGING.has(leg.status) || (IS_TALKING.has(leg.status) && !prev)) {
        if (!state.ringingExtensions.includes(leg.number)) state.ringingExtensions.push(leg.number);
        if (popup && mapped && !state.poppedUsers.includes(mapped.userId)) {
          state.poppedUsers.push(mapped.userId);
          await this.emitRinging(state, mapped.userId, receivedAt);
        }
      }

      if (IS_TALKING.has(leg.status) && !state.answeredExtension && leg.number) {
        state.answeredExtension = leg.number;
        state.answeredUserId = mapped?.userId ?? null;
        state.answeredAt = nowIso();
        await this.app.db.call
          .update({
            where: { id: state.crmCallId },
            data: {
              status: 'answered',
              answeredAt: new Date(state.answeredAt),
              extension: leg.number,
              userId: mapped?.userId ?? null,
            },
          })
          .catch(() => undefined);
        for (const userId of state.poppedUsers) {
          if (userId === mapped?.userId) {
            this.app.realtime.to(rooms.user(userId)).emit('call:answered', {
              at: nowIso(),
              callId: state.crmCallId,
              pbxCallId,
              answeredByUserId: mapped.userId,
              answeredByExtension: leg.number,
              answeredAt: state.answeredAt,
            });
          } else {
            this.app.realtime.to(rooms.user(userId)).emit('call:cancelled', {
              at: nowIso(),
              callId: state.crmCallId,
              pbxCallId,
              reason: 'answered_elsewhere',
            });
          }
        }
        this.app.realtime.to([rooms.role('manager'), rooms.role('admin')]).emit('agent:presence', {
          at: nowIso(),
          userId: mapped?.userId ?? '00000000-0000-7000-8000-000000000000',
          extension: leg.number,
          registered: null,
          callState: 'busy',
        });
      }

      if (leg.status === 'HOLD' && prev && !prev.hold && mapped) {
        this.app.realtime
          .to(rooms.user(mapped.userId))
          .emit('call:updated', { at: nowIso(), callId: state.crmCallId, pbxCallId, hold: true });
      } else if (IS_TALKING.has(leg.status) && prev?.hold && mapped) {
        this.app.realtime
          .to(rooms.user(mapped.userId))
          .emit('call:updated', { at: nowIso(), callId: state.crmCallId, pbxCallId, hold: false });
      }
    }

    // end detection: trunk leg BYE, or every known extension leg BYE
    const extStatuses = Object.values(state.members).map((m) => m.status);
    const trunkBye = classified.trunkStatus === 'BYE';
    const allExtBye = extStatuses.length > 0 && extStatuses.every((s) => s === 'BYE');
    if (!state.ended && (trunkBye || allExtBye)) {
      state.ended = true;
      const reason = state.answeredExtension ? null : 'caller_hung_up';
      for (const userId of state.poppedUsers) {
        if (reason)
          this.app.realtime
            .to(rooms.user(userId))
            .emit('call:cancelled', { at: nowIso(), callId: state.crmCallId, pbxCallId, reason });
        else
          this.app.realtime.to(rooms.user(userId)).emit('call:ended', {
            at: nowIso(),
            callId: state.crmCallId,
            pbxCallId,
            endedAt: nowIso(),
          });
      }
    }

    await this.saveState(state);
    await this.broadcastLive();
  }

  private async initState(
    pbxCallId: string,
    c: ReturnType<typeof classifyMembers>,
    receivedAt: Date,
    _popup: boolean,
  ): Promise<LiveCallState> {
    const externalE164 = c.external?.kind === 'e164' ? c.external.e164 : null;
    const contact = await this.matchContact(externalE164);
    const crmCallId = newId();
    const originating = c.originatingExtension
      ? await this.deps.extMap.lookup(c.originatingExtension)
      : null;
    await this.app.db.call.create({
      data: {
        id: crmCallId,
        pbxCallId,
        direction: c.direction,
        status: 'ringing',
        fromNumber:
          c.direction === 'inbound' ? (c.externalRaw ?? '') : (c.originatingExtension ?? ''),
        toNumber: c.direction === 'inbound' ? (c.didNumber ?? '') : (c.externalRaw ?? ''),
        externalE164,
        contactId: contact?.id ?? null,
        userId: originating?.userId ?? null,
        extension: c.originatingExtension,
        trunkName: c.trunkName,
        didNumber: c.didNumber,
        callPath: c.callPath,
        startedAt: receivedAt,
      },
    });
    const state: LiveCallState = {
      pbxCallId,
      crmCallId,
      direction: c.direction,
      externalRaw: c.externalRaw,
      externalE164,
      externalDisplay: displayFor(c.external, c.externalRaw),
      contactId: contact?.id ?? null,
      contactName: contact?.displayName ?? null,
      didNumber: c.didNumber,
      trunkName: c.trunkName,
      callPath: c.callPath,
      trunkChannelId: c.trunkChannelId,
      members: {},
      poppedUsers: [],
      ringingExtensions: [],
      answeredExtension: null,
      answeredUserId: null,
      answeredAt: null,
      firstEventAt: receivedAt.toISOString(),
      ended: false,
    };
    return state;
  }

  /** Build and send the screen-pop payload (R-4.1). */
  private async emitRinging(state: LiveCallState, userId: string, receivedAt: Date): Promise<void> {
    const settings = await this.app.settings.getAll();
    let contact: ServerEventPayload<'call:ringing'>['contact'] = null;
    let recentActivity: ServerEventPayload<'call:ringing'>['recentActivity'] = [];
    let restricted = false;
    if (state.contactId) {
      const row = await this.app.db.contact.findUnique({
        where: { id: state.contactId },
        select: contactSummarySelect,
      });
      if (row) {
        const summary = contactToSummary(row);
        const user = await this.app.db.user.findUnique({
          where: { id: userId },
          select: { role: true, teamId: true },
        });
        const role = user?.role ?? 'agent';
        const isPrivileged = role.includes('admin') || role.includes('manager');
        restricted =
          !isPrivileged &&
          settings.agentVisibility === 'owned' &&
          summary.ownerId !== null &&
          summary.ownerId !== userId;
        contact = {
          id: summary.id,
          displayName: summary.displayName,
          company: summary.company,
          avatarUrl: summary.avatarUrl,
          ownerId: summary.ownerId,
          doNotCall: summary.doNotCall,
        };
        if (!restricted)
          recentActivity = (await this.app.activity.recentForContact(state.contactId, 5)).map(
            (a) => ({
              id: a.id,
              type: a.type,
              occurredAt: a.occurredAt,
              summary: a.summary,
              meta: a.meta,
            }),
          );
      }
    }
    let matchCandidates: { id: string; displayName: string }[] = [];
    if (!contact && state.externalE164 && settings.matching.allowSuffixMatch) {
      const suffix = state.externalE164.slice(-settings.matching.suffixLength);
      const rows = await this.app.db.contactPhone.findMany({
        where: { e164: { endsWith: suffix }, deletedAt: null, contact: { deletedAt: null } },
        select: { contact: { select: { id: true, displayName: true } } },
        take: 5,
      });
      matchCandidates = rows.map((r) => r.contact);
    }
    const capabilities = await this.deps.capabilities();
    const payload: ServerEventPayload<'call:ringing'> = {
      at: nowIso(),
      callId: state.crmCallId,
      pbxCallId: state.pbxCallId,
      direction: state.direction,
      callerNumber: state.externalE164,
      callerDisplay: state.externalDisplay,
      trunkName: state.trunkName,
      didNumber: state.didNumber,
      callPath: state.callPath,
      contact,
      matchCandidates,
      recentActivity,
      restricted,
      capabilities: {
        ...capabilities,
        decline:
          capabilities.decline && state.direction === 'inbound' && state.trunkChannelId !== null,
      },
    };
    this.app.realtime.to(rooms.user(userId)).emit('call:ringing', payload);
    this.deps.onPopLatency?.(Date.now() - receivedAt.getTime());
    if (state.direction === 'inbound') {
      await this.app.notifications.notify({
        userId,
        type: 'call_incoming',
        title: `Incoming call from ${contact?.displayName ?? state.externalDisplay}`,
        body: null,
        data: {
          callId: state.crmCallId,
          contactId: state.contactId,
          url: state.contactId ? `/contacts/${state.contactId}` : `/calls/${state.crmCallId}`,
        },
      });
    }
  }

  // ── 30012 CDR ────────────────────────────────────────────────────────────────────────

  /** Idempotent by `uid`; used by live events and reconciliation alike (docs/06 §13). */
  async applyCdr(
    cdr: YeastarCdr,
    source: 'websocket' | 'webhook' | 'reconcile',
  ): Promise<'inserted' | 'updated'> {
    const opts = await this.normalizeOptions();
    const settings = await this.app.settings.getAll();
    const state = await this.loadState(cdr.call_id);
    const existing =
      (await this.app.db.call.findUnique({ where: { pbxCdrUid: cdr.uid } })) ??
      (state
        ? await this.app.db.call.findUnique({ where: { id: state.crmCallId } })
        : await this.app.db.call.findFirst({
            where: { pbxCallId: cdr.call_id, pbxCdrUid: null },
            orderBy: { createdAt: 'desc' },
          }));

    const startedAt = parsePbxTime(cdr.time_start, this.deps.pbxTimeZone);
    const endedAt = new Date(startedAt.getTime() + cdr.call_duration * 1000);
    const answeredAt =
      cdr.talk_duration > 0 ? new Date(endedAt.getTime() - cdr.talk_duration * 1000) : null;
    const fromCdr = externalFromCdr(cdr, opts);
    const direction: Direction = state?.direction ?? fromCdr.direction;
    const externalRaw = state?.externalRaw ?? fromCdr.externalRaw;
    const externalE164 =
      state?.externalE164 ?? (externalRaw ? normalizeE164(externalRaw, opts) : null);
    const contactId =
      state?.contactId ??
      existing?.contactId ??
      (await this.matchContact(externalE164))?.id ??
      null;
    const extension = state?.answeredExtension ?? existing?.extension ?? fromCdr.extension;
    const mapped = extension ? await this.deps.extMap.lookup(extension) : null;
    const userId = state?.answeredUserId ?? existing?.userId ?? mapped?.userId ?? null;
    const status = mapCdrStatus(cdr.status, direction);
    const recordingStatus = cdr.recording
      ? existing?.recordingStatus === 'stored'
        ? 'stored'
        : 'pending'
      : 'none';

    const data = {
      pbxCallId: cdr.call_id,
      pbxCdrUid: cdr.uid,
      direction,
      status,
      fromNumber: cdr.call_from,
      toNumber: cdr.call_to,
      externalE164,
      contactId,
      userId,
      extension,
      trunkName:
        nonEmpty(cdr.src_trunk_name) ?? nonEmpty(cdr.dst_trunk_name) ?? state?.trunkName ?? null,
      didNumber: nonEmpty(cdr.did_number) ?? state?.didNumber ?? null,
      callPath: state?.callPath ?? existing?.callPath ?? null,
      startedAt,
      answeredAt,
      endedAt,
      ringDurationSec: Math.max(0, cdr.call_duration - cdr.talk_duration),
      talkDurationSec: cdr.talk_duration,
      totalDurationSec: cdr.call_duration,
      recordingFileName: cdr.recording || null,
      recordingStatus,
      pbxRawCdr: cdr as object,
    };

    let callId: string;
    let outcome: 'inserted' | 'updated';
    if (existing) {
      if (existing.pbxCdrUid === cdr.uid && source === 'reconcile') return 'updated';
      await this.app.db.call.update({ where: { id: existing.id }, data });
      callId = existing.id;
      outcome = 'updated';
    } else {
      callId = newId();
      await this.app.db.call.create({ data: { id: callId, ...data } });
      outcome = 'inserted';
    }

    // timeline row once per call (refId unique per call)
    const already = await this.app.db.activity.findFirst({
      where: { refTable: 'calls', refId: callId },
      select: { id: true },
    });
    if (!already) {
      const contact = contactId
        ? await this.app.db.contact.findUnique({
            where: { id: contactId },
            select: { companyId: true },
          })
        : null;
      await this.app.activity.record(this.app.db, {
        type: 'call',
        contactId,
        companyId: contact?.companyId ?? null,
        actorId: userId,
        occurredAt: startedAt,
        summary: summarizeCall(direction, status, cdr.talk_duration, externalRaw),
        refTable: 'calls',
        refId: callId,
        meta: {
          direction,
          status,
          talkDurationSec: cdr.talk_duration,
          totalDurationSec: cdr.call_duration,
          external: externalE164 ?? externalRaw,
          extension,
          recording: Boolean(cdr.recording),
          text: externalRaw ?? '',
        },
      });
    }

    if (cdr.recording && recordingStatus === 'pending') {
      await this.app.queues.add(
        QUEUES.recordingDownload,
        'download',
        { callId, fileName: cdr.recording },
        { jobId: `recording-${callId}`, delay: 5_000 },
      );
    }

    if (source !== 'reconcile') {
      const targets = new Set<string>([...(state?.poppedUsers ?? []), ...(userId ? [userId] : [])]);
      for (const target of targets) {
        this.app.realtime.to(rooms.user(target)).emit('call:logged', {
          at: nowIso(),
          callId,
          pbxCallId: cdr.call_id,
          status,
          talkDurationSec: cdr.talk_duration,
          totalDurationSec: cdr.call_duration,
          contactId,
          suggestFollowUp: settings.popup.suggestFollowUpAfterCall && status === 'completed',
          recordingStatus,
        });
      }
      if (
        direction === 'inbound' &&
        (status === 'missed' || status === 'abandoned' || status === 'voicemail')
      ) {
        const notifyUsers = new Set<string>(state?.poppedUsers ?? []);
        if (contactId) {
          const owner = await this.app.db.contact.findUnique({
            where: { id: contactId },
            select: { ownerId: true },
          });
          if (owner?.ownerId) notifyUsers.add(owner.ownerId);
        }
        const name =
          state?.contactName ?? (externalRaw ? displayFor(null, externalRaw) : 'Unknown');
        await this.app.notifications.notifyMany([...notifyUsers], {
          type: 'call_missed',
          title: `Missed call from ${name}`,
          body: null,
          data: { callId, contactId, url: `/calls/${callId}` },
        });
      }
      this.app.realtime.to([rooms.role('manager'), rooms.role('admin')]).emit('agent:presence', {
        at: nowIso(),
        userId: userId ?? '00000000-0000-7000-8000-000000000000',
        extension: extension ?? '',
        registered: null,
        callState: 'idle',
      });
    }

    await this.deleteState(cdr.call_id);
    await this.app.valkey.set('cti:last_cdr_at', endedAt.toISOString());
    await this.broadcastLive();
    return outcome;
  }

  // ── other events ─────────────────────────────────────────────────────────────────────

  private async onExtensionCallState(extension: string, status: string): Promise<void> {
    const mapped = await this.deps.extMap.lookup(extension);
    if (!mapped) return;
    const s = status.toUpperCase();
    const callState = IS_RINGING.has(s)
      ? 'ringing'
      : IS_TALKING.has(s) || s === 'HOLD' || s === 'BUSY' || s === 'INUSE'
        ? 'busy'
        : 'idle';
    this.app.realtime.to([rooms.role('manager'), rooms.role('admin')]).emit('agent:presence', {
      at: nowIso(),
      userId: mapped.userId,
      extension,
      registered: null,
      callState,
    });
  }

  private async onExtensionRegistration(extension: string, status: string): Promise<void> {
    const mapped = await this.deps.extMap.lookup(extension);
    if (!mapped) return;
    const registered =
      /registered|online|ok/i.test(status) && !/unregistered|offline/i.test(status);
    this.app.realtime
      .to([rooms.role('manager'), rooms.role('admin'), rooms.user(mapped.userId)])
      .emit('agent:presence', {
        at: nowIso(),
        userId: mapped.userId,
        extension,
        registered,
        callState: 'idle',
      });
  }

  private async onTransfer(msg: Record<string, unknown>): Promise<void> {
    const callId = typeof msg.call_id === 'string' ? msg.call_id : null;
    if (!callId) return;
    const state = await this.loadState(callId);
    const to =
      typeof msg.transfer_to === 'string'
        ? msg.transfer_to
        : typeof msg.to === 'string'
          ? msg.to
          : undefined;
    if (state && to) {
      for (const userId of state.poppedUsers)
        this.app.realtime.to(rooms.user(userId)).emit('call:updated', {
          at: nowIso(),
          callId: state.crmCallId,
          pbxCallId: callId,
          transferredTo: to,
        });
      await this.app.db.call
        .update({
          where: { id: state.crmCallId },
          data: { callPath: [state.callPath, `transfer→${to}`].filter(Boolean).join(' ') },
        })
        .catch(() => undefined);
    }
  }

  private async onFailure(msg: Record<string, unknown>): Promise<void> {
    const callId = typeof msg.call_id === 'string' ? msg.call_id : null;
    if (!callId) return;
    const state = await this.loadState(callId);
    if (!state) return;
    await this.app.db.call
      .update({ where: { id: state.crmCallId }, data: { status: 'failed', endedAt: new Date() } })
      .catch(() => undefined);
    for (const userId of state.poppedUsers)
      this.app.realtime.to(rooms.user(userId)).emit('call:cancelled', {
        at: nowIso(),
        callId: state.crmCallId,
        pbxCallId: callId,
        reason: 'timeout',
      });
    await this.deleteState(callId);
  }

  private async broadcastLive(): Promise<void> {
    const calls = await this.liveCalls();
    this.app.realtime.to([rooms.role('manager'), rooms.role('admin')]).emit('live-calls:snapshot', {
      at: nowIso(),
      calls: calls.map((c) => ({
        pbxCallId: c.pbxCallId,
        direction: c.direction,
        external: c.externalE164 ?? c.externalRaw,
        extension: c.answeredExtension ?? c.ringingExtensions[0] ?? null,
        userName: null,
        status: c.ended ? 'ended' : c.answeredExtension ? 'talking' : 'ringing',
        since: c.firstEventAt,
      })),
    });
  }
}

function nonEmpty(value: string | undefined): string | undefined {
  return value === undefined || value === '' ? undefined : value;
}

function extractCallId(event: { msg?: unknown }): string | null {
  const msg = event.msg;
  if (msg && typeof msg === 'object' && 'call_id' in msg && typeof msg.call_id === 'string')
    return (msg as { call_id: string }).call_id;
  return null;
}

function normalizeE164(raw: string, opts: NormalizeOptions): string | null {
  const n = normalizePhoneSafe(raw, opts);
  return n?.kind === 'e164' ? n.e164 : null;
}

function normalizePhoneSafe(raw: string, opts: NormalizeOptions) {
  // lazy import to keep this module free of a top-level shared import cycle
  return classifyMembers([{ inbound: { from: raw, channel_id: 'x', member_status: 'RING' } }], opts)
    .external;
}

export function mapCdrStatus(status: string, direction: Direction): CallStatus {
  switch (status.toUpperCase()) {
    case 'ANSWERED':
      return 'completed';
    case 'NO ANSWER':
    case 'NOANSWER':
      return direction === 'outbound' ? 'failed' : 'missed';
    case 'BUSY':
      return 'busy';
    case 'VOICEMAIL':
      return 'voicemail';
    case 'ABANDONED':
      return 'abandoned';
    default:
      return direction === 'outbound' ? 'failed' : 'missed';
  }
}

function summarizeCall(
  direction: Direction,
  status: CallStatus,
  talk: number,
  external: string | null,
): string {
  const who = external ?? 'internal';
  const mins = Math.floor(talk / 60);
  const secs = talk % 60;
  const dur = talk > 0 ? ` (${mins}m ${secs}s)` : '';
  const label =
    direction === 'inbound'
      ? 'Inbound call from'
      : direction === 'outbound'
        ? 'Outbound call to'
        : 'Internal call with';
  return `${label} ${who} — ${status}${dur}`;
}
