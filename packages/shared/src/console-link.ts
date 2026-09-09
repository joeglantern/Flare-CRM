/**
 * Contract between a customer stack and the owner console (docs/21).
 *
 * The stack opens one outbound Socket.IO connection to the console's `/link` namespace,
 * authenticated with its stack id and secret. It introduces itself, sends a heartbeat every
 * thirty seconds, and acknowledges every entitlements document it is handed. The console never
 * connects inbound to a stack. Owner browsers receive fleet updates on the console's default
 * namespace.
 */
import { z } from 'zod';
import { signedEnvelope } from './entitlements.js';
import { isoDateTime } from './schemas/common.js';

export const LINK_PROTOCOL = 1 as const;

const stackId = z.string().regex(/^stk_[a-z2-7]{20}$/, 'Expected a stack id');
const issueId = z.string().regex(/^iss_[0-9a-f-]{36}$/, 'Expected an issue id');

/** What the stack knows about its current document, echoed so the console can reconcile. */
const currentEntitlements = z.object({
  issueId: issueId.nullable(),
  issuedAt: isoDateTime.nullable(),
  keyId: z.string().nullable(),
});

export const readinessSummary = z.object({
  ok: z.boolean(),
  checks: z.record(
    z.string(),
    z.object({ ok: z.boolean(), error: z.string().max(300).optional() }),
  ),
});

export const stackUsage = z.object({
  seatsActive: z.number().int().min(0),
  storageBytes: z.number().int().min(0),
  attachmentsBytes: z.number().int().min(0),
  recordingsBytes: z.number().int().min(0),
  backupsBytes: z.number().int().min(0),
});

export const stackToConsoleEvents = {
  hello: z.object({
    stackId,
    protocol: z.literal(LINK_PROTOCOL),
    version: z.string().min(1).max(64),
    domain: z.string().min(1).max(253),
    startedAt: isoDateTime,
    entitlements: currentEntitlements,
  }),
  heartbeat: z.object({
    at: isoDateTime,
    version: z.string().min(1).max(64),
    ready: readinessSummary,
    usage: stackUsage,
    lastBackupAt: isoDateTime.nullable(),
    entitlements: currentEntitlements,
  }),
  ack: z.object({
    issueId,
    appliedAt: isoDateTime,
    result: z.enum(['applied', 'rejected']),
    reason: z.string().max(300).optional(),
  }),
} as const;

export const consoleToStackEvents = {
  entitlements: z.object({ envelope: signedEnvelope, issueId }),
  announce: z.object({
    message: z.string().trim().min(1).max(500),
    level: z.enum(['info', 'warning', 'error']),
  }),
  ping: z.object({ at: isoDateTime }),
} as const;

export const ISSUE_STATUSES = ['pending', 'delivered', 'acked', 'rejected', 'superseded'] as const;
export type IssueStatus = (typeof ISSUE_STATUSES)[number];

/** Console to owner browsers, on the console's default namespace. */
export const consoleServerEvents = {
  'fleet:stack': z.object({
    at: isoDateTime,
    customerId: z.string(),
    stackId,
    connected: z.boolean(),
    lastSeenAt: isoDateTime.nullable(),
    version: z.string().nullable(),
    usage: stackUsage.nullable(),
    readyOk: z.boolean().nullable(),
    lastBackupAt: isoDateTime.nullable(),
  }),
  'issue:status': z.object({
    at: isoDateTime,
    customerId: z.string(),
    stackId,
    issueId,
    status: z.enum(ISSUE_STATUSES),
    reason: z.string().nullable(),
  }),
} as const;

/** REST catch-up used once at worker boot, before the socket is up. */
export const linkEntitlementsResponse = z.object({ issueId, envelope: signedEnvelope }).nullable();
export const linkAckBody = stackToConsoleEvents.ack;

export type StackToConsoleEventName = keyof typeof stackToConsoleEvents;
export type StackToConsolePayload<E extends StackToConsoleEventName> = z.infer<
  (typeof stackToConsoleEvents)[E]
>;
export type ConsoleToStackEventName = keyof typeof consoleToStackEvents;
export type ConsoleToStackPayload<E extends ConsoleToStackEventName> = z.infer<
  (typeof consoleToStackEvents)[E]
>;
export type ConsoleServerEventName = keyof typeof consoleServerEvents;
export type ConsoleServerPayload<E extends ConsoleServerEventName> = z.infer<
  (typeof consoleServerEvents)[E]
>;

/** Socket.IO typed maps. The stack emits the first, listens to the second. */
export type StackToConsole = {
  [E in StackToConsoleEventName]: (payload: StackToConsolePayload<E>) => void;
};
export type ConsoleToStack = {
  [E in ConsoleToStackEventName]: E extends 'entitlements'
    ? (payload: ConsoleToStackPayload<E>, ack: (reply: { received: true }) => void) => void
    : (payload: ConsoleToStackPayload<E>) => void;
};
export type ConsoleToOwner = {
  [E in ConsoleServerEventName]: (payload: ConsoleServerPayload<E>) => void;
};

export const stackIdSchema = stackId;
export const issueIdSchema = issueId;
