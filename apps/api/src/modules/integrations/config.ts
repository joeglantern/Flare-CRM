/**
 * Which email server and which PBX this stack talks to.
 *
 * Details an admin saved in the CRM win; without them the server's .env is used, exactly as
 * before this existed. Each saved value is one encrypted row in `integration_config`, password or
 * API secret included, under SECRETS_KEY.
 */
import type { SmtpSecurity } from '@crm/shared';
import type { Env } from '../../config/env.js';
import { decryptJson, encryptJson } from '../../lib/crypto.js';
import type { Db } from '../../plugins/prisma.js';

/** Published whenever an admin saves or drops one, with the key ("smtp" or "pbx") as message. */
export const INTEGRATIONS_CHANNEL = 'integrations:changed';

export type IntegrationKey = 'smtp' | 'pbx';

export interface StoredSmtp {
  host: string;
  port: number;
  security: SmtpSecurity;
  username: string | null;
  password: string | null;
  from: string;
}

export interface StoredPbx {
  enabled: boolean;
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  tls: 'public' | 'fingerprint';
  fingerprint: string | null;
}

export interface EffectiveSmtp {
  source: 'admin' | 'server';
  /** What nodemailer takes: the .env URL as it is, or options built from the saved row. */
  transport: string | SmtpTransportOptions;
  from: string;
  stored: StoredSmtp | null;
  updatedAt: Date | null;
}

export interface SmtpTransportOptions {
  host: string;
  port: number;
  secure: boolean;
  requireTLS: boolean;
  ignoreTLS: boolean;
  auth?: { user: string; pass: string };
  connectionTimeout: number;
  greetingTimeout: number;
}

export interface EffectivePbx {
  source: 'admin' | 'server';
  enabled: boolean;
  baseUrl: string | null;
  clientId: string | null;
  clientSecret: string | null;
  tls: { caFile?: string | undefined; fingerprintSha256?: string | undefined };
  tlsMode: 'public' | 'fingerprint' | null;
  updatedAt: Date | null;
}

type ConfigEnv = Pick<
  Env,
  | 'SECRETS_KEY'
  | 'SMTP_URL'
  | 'MAIL_FROM'
  | 'YEASTAR_ENABLED'
  | 'YEASTAR_BASE_URL'
  | 'YEASTAR_CLIENT_ID'
  | 'YEASTAR_CLIENT_SECRET'
  | 'YEASTAR_TLS_CA_FILE'
  | 'YEASTAR_TLS_FINGERPRINT_SHA256'
  | 'YEASTAR_TLS_PUBLIC_CA'
>;

async function readRow(
  db: Db,
  key: IntegrationKey,
  secretsKey: string,
): Promise<{ value: unknown; updatedAt: Date } | null> {
  const row = await db.integrationConfig.findUnique({ where: { key } });
  if (!row) return null;
  return { value: decryptJson(row.dataEncrypted, secretsKey), updatedAt: row.updatedAt };
}

export async function writeIntegration(
  db: Db,
  key: IntegrationKey,
  value: StoredSmtp | StoredPbx,
  secretsKey: string,
  actorId: string,
): Promise<void> {
  const dataEncrypted = encryptJson(value, secretsKey);
  await db.integrationConfig.upsert({
    where: { key },
    create: { key, dataEncrypted, updatedById: actorId },
    update: { dataEncrypted, updatedById: actorId },
  });
}

export function smtpTransportOf(s: StoredSmtp): SmtpTransportOptions {
  return {
    host: s.host,
    port: s.port,
    secure: s.security === 'tls',
    requireTLS: s.security === 'starttls',
    ignoreTLS: s.security === 'none',
    ...(s.username ? { auth: { user: s.username, pass: s.password ?? '' } } : {}),
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
  };
}

export async function readSmtp(db: Db, env: ConfigEnv): Promise<EffectiveSmtp> {
  const row = await readRow(db, 'smtp', env.SECRETS_KEY);
  if (row) {
    const value = row.value as StoredSmtp;
    return {
      source: 'admin',
      transport: smtpTransportOf(value),
      from: value.from,
      stored: value,
      updatedAt: row.updatedAt,
    };
  }
  return {
    source: 'server',
    transport: env.SMTP_URL,
    from: env.MAIL_FROM,
    stored: null,
    updatedAt: null,
  };
}

export async function readPbx(db: Db, env: ConfigEnv): Promise<EffectivePbx> {
  const row = await readRow(db, 'pbx', env.SECRETS_KEY);
  if (row) {
    const v = row.value as StoredPbx;
    return {
      source: 'admin',
      enabled: v.enabled,
      baseUrl: v.baseUrl,
      clientId: v.clientId,
      clientSecret: v.clientSecret,
      tls: v.tls === 'fingerprint' && v.fingerprint ? { fingerprintSha256: v.fingerprint } : {},
      tlsMode: v.tls,
      updatedAt: row.updatedAt,
    };
  }
  return {
    source: 'server',
    enabled: env.YEASTAR_ENABLED,
    baseUrl: env.YEASTAR_BASE_URL ?? null,
    clientId: env.YEASTAR_CLIENT_ID ?? null,
    clientSecret: env.YEASTAR_CLIENT_SECRET ?? null,
    tls: { caFile: env.YEASTAR_TLS_CA_FILE, fingerprintSha256: env.YEASTAR_TLS_FINGERPRINT_SHA256 },
    tlsMode: env.YEASTAR_TLS_FINGERPRINT_SHA256
      ? 'fingerprint'
      : env.YEASTAR_TLS_PUBLIC_CA
        ? 'public'
        : null,
    updatedAt: null,
  };
}

/** Configured enough to talk to: switched on, with an address and both halves of the API key. */
export function pbxUsable(p: EffectivePbx): boolean {
  return p.enabled && Boolean(p.baseUrl && p.clientId && p.clientSecret);
}
