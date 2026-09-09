/**
 * Entitlements: what a customer's plan allows (docs/20).
 *
 * One signed document per customer says which features are on, what the limits are and when the
 * plan expires. The owner console issues it; each customer stack verifies the signature and
 * enforces it next to permissions. A stack with no console configured uses DEFAULT_ENTITLEMENTS,
 * which turns everything on with no limits, so a standalone install behaves exactly as before.
 *
 * Core capabilities (sign-in, users, contacts, companies, notes, tasks, timeline, notifications,
 * general settings, audit reading, search, help) are never switchable and so are not listed here.
 */
import { z } from 'zod';
import { isoDateTime } from './schemas/common.js';

export type FeatureKey =
  | 'telephony'
  | 'recordings'
  | 'softphone'
  | 'messaging'
  | 'leads'
  | 'webforms'
  | 'deals'
  | 'reports'
  | 'reports_team'
  | 'exports'
  | 'imports'
  | 'custom_fields'
  | 'audit_diff'
  | 'backups'
  | 'api_docs';

export interface FeatureDefinition {
  label: string;
  description: string;
  /** Features that must also be on for this one to mean anything. */
  requires: readonly FeatureKey[];
}

export const FEATURES: Record<FeatureKey, FeatureDefinition> = {
  telephony: {
    label: 'Telephony',
    description:
      'Call popup, dialpad, click to call, live calls, call history, call outcomes and telephony settings.',
    requires: [],
  },
  recordings: {
    label: 'Call recordings',
    description: 'Store, play back and manage recordings from the PBX.',
    requires: ['telephony'],
  },
  softphone: {
    label: 'Softphone',
    description: 'Answer and place calls in the browser without a desk phone.',
    requires: ['telephony'],
  },
  messaging: {
    label: 'Messaging inbox',
    description: 'WhatsApp conversations, message templates and channels.',
    requires: [],
  },
  leads: {
    label: 'Leads',
    description: 'Capture, qualify and convert leads into contacts, companies and deals.',
    requires: [],
  },
  webforms: {
    label: 'Web forms',
    description: 'Embeddable lead capture forms for your website.',
    requires: ['leads'],
  },
  deals: {
    label: 'Deals and pipelines',
    description: 'Deal board, pipelines, stages, probabilities and lost reasons.',
    requires: [],
  },
  reports: {
    label: 'Reports',
    description: 'Call and pipeline reports for your own work.',
    requires: [],
  },
  reports_team: {
    label: 'Team reports',
    description: 'Team wide and company wide report scopes and the manager home board.',
    requires: ['reports'],
  },
  exports: {
    label: 'CSV export',
    description: 'Download lists and reports as CSV files.',
    requires: [],
  },
  imports: {
    label: 'CSV import',
    description: 'Bulk import contacts, companies and leads from CSV files.',
    requires: [],
  },
  custom_fields: {
    label: 'Custom fields',
    description: 'Define extra fields on contacts, companies, deals and leads.',
    requires: [],
  },
  audit_diff: {
    label: 'Audit change details',
    description: 'Before and after values on every audit log entry.',
    requires: [],
  },
  backups: {
    label: 'Backup downloads',
    description: 'List, download and upload database snapshots from Settings.',
    requires: [],
  },
  api_docs: {
    label: 'API documentation',
    description: 'Interactive API reference for your own integrations.',
    requires: [],
  },
};

export const featureKeys = Object.keys(FEATURES) as FeatureKey[];

export type LimitKey =
  'seats' | 'storage_gb' | 'recording_retention_days' | 'channels' | 'pipelines';

export interface LimitDefinition {
  label: string;
  unit: string;
  description: string;
}

export const LIMITS: Record<LimitKey, LimitDefinition> = {
  seats: {
    label: 'Active users',
    unit: 'users',
    description: 'How many users can be active at once. Deactivated users do not count.',
  },
  storage_gb: {
    label: 'Storage',
    unit: 'GB',
    description: 'Attachments, call recordings and backup snapshots together.',
  },
  recording_retention_days: {
    label: 'Recording retention',
    unit: 'days',
    description: 'The longest a call recording may be kept before it is deleted.',
  },
  channels: {
    label: 'Messaging channels',
    unit: 'channels',
    description: 'How many messaging channels can be active at once.',
  },
  pipelines: {
    label: 'Pipelines',
    unit: 'pipelines',
    description: 'How many deal pipelines can exist.',
  },
};

export const limitKeys = Object.keys(LIMITS) as LimitKey[];

export type FeatureMap = Record<FeatureKey, boolean>;
/** null means no limit. */
export type LimitMap = Record<LimitKey, number | null>;

export const featureMap = z
  .object(
    Object.fromEntries(featureKeys.map((k) => [k, z.boolean()])) as Record<
      FeatureKey,
      z.ZodBoolean
    >,
  )
  .strict();

export const limitMap = z
  .object(
    Object.fromEntries(limitKeys.map((k) => [k, z.number().int().min(0).nullable()])) as Record<
      LimitKey,
      z.ZodNullable<z.ZodNumber>
    >,
  )
  .strict();

export const ownerContact = z
  .object({
    name: z.string().trim().min(1).max(120),
    email: z.email().max(254),
    phone: z.string().trim().min(3).max(32).optional(),
  })
  .strict();
