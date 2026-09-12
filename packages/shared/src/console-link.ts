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

/**
 * A support action the provider performs on a customer's stack, at that customer's request.
 *
 * Three actions and no more. None of them reads a customer's business data: the list carries only
 * who can sign in, and the other two unlock somebody who is stuck. Every one is audited in the
 * console and again inside the customer's own CRM, where it names the provider, so nobody can do
 * this quietly.
 */
export const SUPPORT_ACTIONS = ['list-users', 'reset-two-factor', 'revoke-sessions'] as const;
export type SupportAction = (typeof SUPPORT_ACTIONS)[number];

const commandId = z.string().regex(/^cmd_[0-9a-f-]{36}$/, 'Expected a command id');

export const supportCommand = z.object({
  commandId,
  action: z.enum(SUPPORT_ACTIONS),
  /** Which person, for the two actions that need one. Absent for list-users. */
  email: z.string().max(254).optional(),
  /** Who asked for it, carried into the customer's audit row. */
  requestedBy: z.string().max(120),
  reason: z.string().max(300).optional(),
});
export type SupportCommand = z.infer<typeof supportCommand>;

/** What the stack found: enough to pick a person, and nothing about their work. */
export const supportUser = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  role: z.string(),
  isActive: z.boolean(),
  twoFactorEnabled: z.boolean(),
  lastSeenAt: isoDateTime.nullable(),
});
export type SupportUser = z.infer<typeof supportUser>;

export const supportResult = z.object({
  commandId,
  action: z.enum(SUPPORT_ACTIONS),
  ok: z.boolean(),
  message: z.string().max(300).optional(),
  users: z.array(supportUser).optional(),
});
export type SupportResult = z.infer<typeof supportResult>;

/**
 * Facts the console may ask a stack for, and nothing it may change (docs/21 §9).
 *
 * This is a fourth door beside the three support actions, and it is deliberately the narrowest of
 * the four: the answer is counts, states and timestamps about the installation itself. Nothing here
 * names a person, a company, a call or a deal, and asking costs the customer nothing but a query.
 *
 * The readiness checks come back in full, with their detail, which the heartbeat's summary throws
 * away. That detail is the difference between "storage is failing" and "the bucket is unreachable
 * from this host", and it is the whole reason for asking rather than reading the last heartbeat.
 */
export const diagnosticsCheck = z.object({
  ok: z.boolean(),
  detail: z.record(z.string(), z.unknown()).optional(),
  error: z.string().max(300).optional(),
});

/** One background queue's backlog. A number that keeps climbing is the shape of a stuck worker. */
export const queueBacklog = z.object({
  queue: z.string().max(40),
  waiting: z.number().int().min(0),
  active: z.number().int().min(0),
  delayed: z.number().int().min(0),
  failed: z.number().int().min(0),
});

export const diagnosticsRequest = z.object({
  commandId,
  /** Who asked, carried into the customer's own audit row exactly as a support action is. */
  requestedBy: z.string().max(120),
});
export type DiagnosticsRequest = z.infer<typeof diagnosticsRequest>;

export const diagnostics = z.object({
  commandId,
  ok: z.boolean(),
  message: z.string().max(300).optional(),
  facts: z
    .object({
      version: z.string().max(64),
      uptimeSeconds: z.number().int().min(0),
      /**
       * Whether the schema is where the code expects it. A stack running old migrations is the
       * quiet fault behind a surprising number of loud ones.
       */
      migrations: z.object({
        applied: z.number().int().min(0),
        pending: z.number().int().min(0),
        failed: z.number().int().min(0),
        latest: z.string().max(200).nullable(),
        latestAppliedAt: isoDateTime.nullable(),
      }),
      queues: z.array(queueBacklog),
      /** Switched on or off, and reachable or not. Never a credential or an endpoint. */
      integrations: z.object({
        telephony: z.object({ enabled: z.boolean(), connected: z.boolean() }),
        whatsapp: z.object({ enabled: z.boolean(), channels: z.number().int().min(0) }),
      }),
      counts: z.object({
        channels: z.number().int().min(0),
        pipelines: z.number().int().min(0),
        seats: z.number().int().min(0),
      }),
      storage: z.object({
        usedBytes: z.number().int().min(0),
        attachmentsBytes: z.number().int().min(0),
        recordingsBytes: z.number().int().min(0),
        backupsBytes: z.number().int().min(0),
        refreshedAt: isoDateTime.nullable(),
      }),
      recordingRetentionDays: z.object({
        configured: z.number().int().nullable(),
        effective: z.number().int().nullable(),
      }),
      checks: z.record(z.string(), diagnosticsCheck),
    })
    .optional(),
});
export type Diagnostics = z.infer<typeof diagnostics>;

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
  commandResult: supportResult,
  diagnosticsResult: diagnostics,
} as const;

export const consoleToStackEvents = {
  entitlements: z.object({ envelope: signedEnvelope, issueId }),
  announce: z.object({
    message: z.string().trim().min(1).max(500),
    level: z.enum(['info', 'warning', 'error']),
  }),
  /** Asks for a heartbeat now rather than at the next thirty second tick. */
  ping: z.object({ at: isoDateTime }),
  command: supportCommand,
  /** Asks the stack to describe itself. It changes nothing over there. */
  diagnose: diagnosticsRequest,
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
  /** An alert opened or resolved, so an owner watching the console sees it without a refresh. */
  'alert:changed': z.object({
    at: isoDateTime,
    id: z.string(),
    kind: z.string(),
    level: z.enum(['info', 'warning', 'danger']),
    customerId: z.string(),
    customerName: z.string(),
    open: z.boolean(),
    summary: z.string(),
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

export type ReadinessSummary = z.infer<typeof readinessSummary>;
export type StackUsage = z.infer<typeof stackUsage>;

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
