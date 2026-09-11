/**
 * Builds a console instance against the Testcontainers databases, with helpers for creating an
 * owner and signing in through the real Better Auth flow.
 *
 * Two-factor is required of every console account, so `createOwner` enrols by computing a real
 * TOTP code rather than by flipping a flag: the test signs in the way a person does.
 */
import { createHmac, generateKeyPairSync } from 'node:crypto';
import { hashPassword } from 'better-auth/crypto';
import { buildApp, type App } from '../../src/app.js';
import { loadEnv, type Env } from '../../src/config/env.js';
import { newId } from '../../src/lib/ids.js';
import { seed } from '../../prisma/seed.js';

/** A throwaway signing key per test run; the CRM verifies against its public half. */
const { privateKey } = generateKeyPairSync('ed25519');
export const TEST_SIGNING_KEY = privateKey
  .export({ type: 'pkcs8', format: 'der' })
  .toString('base64');

export function testEnv(overrides: Partial<Record<string, string>> = {}): Env {
  const databaseUrl = process.env.TEST_CONSOLE_DATABASE_URL;
  const valkeyUrl = process.env.TEST_CONSOLE_VALKEY_URL;
  if (!databaseUrl || !valkeyUrl) {
    throw new Error('global setup did not run (TEST_CONSOLE_* missing)');
  }
  return loadEnv({
    NODE_ENV: 'test',
    CONSOLE_URL: 'http://localhost:5174',
    LOG_LEVEL: 'silent',
    CONSOLE_AUTH_SECRET: 'test-secret-test-secret-test-secret-test-secret',
    CONSOLE_SECRETS_KEY: '11'.repeat(32),
    CONSOLE_SIGNING_KEY: TEST_SIGNING_KEY,
    CONSOLE_BRAND_DOMAIN: 'flare.test',
    CONSOLE_DATABASE_URL: databaseUrl,
    CONSOLE_VALKEY_URL: valkeyUrl,
    SMTP_URL: 'smtp://127.0.0.1:9',
    MAIL_FROM: 'Console <console@example.com>',
    ...overrides,
  });
}

/** RFC 6238, six digits, thirty second step: what an authenticator app produces. */
export function totp(secret: string, at = Date.now()): string {
  const key = Buffer.from(base32Decode(secret));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 1000 / 30)));
  const digest = createHmac('sha1', key).update(counter).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const code = digest.readUInt32BE(offset) & 0x7fffffff;
  return String(code % 1_000_000).padStart(6, '0');
}

function base32Decode(input: string): Uint8Array {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of input.replace(/=+$/, '').toUpperCase()) {
    const idx = alphabet.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Uint8Array.from(out);
}

export interface TestOwner {
  id: string;
  email: string;
  password: string;
  cookie: string;
  /** Set once two-factor is enrolled, so a test can compute further codes. */
  totpSecret: string;
}

export class TestContext {
  private constructor(
    readonly app: App,
    readonly env: Env,
  ) {}

  static async create(overrides: Partial<Record<string, string>> = {}): Promise<TestContext> {
    const env = testEnv(overrides);
    const app = await buildApp({ env, logger: false });
    await app.ready();
    const ctx = new TestContext(app, env);
    await ctx.reset();
    return ctx;
  }

  async reset(): Promise<void> {
    const tables = await this.app.db.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
    const list = tables.map((t) => `"${t.tablename}"`).join(', ');
    await this.app.db.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
    await this.app.valkey.flushdb();
    await seed(this.app.db, {});
  }

  async close(): Promise<void> {
    await this.app.close();
  }

  /** Creates an account, signs in, and enrols two-factor the way the console demands. */
  async createOwner(
    input: { email?: string; name?: string; enrol?: boolean; role?: 'owner' | 'support' } = {},
  ): Promise<TestOwner> {
    const id = newId();
    const email = input.email ?? `owner-${id.slice(-8)}@example.com`;
    const password = `Str0ng-Passw0rd-${id.slice(-6)}`;
    await this.app.db.user.create({
      data: {
        id,
        email,
        name: input.name ?? 'Test Owner',
        role: input.role ?? 'owner',
        emailVerified: true,
        isActive: true,
      },
    });
    await this.app.db.account.create({
      data: {
        id: newId(),
        userId: id,
        accountId: id,
        providerId: 'credential',
        issuer: 'local:credential',
        password: await hashPassword(password),
      },
    });
    let cookie = await this.signIn(email, password);
    let totpSecret = '';
    if (input.enrol !== false) {
      const enabled = await this.app.inject({
        method: 'POST',
        url: '/api/auth/two-factor/enable',
        headers: { 'content-type': 'application/json', cookie, origin: this.env.CONSOLE_URL },
        payload: { password },
      });
      const uri = enabled.json<{ totpURI: string }>().totpURI;
      totpSecret = new URL(uri).searchParams.get('secret') ?? '';
      const verified = await this.app.inject({
        method: 'POST',
        url: '/api/auth/two-factor/verify-totp',
        headers: { 'content-type': 'application/json', cookie, origin: this.env.CONSOLE_URL },
        payload: { code: totp(totpSecret) },
      });
      if (verified.statusCode !== 200) {
        throw new Error(`two-factor enrolment failed: ${verified.statusCode} ${verified.body}`);
      }
      cookie = mergeCookies(cookie, verified.headers['set-cookie']);
    }
    return { id, email, password, cookie, totpSecret };
  }

  async signIn(email: string, password: string): Promise<string> {
    const res = await this.app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/email',
      headers: { 'content-type': 'application/json', origin: this.env.CONSOLE_URL },
      payload: { email, password },
    });
    if (res.statusCode !== 200) throw new Error(`sign-in failed: ${res.statusCode} ${res.body}`);
    return cookiesFrom(res.headers['set-cookie']);
  }

  async as(
    owner: TestOwner | null,
    options: {
      method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
      url: string;
      payload?: unknown;
      headers?: Record<string, string>;
    },
  ) {
    return this.app.inject({
      method: options.method,
      headers: {
        'content-type': 'application/json',
        ...(owner ? { cookie: owner.cookie } : {}),
        ...(options.headers ?? {}),
      },
      url: options.url,
      ...(options.payload !== undefined ? { payload: options.payload as string } : {}),
    });
  }
}

function cookiesFrom(header: string | string[] | undefined): string {
  const list = Array.isArray(header) ? header : header ? [header] : [];
  return list.map((c) => c.split(';')[0] ?? '').join('; ');
}

function mergeCookies(existing: string, header: string | string[] | undefined): string {
  const jar = new Map<string, string>();
  for (const part of existing.split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0) jar.set(part.slice(0, idx).trim(), part.slice(idx + 1).trim());
  }
  for (const part of cookiesFrom(header).split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0) jar.set(part.slice(0, idx).trim(), part.slice(idx + 1).trim());
  }
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}
