/**
 * Business settings stored in the `settings` table (docs/05 "settings" keys).
 * Each key has a Zod schema and a default; unknown keys are rejected.
 */
import { AgentVisibility, valuesOf } from '@crm/shared';
import { z } from 'zod';

export const settingSchemas = {
  agentVisibility: z.enum(valuesOf(AgentVisibility)),
  defaultCountry: z.string().length(2).toUpperCase(),
  currency: z.string().length(3).toUpperCase(),
  dialRules: z.object({
    stripPlus: z.boolean(),
    outboundPrefix: z.string().max(8),
    internalExtensionLength: z.number().int().min(2).max(8),
    e164ToDialable: z.enum(['national', 'international']),
    dialPermissionExtension: z.string().max(16).nullable(),
  }),
  popup: z.object({
    popOnInternalCalls: z.boolean(),
    autoOpenProfileOnAnswer: z.boolean(),
    suggestFollowUpAfterCall: z.boolean(),
  }),
  recording: z.object({
    consentText: z.string().max(2000),
    retentionDays: z.number().int().min(1).max(3650),
    allowAgentPlayback: z.boolean(),
  }),
  retention: z.object({
    softDeletePurgeDays: z.number().int().min(1).max(3650),
    pbxEventsDays: z.number().int().min(1).max(365),
    rawMessagePayloadDays: z.number().int().min(1).max(3650),
  }),
  matching: z.object({
    allowSuffixMatch: z.boolean(),
    suffixLength: z.number().int().min(6).max(10),
  }),
  security: z.object({
    require2FAForPrivileged: z.boolean(),
    require2FAForAll: z.boolean(),
    sessionIdleMinutes: z.number().int().min(5).max(720),
  }),
} as const;

export type SettingKey = keyof typeof settingSchemas;
export type SettingValue<K extends SettingKey> = z.infer<(typeof settingSchemas)[K]>;
export type Settings = { [K in SettingKey]: SettingValue<K> };

export const settingDefaults: Settings = {
  agentVisibility: 'owned',
  defaultCountry: 'KE',
  currency: 'KES',
  dialRules: {
    stripPlus: true,
    outboundPrefix: '',
    internalExtensionLength: 4,
    e164ToDialable: 'national',
    dialPermissionExtension: null,
  },
  popup: {
    popOnInternalCalls: false,
    autoOpenProfileOnAnswer: false,
    suggestFollowUpAfterCall: true,
  },
  recording: {
    consentText: 'This call may be recorded for quality and training purposes.',
    retentionDays: 365,
    allowAgentPlayback: true,
  },
  retention: { softDeletePurgeDays: 90, pbxEventsDays: 30, rawMessagePayloadDays: 90 },
  matching: { allowSuffixMatch: false, suffixLength: 9 },
  security: { require2FAForPrivileged: true, require2FAForAll: false, sessionIdleMinutes: 60 },
};

export const settingKeys = Object.keys(settingSchemas) as SettingKey[];

export const settingsPatchSchema = z
  .object(
    Object.fromEntries(settingKeys.map((k) => [k, settingSchemas[k].optional()])) as {
      [K in SettingKey]: z.ZodOptional<(typeof settingSchemas)[K]>;
    },
  )
  .strict();

export const settingsResponseSchema = z.object(settingSchemas);

/** Subset safe for any authenticated user (docs/09 `GET /settings/public`). */
export const publicSettingsSchema = z.object({
  defaultCountry: settingSchemas.defaultCountry,
  currency: settingSchemas.currency,
  popup: settingSchemas.popup,
  security: z.object({ sessionIdleMinutes: z.number().int() }),
  recording: z.object({ consentText: z.string(), allowAgentPlayback: z.boolean() }),
});
