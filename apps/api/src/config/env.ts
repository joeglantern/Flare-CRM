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

    /**
     * Owner console link (docs/20, docs/21). All four are set together or not at all; with none
     * of them the stack runs standalone with every feature on. CONSOLE_PUBLIC_KEY is a comma
     * separated list of base64 SPKI keys so a new console key can be trusted before the old one
     * is retired. ENTITLEMENTS_FILE loads a signed document from disk for installs that cannot
     * reach a console; it still needs the public key to verify it.
     */
    CONSOLE_URL: z.url().optional(),
    CONSOLE_STACK_ID: z
      .string()
      .regex(/^stk_[a-z2-7]{20}$/, 'CONSOLE_STACK_ID must be the id the console issued')
      .optional(),
    CONSOLE_STACK_SECRET: z.string().min(32).optional(),
    CONSOLE_PUBLIC_KEY: csv,
    ENTITLEMENTS_FILE: z.string().min(1).optional(),
    /** Customer-owned domains besides APP_URL, joined into trusted origins and CORS. */
    APP_EXTRA_ORIGINS: csv,
    /** Reported to the console; the Dockerfile sets it from the git sha. */
    APP_VERSION: z.string().min(1).max(64).default('dev'),
  })
  .superRefine((env, ctx) => {
    const consoleKeys = ['CONSOLE_URL', 'CONSOLE_STACK_ID', 'CONSOLE_STACK_SECRET'] as const;
    const consoleSet = consoleKeys.filter((k) => env[k] !== undefined);
    // A public key on its own is file mode; any console credential means all of them.
    const linkConfigured = consoleSet.length > 0;
    if (linkConfigured) {
      for (const key of consoleKeys) {
        if (env[key] === undefined)
          ctx.addIssue({
            code: 'custom',
            path: [key],
            message: `${key} is required when the owner console is configured`,
          });
      }
      if (env.CONSOLE_PUBLIC_KEY.length === 0)
        ctx.addIssue({
          code: 'custom',
          path: ['CONSOLE_PUBLIC_KEY'],
          message: 'CONSOLE_PUBLIC_KEY is required when the owner console is configured',
        });
      if (
        env.NODE_ENV === 'production' &&
        env.CONSOLE_URL &&
        !env.CONSOLE_URL.startsWith('https://')
      )
        ctx.addIssue({
          code: 'custom',
          path: ['CONSOLE_URL'],
          message: 'CONSOLE_URL must be https in production',
        });
    }
    if (env.ENTITLEMENTS_FILE !== undefined && env.CONSOLE_PUBLIC_KEY.length === 0)
      ctx.addIssue({
        code: 'custom',
        path: ['CONSOLE_PUBLIC_KEY'],
        message: 'CONSOLE_PUBLIC_KEY is required to verify ENTITLEMENTS_FILE',
      });
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
