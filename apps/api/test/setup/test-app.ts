/**
 * Builds an application instance against the Testcontainers databases and provides helpers
 * to create users and obtain session cookies through the real Better Auth flow.
 */
import type { Role } from '@crm/shared';
import { hashPassword } from 'better-auth/crypto';
import { buildApp, type App } from '../../src/app.js';
import { loadEnv, type Env } from '../../src/config/env.js';
import { newId } from '../../src/lib/ids.js';
import { seed } from '../../prisma/seed.js';

export function testEnv(overrides: Partial<Record<string, string>> = {}): Env {
  const databaseUrl = process.env.TEST_DATABASE_URL;
  const valkeyUrl = process.env.TEST_VALKEY_URL;
  if (!databaseUrl || !valkeyUrl)
    throw new Error('global setup did not run (TEST_DATABASE_URL / TEST_VALKEY_URL missing)');
  return loadEnv({
    NODE_ENV: 'test',
    APP_MODE: 'api',
    APP_URL: 'http://localhost:5173',
    LOG_LEVEL: 'silent',
    AUTH_SECRET: 'test-secret-test-secret-test-secret-test-secret',
    SECRETS_KEY: '11'.repeat(32),
    DATABASE_URL: databaseUrl,
    VALKEY_URL: valkeyUrl,
    S3_ENDPOINT: 'http://127.0.0.1:9',
    S3_BUCKET: 'test',
    S3_ACCESS_KEY: 'x',
    S3_SECRET_KEY: 'x',
    SMTP_URL: 'smtp://127.0.0.1:9',
    MAIL_FROM: 'CRM <test@example.com>',
    OPENAPI_ENABLED: 'true',
    ...overrides,
  });
}

export interface TestUser {
  id: string;
  email: string;
  password: string;
  role: Role;
  cookie: string;
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

  /** Wipe all data (TRUNCATE is statement-level, so the audit trigger does not fire) and re-seed. */
  async reset(): Promise<void> {
    const tables = await this.app.db.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
    const list = tables.map((t) => `"${t.tablename}"`).join(', ');
    await this.app.db.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
    await this.app.valkey.flushdb();
    // TRUNCATE bypasses the Valkey notice that normally clears this cache.
    this.app.entitlements.invalidate();
    await seed(this.app.db as never, {});
    // tests create their own users; 2FA enforcement is exercised explicitly where needed
    await this.app.settings.set(
      'security',
      { require2FAForPrivileged: false, require2FAForAll: false, sessionIdleMinutes: 60 },
      null,
    );
  }

  async close(): Promise<void> {
    await this.app.close();
  }

  /** Create a user directly (bypassing the admin API) and sign in through Better Auth. */
  async createUser(
    input: {
      role?: Role;
      email?: string;
      name?: string;
      extension?: string | null;
      teamId?: string | null;
      twoFactorEnabled?: boolean;
    } = {},
  ): Promise<TestUser> {
    const id = newId();
    const email = input.email ?? `${input.role ?? 'agent'}-${id.slice(-8)}@example.com`;
    const password = `Str0ng-Passw0rd-${id.slice(-6)}`;
    const role = input.role ?? 'agent';
    await this.app.db.user.create({
      data: {
        id,
        email,
        name: input.name ?? `Test ${role}`,
        role,
        emailVerified: true,
        isActive: true,
        extension: input.extension ?? null,
        teamId: input.teamId ?? null,
        twoFactorEnabled: input.twoFactorEnabled ?? false,
      },
    });
    // Better Auth hashes with scrypt; use its own hasher so the stored format is exact.
    const hash = await hashPassword(password);
    await this.app.db.account.create({
      data: {
        id: newId(),
        userId: id,
        accountId: id,
        providerId: 'credential',
        issuer: 'local:credential',
        password: hash,
      },
    });
    const cookie = await this.signIn(email, password);
    return { id, email, password, role, cookie };
  }

  async signIn(email: string, password: string): Promise<string> {
    const res = await this.app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/email',
      headers: { 'content-type': 'application/json', origin: this.env.APP_URL },
      payload: { email, password },
    });
    if (res.statusCode !== 200) throw new Error(`sign-in failed: ${res.statusCode} ${res.body}`);
    const setCookies = res.headers['set-cookie'];
    const list = Array.isArray(setCookies) ? setCookies : setCookies ? [setCookies] : [];
    return list.map((c) => c.split(';')[0] ?? '').join('; ');
  }

  /** Authenticated inject helper. */
  async as(
    user: TestUser | null,
    options: {
      method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
      url: string;
      payload?: unknown;
      headers?: Record<string, string>;
    },
  ) {
    return this.app.inject({
      method: options.method,
      url: options.url,
      headers: {
        'content-type': 'application/json',
        ...(user ? { cookie: user.cookie } : {}),
        ...(options.headers ?? {}),
      },
      ...(options.payload !== undefined ? { payload: options.payload as string } : {}),
    });
  }
}