export type OwnerContact = z.infer<typeof ownerContact>;

export const planRef = z.object({ id: z.string().min(1).max(80), name: z.string().min(1).max(80) });

/**
 * The document the console signs. `audience` is the stack it was issued to; a stack refuses a
 * document addressed to another stack so a file issued for one customer cannot be dropped onto
 * a different customer's server.
 */
export const entitlementsDocument = z
  .object({
    version: z.literal(1),
    customerId: z.string().min(1).max(80),
    customerName: z.string().trim().min(1).max(200),
    plan: planRef,
    features: featureMap,
    limits: limitMap,
    expiresAt: isoDateTime.nullable(),
    issuedAt: isoDateTime,
    issuer: z.string().min(1).max(200),
    audience: z.string().min(1).max(80).optional(),
    ownerContact,
  })
  .strict();
export type EntitlementsDocument = z.infer<typeof entitlementsDocument>;

const base64url = z.string().regex(/^[A-Za-z0-9_-]+$/, 'Expected base64url without padding');

/**
 * The bytes that are signed are exactly the decoded `payload`; a verifier never re-serialises
 * the document. An Ed25519 signature is 64 bytes, which is 86 base64url characters.
 */
export const signedEnvelope = z
  .object({
    payload: base64url.min(1).max(64 * 1024),
    signature: base64url.length(86),
    keyId: z.string().regex(/^[0-9a-f]{16}$/, 'Expected a 16 character hex key id'),
  })
  .strict();
export type SignedEnvelope = z.infer<typeof signedEnvelope>;

export const ENTITLEMENT_SOURCES = ['console', 'file', 'default'] as const;
export type EntitlementSource = (typeof ENTITLEMENT_SOURCES)[number];

export const DEFAULT_ENTITLEMENTS: EntitlementsDocument = {
  version: 1,
  customerId: 'standalone',
  customerName: 'This workspace',
  plan: { id: 'standalone', name: 'Standalone' },
  features: Object.fromEntries(featureKeys.map((k) => [k, true])) as FeatureMap,
  limits: Object.fromEntries(limitKeys.map((k) => [k, null])) as LimitMap,
  expiresAt: null,
  issuedAt: '1970-01-01T00:00:00.000Z',
  issuer: 'standalone',
  ownerContact: { name: 'Your administrator', email: 'admin@example.com' },
};

/**
 * A feature is on only if everything it requires is on. Applied by the console when a plan is
 * saved and again by the stack when a document is loaded, so neither side can hold an
 * incoherent set (recordings without telephony, for instance).
 */
export function normaliseFeatures(features: FeatureMap): FeatureMap {
  const out: FeatureMap = { ...features };
  let changed = true;
  while (changed) {
    changed = false;
    for (const key of featureKeys) {
      if (out[key] && FEATURES[key].requires.some((r) => !out[r])) {
        out[key] = false;
        changed = true;
      }
    }
  }
  return out;
}

export function isExpired(doc: Pick<EntitlementsDocument, 'expiresAt'>, now = new Date()): boolean {
  return doc.expiresAt !== null && Date.parse(doc.expiresAt) <= now.getTime();
}

/** Whole days until expiry, negative once expired, null when the plan never expires. */
export function daysUntilExpiry(
  doc: Pick<EntitlementsDocument, 'expiresAt'>,
  now = new Date(),
): number | null {
  if (doc.expiresAt === null) return null;
  return Math.ceil((Date.parse(doc.expiresAt) - now.getTime()) / 86_400_000);
}

export const PLAN_ERROR_CODES = ['FEATURE_NOT_IN_PLAN', 'PLAN_EXPIRED', 'LIMIT_REACHED'] as const;
export type PlanErrorCode = (typeof PLAN_ERROR_CODES)[number];

const counted = z.object({ used: z.number().int(), max: z.number().int().nullable() });

/** What GET /entitlements returns: the document plus live usage and where it came from. */
export const entitlementsDto = z.object({
  customerName: z.string(),
  plan: planRef,
  features: featureMap,
  limits: limitMap,
  usage: z.object({
    seats: counted,
    storage: z.object({
      usedBytes: z.number().int(),
      maxBytes: z.number().int().nullable(),
      breakdown: z.object({
        attachments: z.number().int(),
        recordings: z.number().int(),
        backups: z.number().int(),
      }),
      refreshedAt: isoDateTime.nullable(),
    }),
    channels: counted,
    pipelines: counted,
    recordingRetentionDays: z.object({
      configured: z.number().int(),
      max: z.number().int().nullable(),
      effective: z.number().int(),
    }),
  }),
  expiresAt: isoDateTime.nullable(),
  expired: z.boolean(),
  expiresInDays: z.number().int().nullable(),
  ownerContact,
  source: z.enum(ENTITLEMENT_SOURCES),
  receivedAt: isoDateTime.nullable(),
  issuedAt: isoDateTime.nullable(),
  issueId: z.string().nullable(),
  keyId: z.string().nullable(),
  link: z.object({
    configured: z.boolean(),
    connected: z.boolean(),
    lastHeartbeatAt: isoDateTime.nullable(),
  }),
});
export type EntitlementsDto = z.infer<typeof entitlementsDto>;
