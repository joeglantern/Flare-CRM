/**
 * Environment configuration (docs/03 §6, docs/12 §6).
 * The process refuses to start on any invalid or missing value.
 */
import { z } from 'zod';

const boolFlag = (def: 'true' | 'false') =>
  z
    .enum(['true', 'false', '1', '0'])
    .default(def)
    .transform((v) => v === 'true' || v === '1');
const bool = boolFlag('false');

const csv = z
  .string()
  .default('')
  .transform((v) =>
    v
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    APP_MODE: z.enum(['api', 'worker']).default('api'),
    APP_URL: z.url(),
    API_HOST: z.string().default('0.0.0.0'),
    API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(1),
    DEV_ORIGINS: csv,

    AUTH_SECRET: z.string().min(32, 'AUTH_SECRET must be at least 32 characters'),
    SECRETS_KEY: z
      .string()
      .regex(/^[0-9a-fA-F]{64}$/, 'SECRETS_KEY must be 32 bytes as 64 hex characters'),

    DATABASE_URL: z.string().startsWith('postgres'),
    VALKEY_URL: z.string().startsWith('redis'),

    S3_ENDPOINT: z.url(),
    S3_REGION: z.string().default('us-east-1'),
    S3_BUCKET: z.string().min(1),
    S3_ACCESS_KEY: z.string().min(1),
    S3_SECRET_KEY: z.string().min(1),
    S3_FORCE_PATH_STYLE: boolFlag('true'),
    STORAGE_PUBLIC_URL: z.url().optional(),
    /**
     * Where large objects live. `s3` is the bundled store on the server. `gdrive` sends the
     * object classes named in GDRIVE_PREFIXES to Google Drive through a service account and keeps
     * the rest local, so recordings, attachments and backups stop consuming the server disk.
     */
    STORAGE_BACKEND: z.enum(['s3', 'gdrive']).default('s3'),
    GDRIVE_SERVICE_ACCOUNT_FILE: z.string().optional(),
    GDRIVE_FOLDER_ID: z.string().optional(),
    /** Workspace only: act as this user through domain-wide delegation. */
    GDRIVE_IMPERSONATE: z.email().optional(),
    GDRIVE_PREFIXES: z.string().default('recordings,attachments,backups'),

    SMTP_URL: z.string().min(1),
    MAIL_FROM: z.string().min(3),

    YEASTAR_ENABLED: bool,
    YEASTAR_BASE_URL: z.url().optional(),
    YEASTAR_CLIENT_ID: z.string().optional(),
    YEASTAR_CLIENT_SECRET: z.string().optional(),
    YEASTAR_TLS_FINGERPRINT_SHA256: z
      .string()
      .regex(/^([0-9A-Fa-f]{2}:){31}[0-9A-Fa-f]{2}$/)
      .optional(),
    YEASTAR_TLS_CA_FILE: z.string().optional(),
    /**
     * The PBX presents a certificate from a public CA, so verify it against the system trust
     * store like any other HTTPS host. Yeastar's hosted Remote Access and Cloud editions use
     * Let's Encrypt, which rotates roughly every ninety days; pinning that fingerprint would
     * silently sever telephony at the next renewal. Self-signed appliances keep pinning.
     */
    YEASTAR_TLS_PUBLIC_CA: bool,
    /** IANA time zone of the PBX; CDR timestamps are PBX-local wall-clock. */
    YEASTAR_TIMEZONE: z.string().default('Africa/Nairobi'),
    YEASTAR_EVENT_SOURCE: z.enum(['websocket', 'webhook', 'both']).default('websocket'),
    YEASTAR_WEBHOOK_SECRET: z.string().optional(),
    LINKUS_SDK_ENABLED: bool,
    LINKUS_ACCESS_ID: z.string().optional(),
    LINKUS_ACCESS_KEY: z.string().optional(),

    WHATSAPP_ENABLED: bool,
    WHATSAPP_ACCESS_TOKEN: z.string().optional(),
    WHATSAPP_APP_SECRET: z.string().optional(),
    WHATSAPP_VERIFY_TOKEN: z.string().optional(),
    WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
    WHATSAPP_GRAPH_VERSION: z.string().default('v23.0'),
    /** Override only for tests / proxies. */
    WHATSAPP_API_BASE_URL: z.url().default('https://graph.facebook.com'),

    OPENAPI_ENABLED: bool,
    METRICS_ENABLED: boolFlag('true'),

    FIRST_ADMIN_EMAIL: z.email().optional(),
    FIRST_ADMIN_NAME: z.string().optional(),
  })
  .superRefine((env, ctx) => {
    if (env.STORAGE_BACKEND === 'gdrive') {
      for (const key of ['GDRIVE_SERVICE_ACCOUNT_FILE', 'GDRIVE_FOLDER_ID'] as const) {
        if (!env[key])
          ctx.addIssue({
            code: 'custom',
            path: [key],
            message: `${key} is required when STORAGE_BACKEND=gdrive`,
          });
      }
    }
    if (env.YEASTAR_ENABLED) {
      for (const key of [
        'YEASTAR_BASE_URL',
        'YEASTAR_CLIENT_ID',
        'YEASTAR_CLIENT_SECRET',
      ] as const) {
        if (!env[key])
          ctx.addIssue({
            code: 'custom',
            path: [key],
            message: `${key} is required when YEASTAR_ENABLED=true`,
          });
      }
      if (env.YEASTAR_EVENT_SOURCE !== 'websocket' && !env.YEASTAR_WEBHOOK_SECRET) {
        ctx.addIssue({
          code: 'custom',
          path: ['YEASTAR_WEBHOOK_SECRET'],
          message: 'required for webhook event source',
        });
      }
      if (
        env.NODE_ENV === 'production' &&
        env.YEASTAR_BASE_URL?.startsWith('https://') &&
        !env.YEASTAR_TLS_FINGERPRINT_SHA256 &&
        !env.YEASTAR_TLS_CA_FILE &&
        !env.YEASTAR_TLS_PUBLIC_CA
      ) {
        // Verification is never disabled, so production must say how the PBX is trusted: pin
        // its fingerprint, supply its certificate as the CA, or declare it publicly trusted.
        // Pinning a public CA certificate breaks at its next rotation (docs/06 §2).
        ctx.addIssue({
          code: 'custom',
          path: ['YEASTAR_TLS_FINGERPRINT_SHA256'],
          message:
            'say how the PBX certificate is trusted in production: YEASTAR_TLS_FINGERPRINT_SHA256 or YEASTAR_TLS_CA_FILE for a self-signed PBX, or YEASTAR_TLS_PUBLIC_CA=true for a publicly trusted one',
        });
      }
      if (env.YEASTAR_TLS_PUBLIC_CA && env.YEASTAR_TLS_FINGERPRINT_SHA256) {
        ctx.addIssue({
          code: 'custom',
          path: ['YEASTAR_TLS_PUBLIC_CA'],
          message:
            'a publicly trusted certificate must not also be pinned; the pin would fail at its next rotation',
        });
      }
    }
    if (env.LINKUS_SDK_ENABLED && (!env.LINKUS_ACCESS_ID || !env.LINKUS_ACCESS_KEY)) {
      ctx.addIssue({
        code: 'custom',
        path: ['LINKUS_ACCESS_ID'],
        message: 'LINKUS_ACCESS_ID/KEY required when LINKUS_SDK_ENABLED=true',
      });
    }
    if (env.WHATSAPP_ENABLED) {
      for (const key of [
        'WHATSAPP_ACCESS_TOKEN',
        'WHATSAPP_APP_SECRET',
        'WHATSAPP_VERIFY_TOKEN',
        'WHATSAPP_PHONE_NUMBER_ID',
      ] as const) {
        if (!env[key])
          ctx.addIssue({
            code: 'custom',
            path: [key],
            message: `${key} is required when WHATSAPP_ENABLED=true`,
          });
      }
    }
    if (env.NODE_ENV === 'production' && !env.APP_URL.startsWith('https://')) {
      ctx.addIssue({
        code: 'custom',
        path: ['APP_URL'],
        message: 'APP_URL must be https in production',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  // `KEY=` in a .env file means "unset", not an empty string value
  const cleaned = Object.fromEntries(Object.entries(source).filter(([, v]) => v !== ''));
  const result = envSchema.safeParse(cleaned);
  if (!result.success) {
    const lines = result.error.issues.map(
      (i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`,
    );
    throw new Error(`Invalid environment configuration:\n${lines.join('\n')}`);
  }
  return result.data;
}
