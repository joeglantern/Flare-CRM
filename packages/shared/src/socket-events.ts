/**
 * Socket.IO event contract (docs/10). Every payload is a Zod schema so the worker
 * can assert in dev/test and the web gets exact types.
 */
import { z } from 'zod';
import { CallDirection, CallStatus, RecordingStatus, valuesOf } from './enums.js';
import { uuid } from './schemas/common.js';

const at = z.iso.datetime({ offset: true });

export const activitySummary = z.object({
  id: uuid,
  type: z.string(),
  occurredAt: at,
  summary: z.string(),
  meta: z.record(z.string(), z.unknown()),
});

export const popupContact = z.object({
  id: uuid,
  displayName: z.string(),
  company: z.object({ id: uuid, name: z.string() }).nullable(),
  avatarUrl: z.string().nullable(),
  ownerId: uuid.nullable(),
  doNotCall: z.boolean(),
});

export const serverEvents = {
  'call:ringing': z.object({
    at,
    callId: uuid.nullable(),
    pbxCallId: z.string(),
    direction: z.enum(valuesOf(CallDirection)),
    callerNumber: z.string().nullable(),
    callerDisplay: z.string(),
    trunkName: z.string().nullable(),
    didNumber: z.string().nullable(),
    callPath: z.string().nullable(),
    contact: popupContact.nullable(),
    matchCandidates: z.array(z.object({ id: uuid, displayName: z.string() })),
    recentActivity: z.array(activitySummary).max(5),
    restricted: z.boolean(),
    capabilities: z.object({
      answer: z.enum(['none', 'api', 'webrtc']),
      decline: z.boolean(),
      hangup: z.boolean(),
      hold: z.boolean(),
      mute: z.boolean(),
      transfer: z.boolean(),
    }),
  }),
  'call:answered': z.object({
    at,
    callId: uuid.nullable(),
    pbxCallId: z.string(),
    answeredByUserId: uuid.nullable(),
    answeredByExtension: z.string(),
    answeredAt: at,
  }),
  'call:cancelled': z.object({
    at,
    callId: uuid.nullable(),
    pbxCallId: z.string(),
    reason: z.enum(['answered_elsewhere', 'caller_hung_up', 'timeout']),
  }),
  'call:updated': z.object({
    at,
    callId: uuid.nullable(),
    pbxCallId: z.string(),
    hold: z.boolean().optional(),
    muted: z.boolean().optional(),
    transferredTo: z.string().optional(),
  }),
  'call:ended': z.object({ at, callId: uuid.nullable(), pbxCallId: z.string(), endedAt: at }),
  'call:logged': z.object({
    at,
    callId: uuid,
    pbxCallId: z.string(),
    status: z.enum(valuesOf(CallStatus)),
    talkDurationSec: z.number().int().nullable(),
    totalDurationSec: z.number().int().nullable(),
    contactId: uuid.nullable(),
    suggestFollowUp: z.boolean(),
    recordingStatus: z.enum(valuesOf(RecordingStatus)),
  }),
  'call:recording': z.object({
    at,
    callId: uuid,
    recordingStatus: z.enum(valuesOf(RecordingStatus)),
  }),
  'call:dialing': z.object({ at, callId: uuid, pbxCallId: z.string(), callee: z.string() }),
  'live-calls:snapshot': z.object({
    at,
    calls: z.array(
      z.object({
        pbxCallId: z.string(),
        direction: z.enum(valuesOf(CallDirection)),
        external: z.string().nullable(),
        extension: z.string().nullable(),
        userName: z.string().nullable(),
        status: z.string(),
        since: at,
      }),
    ),
  }),
  'agent:presence': z.object({
    at,
    userId: uuid,
    extension: z.string(),
    registered: z.boolean().nullable(),
    callState: z.enum(['idle', 'ringing', 'busy']),
  }),
  'pbx:status': z.object({
    at,
    connected: z.boolean(),
    since: at.nullable(),
    lastEventAt: at.nullable(),
  }),
  'message:new': z.object({
    at,
    conversationId: uuid,
    messageId: uuid,
    channelType: z.string(),
    contact: z.object({ id: uuid, displayName: z.string() }).nullable(),
    preview: z.string(),
    direction: z.enum(['inbound', 'outbound']),
  }),
  'message:status': z.object({
    at,
    messageId: uuid,
    status: z.string(),
    errorMessage: z.string().nullable(),
  }),
  'conversation:updated': z.object({
    at,
    conversationId: uuid,
    status: z.string(),
    assigneeId: uuid.nullable(),
    unreadCount: z.number().int(),
  }),
  'notification:new': z.object({
    at,
    id: uuid,
    type: z.string(),
    title: z.string(),
    body: z.string().nullable(),
    data: z.record(z.string(), z.unknown()),
    createdAt: at,
  }),
  'task:reminder': z.object({ at, taskId: uuid, title: z.string(), dueAt: at.nullable() }),
  'deal:stage': z.object({
    at,
    dealId: uuid,
    title: z.string(),
    fromStage: z.string().nullable(),
    toStage: z.string(),
    byUserId: uuid.nullable(),
  }),
  'entity:changed': z.object({
    at,
    type: z.string(),
    id: uuid,
    updatedAt: at,
    byUserId: uuid.nullable(),
  }),
  'system:announce': z.object({
    at,
    level: z.enum(['info', 'warning', 'error']),
    message: z.string(),
  }),
} as const;

export type ServerEventName = keyof typeof serverEvents;
export type ServerEventPayload<E extends ServerEventName> = z.infer<(typeof serverEvents)[E]>;
export type ServerToClientEvents = {
  [E in ServerEventName]: (payload: ServerEventPayload<E>) => void;
};

export const clientEvents = {
  'conv:join': z.object({ conversationId: uuid }),
  'conv:leave': z.object({ conversationId: uuid }),
  'entity:watch': z.object({ type: z.string().max(40), id: uuid }),
  'entity:unwatch': z.object({ type: z.string().max(40), id: uuid }),
  'presence:ping': z.object({}).optional(),
} as const;

export type ClientEventName = keyof typeof clientEvents;
export type ClientEventPayload<E extends ClientEventName> = z.infer<(typeof clientEvents)[E]>;
export type ClientToServerEvents = {
  [E in ClientEventName]: (payload: ClientEventPayload<E>) => void;
};

export function assertServerEvent<E extends ServerEventName>(
  name: E,
  payload: unknown,
): ServerEventPayload<E> {
  return serverEvents[name].parse(payload) as ServerEventPayload<E>;
}
