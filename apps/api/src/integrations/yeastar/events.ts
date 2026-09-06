/**
 * Zod schemas for the Yeastar P-Series Open API events we consume (docs/06 §7).
 * Shapes follow the vendor developer guide; unknown extra fields are allowed (`loose`) so a
 * firmware update that adds fields does not break parsing.
 */
import { z } from 'zod';

export const YEASTAR_EVENT = {
  extensionRegistration: 30007,
  extensionCallState: 30008,
  extensionPresence: 30009,
  trunkRegistration: 30010,
  callStateChanged: 30011,
  callEndDetails: 30012,
  callTransfer: 30013,
  callForward: 30014,
  callFailure: 30015,
  incomingCallRequest: 30016,
  recordingDownloadCompleted: 30033,
  newMessage: 30031,
  messageSendingResult: 30032,
  messageRead: 30038,
} as const;

export const SUBSCRIBED_TOPICS = [
  YEASTAR_EVENT.extensionRegistration,
  YEASTAR_EVENT.extensionCallState,
  YEASTAR_EVENT.callStateChanged,
  YEASTAR_EVENT.callEndDetails,
  YEASTAR_EVENT.callTransfer,
  YEASTAR_EVENT.callFailure,
  YEASTAR_EVENT.incomingCallRequest,
  YEASTAR_EVENT.recordingDownloadCompleted,
] as const;

export const memberStatus = z
  .enum(['ALERT', 'RING', 'ANSWERED', 'ANSWER', 'HOLD', 'BYE', 'EARLYMEDIA'])
  .or(z.string());

const member = z
  .object({
    number: z.string().optional(),
    from: z.string().optional(),
    to: z.string().optional(),
    trunk_name: z.string().optional(),
    channel_id: z.string(),
    member_status: memberStatus,
    call_path: z.string().optional(),
  })
  .loose();
export type YeastarMember = z.infer<typeof member>;

export const memberEntry = z
  .object({
    extension: member.optional(),
    inbound: member.optional(),
    outbound: member.optional(),
    internal: member.optional(),
  })
  .loose();
export type YeastarMemberEntry = z.infer<typeof memberEntry>;

const callMsg = z.object({ call_id: z.string(), members: z.array(memberEntry) }).loose();

export const callStateChangedEvent = z
  .object({ type: z.literal(30011), sn: z.string().optional(), msg: callMsg })
  .loose();
export const incomingCallRequestEvent = z
  .object({ type: z.literal(30016), sn: z.string().optional(), msg: callMsg })
  .loose();

export const cdrMsg = z
  .object({
    call_id: z.string(),
    time_start: z.string(),
    call_from: z.string(),
    call_to: z.string(),
    call_duration: z.coerce.number().int().nonnegative(),
    talk_duration: z.coerce.number().int().nonnegative(),
    src_trunk_name: z.string().optional().default(''),
    dst_trunk_name: z.string().optional().default(''),
    pin_code: z.string().optional(),
    status: z.string(),
    type: z.string(),
    recording: z.string().optional().default(''),
    did_number: z.string().optional().default(''),
    did_name: z.string().optional(),
    agent_ring_time: z.coerce.number().int().optional(),
    uid: z.string(),
    call_note_id: z.string().optional(),
    enb_call_note: z.coerce.number().optional(),
    is_display: z.coerce.number().optional(),
  })
  .loose();
export type YeastarCdr = z.infer<typeof cdrMsg>;

export const callEndDetailsEvent = z
  .object({ type: z.literal(30012), sn: z.string().optional(), msg: cdrMsg })
  .loose();

export const extensionCallStateEvent = z
  .object({
    type: z.literal(30008),
    sn: z.string().optional(),
    msg: z.object({ extension: z.string(), status: z.string() }).loose(),
  })
  .loose();
export const extensionRegistrationEvent = z
  .object({
    type: z.literal(30007),
    sn: z.string().optional(),
    msg: z.object({ extension: z.string(), status: z.string() }).loose(),
  })
  .loose();
export const callTransferEvent = z
  .object({
    type: z.literal(30013),
    sn: z.string().optional(),
    msg: z.record(z.string(), z.unknown()),
  })
  .loose();
export const callFailureEvent = z
  .object({
    type: z.literal(30015),
    sn: z.string().optional(),
    msg: z.record(z.string(), z.unknown()),
  })
  .loose();
export const genericEvent = z
  .object({ type: z.number().int(), sn: z.string().optional(), msg: z.unknown() })
  .loose();

/** Events with a handler. Anything else parses as `genericEvent` and is only archived. */
export const knownEvent = z.discriminatedUnion('type', [
  callStateChangedEvent,
  incomingCallRequestEvent,
  callEndDetailsEvent,
  extensionCallStateEvent,
  extensionRegistrationEvent,
  callTransferEvent,
  callFailureEvent,
]);
export type YeastarEvent = z.infer<typeof knownEvent>;

/** Yeastar timestamps are PBX-local "YYYY-MM-DD HH:mm:ss"; convert with the PBX time zone. */
export function parsePbxTime(value: string, timeZone: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/.exec(value.trim());
  if (!m) {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? new Date() : d;
  }
  const [, y, mo, d, h, mi, s] = m.map(Number) as [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  // find the UTC instant whose wall-clock time in `timeZone` equals the given components
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  const offset = tzOffsetMs(guess, timeZone);
  return new Date(guess - offset);
}

function tzOffsetMs(utcMs: number, timeZone: string): number {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(new Date(utcMs)).map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return asUtc - utcMs;
}
