import { z } from 'zod';
import { CallDirection, CallStatus, RecordingStatus, valuesOf } from '../enums.js';
import { isoDateTime, paginationOffset, phoneInput, sortParam, uuid } from './common.js';
import { userRef } from './company.js';

export const callDispositionDto = z.object({
  id: uuid,
  name: z.string(),
  sortOrder: z.number().int(),
  isActive: z.boolean(),
  isSystem: z.boolean(),
});
export const createDispositionBody = z.object({ name: z.string().trim().min(1).max(60) }).strict();
export const updateDispositionBody = z
  .object({
    name: z.string().trim().min(1).max(60).optional(),
    isActive: z.boolean().optional(),
    sortOrder: z.number().int().min(0).optional(),
  })
  .strict();

export const callDto = z.object({
  id: uuid,
  pbxCallId: z.string(),
  direction: z.enum(valuesOf(CallDirection)),
  status: z.enum(valuesOf(CallStatus)),
  fromNumber: z.string(),
  toNumber: z.string(),
  externalNumber: z.string().nullable(),
  externalDisplay: z.string().nullable(),
  contact: z.object({ id: uuid, displayName: z.string() }).nullable(),
  contactId: uuid.nullable(),
  user: userRef.nullable(),
  userId: uuid.nullable(),
  extension: z.string().nullable(),
  trunkName: z.string().nullable(),
  didNumber: z.string().nullable(),
  callPath: z.string().nullable(),
  startedAt: isoDateTime,
  answeredAt: isoDateTime.nullable(),
  endedAt: isoDateTime.nullable(),
  ringDurationSec: z.number().int().nullable(),
  talkDurationSec: z.number().int().nullable(),
  totalDurationSec: z.number().int().nullable(),
  disposition: z.object({ id: uuid, name: z.string() }).nullable(),
  dispositionNote: z.string().nullable(),
  recordingStatus: z.enum(valuesOf(RecordingStatus)),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});
export type CallDto = z.infer<typeof callDto>;

export const CALL_SORT = ['startedAt', 'talkDurationSec', 'totalDurationSec'] as const;
/** Who has played a call's recording, most recent first (formerly GAP-12). */
export const recordingHistoryEntryDto = z.object({
  at: isoDateTime,
  actor: userRef.nullable(),
});
export type RecordingHistoryEntryDto = z.infer<typeof recordingHistoryEntryDto>;

export const listCallsQuery = paginationOffset.extend({
  direction: z.enum(valuesOf(CallDirection)).optional(),
  status: z.enum(valuesOf(CallStatus)).optional(),
  userId: uuid.optional(),
  mine: z.enum(['true', 'false']).optional(),
  contactId: uuid.optional(),
  /** Every call whose contact belongs to this company. */
  companyId: uuid.optional(),
  unmatched: z.enum(['true']).optional(),
  hasRecording: z.enum(['true', 'false']).optional(),
  number: z.string().trim().max(32).optional(),
  from: isoDateTime.optional(),
  to: isoDateTime.optional(),
  sort: sortParam(CALL_SORT),
});

export const dialBody = z
  .object({
    contactId: uuid.optional(),
    phoneId: uuid.optional(),
    number: phoneInput.optional(),
    /**
     * Redial: the server takes the number and the contact from the call itself.
     *
     * A call's number is often not one of its contact's saved phones, because somebody linked a call
     * from an unsaved number to a contact, or the number changed afterwards. Sending the pair back
     * as a number and a contact asks the server to trust a claim it cannot check; sending the call
     * asks it to look one up. It is click to call from a record either way, not the keypad.
     */
    callId: uuid.optional(),
  })
  .strict()
  .refine((v) => v.phoneId !== undefined || v.number !== undefined || v.callId !== undefined, {
    message: 'phoneId, number or callId is required',
    path: ['number'],
  });
export type DialBody = z.infer<typeof dialBody>;

