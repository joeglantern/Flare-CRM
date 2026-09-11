/**
 * Owner console configuration (docs/21). The process refuses to start on any invalid value.
 *
 * The console holds the private key every customer stack trusts, and a hash of every stack's
 * secret. It is deliberately a separate service with its own database and its own credentials:
 * a compromised customer stack must not be a route into it.
 */
import { createPrivateKey, createPublicKey } from 'node:crypto';
import { z } from 'zod';

const boolFlag = (def: 'true' | 'false') =>
  z
    .enum(['true', 'false', '1', '0'])
    .default(def)
    .transform((v) => v === 'true' || v === '1');

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
    CONSOLE_URL: z.url(),
    API_HOST: z.string().default('0.0.0.0'),
    API_PORT: z.coerce.number().int().min(1).max(65535).default(4100),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(1),
    DEV_ORIGINS: csv,

    CONSOLE_AUTH_SECRET: z.string().min(32, 'CONSOLE_AUTH_SECRET must be at least 32 characters'),
    CONSOLE_SECRETS_KEY: z
      .string()
      .regex(/^[0-9a-fA-F]{64}$/, 'CONSOLE_SECRETS_KEY must be 32 bytes as 64 hex characters'),
    /** Ed25519 private key, PKCS8 DER as base64. Every entitlements document is signed with it. */
    CONSOLE_SIGNING_KEY: z.string().min(40),
    /** Customers get <slug>.<this> unless they bring their own domain. */
    CONSOLE_BRAND_DOMAIN: z
      .string()
      .regex(/^[a-z0-9.-]+\.[a-z]{2,}$/, 'CONSOLE_BRAND_DOMAIN must be a hostname'),

    CONSOLE_DATABASE_URL: z.string().startsWith('postgres'),
    CONSOLE_VALKEY_URL: z.string().startsWith('redis'),

    SMTP_URL: z.string().min(1),
    MAIL_FROM: z.string().min(3),
    /**
     * A public address for the 88px mark in the email letterhead. The console itself is usually
     * reachable only through a tunnel, so a mail client could not fetch it from here; without this
     * the letterhead is the wordmark alone, which still says who sent it.
     */
    MAIL_MARK_URL: z.url().optional(),

    FIRST_OWNER_EMAIL: z.email().optional(),
    FIRST_OWNER_NAME: z.string().optional(),

    METRICS_ENABLED: boolFlag('true'),
    OPENAPI_ENABLED: boolFlag('false'),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production' && !env.CONSOLE_URL.startsWith('https://')) {
      ctx.addIssue({
        code: 'custom',
        path: ['CONSOLE_URL'],
        message: 'CONSOLE_URL must be https in production',
      });
    }
    // Fail at boot rather than at the first issue: an unusable signing key means the console
    // cannot do the one thing it exists for.
    try {
      const key = createPrivateKey({
        key: Buffer.from(env.CONSOLE_SIGNING_KEY, 'base64'),
        format: 'der',
        type: 'pkcs8',
      });
      if (key.asymmetricKeyType !== 'ed25519') {
        ctx.addIssue({
          code: 'custom',
          path: ['CONSOLE_SIGNING_KEY'],
          message: 'CONSOLE_SIGNING_KEY must be an Ed25519 key',
        });
      }
    } catch {
      ctx.addIssue({
        code: 'custom',
        path: ['CONSOLE_SIGNING_KEY'],
        message:
          "CONSOLE_SIGNING_KEY must be a PKCS8 DER Ed25519 private key, base64 encoded. Generate one with: node -e \"console.log(require('crypto').generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'der'}).toString('base64'))\"",
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const cleaned = Object.fromEntries(Object.entries(source).filter(([, v]) => v !== ''));
  const result = envSchema.safeParse(cleaned);
  if (!result.success) {
    const lines = result.error.issues.map(
      (i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`,
    );
    throw new Error(`Invalid console configuration:\n${lines.join('\n')}`);
  }
  return result.data;
}

/** The public half every customer stack is given, and the id that names this key. */
export function signingKeys(env: Env): {
  privateKeyBase64: string;
  publicKeySpkiBase64: string;
} {
  const privateKey = createPrivateKey({
    key: Buffer.from(env.CONSOLE_SIGNING_KEY, 'base64'),
    format: 'der',
    type: 'pkcs8',
  });
  const spki = createPublicKey(privateKey).export({ type: 'spki', format: 'der' });
  return {
    privateKeyBase64: env.CONSOLE_SIGNING_KEY,
    publicKeySpkiBase64: spki.toString('base64'),
  };
}