export const dialResult = z.object({ callId: uuid, pbxCallId: z.string(), callee: z.string() });

export const dispositionBody = z
  .object({
    dispositionId: uuid.nullable(),
    note: z.string().trim().max(2000).nullable().optional(),
  })
  .strict();

export const linkContactBody = z.object({ contactId: uuid }).strict();

export const callControlBody = z
  .object({
    action: z.enum(['hangup', 'hold', 'unhold', 'mute', 'unmute', 'transfer', 'answer', 'decline']),
    number: phoneInput.optional(),
    transferType: z.enum(['blind', 'attended']).default('blind'),
  })
  .strict()
  .refine((v) => (v.action === 'transfer' ? v.number !== undefined : true), {
    message: 'number is required for transfer',
    path: ['number'],
  });
export type CallControlBody = z.infer<typeof callControlBody>;

export const ctiCapabilitiesDto = z.object({
  enabled: z.boolean(),
  answer: z.enum(['none', 'api', 'webrtc']),
  decline: z.boolean(),
  hangup: z.boolean(),
  hold: z.boolean(),
  mute: z.boolean(),
  transfer: z.boolean(),
  dial: z.boolean(),
  myExtension: z.string().nullable(),
});

export const ctiStatusDto = z.object({
  enabled: z.boolean(),
  connected: z.boolean(),
  leader: z.string().nullable(),
  since: isoDateTime.nullable(),
  lastEventAt: isoDateTime.nullable(),
  tokenExpiresAt: isoDateTime.nullable(),
  lastReconcileAt: isoDateTime.nullable(),
  eventSource: z.string(),
  liveCalls: z.number().int(),
});

export const liveCallDto = z.object({
  pbxCallId: z.string(),
  callId: uuid.nullable(),
  direction: z.enum(valuesOf(CallDirection)),
  external: z.string().nullable(),
  extension: z.string().nullable(),
  userName: z.string().nullable(),
  contactName: z.string().nullable(),
  status: z.string(),
  since: isoDateTime,
});

/**
 * Which CRM user is which PBX extension, worked out from email (docs/06 §18).
 *
 * The same rule Yeastar's own CRM integration uses: an extension and a user with the same email
 * address are the same person. What the report lists is everything that rule could not settle on
 * its own, so somebody can settle it by hand.
 */
export const extensionLinkConflictDto = z.object({
  kind: z.enum(['extension_taken', 'extension_differs', 'ambiguous_email', 'extension_not_on_pbx']),
  userId: uuid.nullable(),
  userName: z.string().nullable(),
  userEmail: z.string().nullable(),
  /** What the CRM user currently has. */
  extension: z.string().nullable(),
  /** What the PBX says that person's email is on. */
  pbxExtension: z.string().nullable(),
  detail: z.string(),
});
export const extensionLinkReportDto = z.object({
  ranAt: isoDateTime,
  pbxExtensions: z.number().int(),
  /** Already consistent: same email, same extension, nothing to do. */
  matched: z.number().int(),
  assigned: z.array(z.object({ userId: uuid, userName: z.string(), extension: z.string() })),
  conflicts: z.array(extensionLinkConflictDto),
  unmatchedExtensions: z.array(
    z.object({ number: z.string(), name: z.string().nullable(), email: z.string().nullable() }),
  ),
  usersWithoutExtension: z.array(
    z.object({ userId: uuid, userName: z.string(), email: z.string() }),
  ),
});
export type ExtensionLinkReport = z.infer<typeof extensionLinkReportDto>;

export const reconcileBody = z.object({ since: isoDateTime.optional() }).strict();
export const reconcileResult = z.object({
  scanned: z.number().int(),
  inserted: z.number().int(),
  updated: z.number().int(),
  since: isoDateTime,
});

export const linkusSignDto = z.object({
  sign: z.string(),
  username: z.string(),
  pbxUrl: z.string(),
  expiresInSec: z.number().int(),
});
