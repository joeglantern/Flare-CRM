/**
 * Better Auth configuration (docs/07 §1). Built as a factory so tests can inject dependencies.
 */
import { ac, roles } from '@crm/shared';
import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { APIError } from 'better-auth/api';
import { admin, haveIBeenPwned, openAPI, twoFactor } from 'better-auth/plugins';
import type { Env } from '../config/env.js';
import { newId } from '../lib/ids.js';
import { createValkeySecondaryStorage } from '../lib/valkey-storage.js';
import type { Mailer } from '../plugins/mailer.js';
import type { Db } from '../plugins/prisma.js';
import type { Redis } from 'ioredis';
import {
  RESET_LINK_SECONDS,
  VERIFY_LINK_SECONDS,
  passwordReset,
  readInstallation,
  verifyEmail,
  welcomeSetPassword,
} from '../modules/notifications/templates/auth.js';

export interface AuthDeps {
  env: Env;
  db: Db;
  valkey: Redis;
  mailer: Mailer;
  log: { warn: (o: unknown, m: string) => void; error: (o: unknown, m: string) => void };
}

/** Valkey flag set by the users module so the first reset email uses the welcome template. */
export const WELCOME_FLAG_PREFIX = 'auth:welcome:';

/** What the welcome flag holds: who asked, so the email can name them. */
export function welcomeFlagValue(invitedBy: string | null): string {
  return JSON.stringify({ invitedBy });
}

/** Flags written before the inviter was recorded hold "1", which names nobody. */
function invitedByFrom(flag: string): string | null {
  try {
    const value = JSON.parse(flag) as { invitedBy?: unknown } | null;
    return typeof value?.invitedBy === 'string' ? value.invitedBy : null;
  } catch {
    return null;
  }
}

function timeZoneOf(user: object): string | null {
  const zone = (user as { timezone?: unknown }).timezone;
  return typeof zone === 'string' ? zone : null;
}

export function createAuth(deps: AuthDeps) {
  const { env, db, valkey, mailer } = deps;
  const appName = 'CRM';
  const isProd = env.NODE_ENV === 'production';

  return betterAuth({
    appName,
    baseURL: env.APP_URL,
    basePath: '/api/auth',
    secret: env.AUTH_SECRET,
    database: prismaAdapter(db, { provider: 'postgresql' }),
    secondaryStorage: createValkeySecondaryStorage(valkey),
    trustedOrigins: [env.APP_URL, ...env.DEV_ORIGINS],
    emailAndPassword: {
      enabled: true,
      disableSignUp: true, // users are created by admins (docs/07 §6)
      requireEmailVerification: false, // ownership is proven by completing the set-password link
      minPasswordLength: 12,
      maxPasswordLength: 128,
      autoSignIn: false,
      resetPasswordTokenExpiresIn: RESET_LINK_SECONDS,
      revokeSessionsOnPasswordReset: true,
      async sendResetPassword({ user, url }) {
        const [welcome, installation] = await Promise.all([
          valkey.getdel(`${WELCOME_FLAG_PREFIX}${user.id}`),
          readInstallation(db, env.APP_URL),
        ]);
        const timeZone = timeZoneOf(user);
        const message =
          welcome === null
            ? passwordReset({ to: user.email, url, installation, timeZone })
            : welcomeSetPassword({
                to: user.email,
                name: user.name,
                url,
                installation,
                invitedBy: invitedByFrom(welcome),
                timeZone,
              });
        await mailer.send(message);
      },
      async onPasswordReset({ user }) {
        // completing the emailed link proves mailbox ownership
        await db.user.update({ where: { id: user.id }, data: { emailVerified: true } });
      },
    },
    emailVerification: {
      expiresIn: VERIFY_LINK_SECONDS,
      async sendVerificationEmail({ user, url }) {
        const installation = await readInstallation(db, env.APP_URL);
        await mailer.send(verifyEmail({ to: user.email, url, installation }));
      },
    },
    session: {
      expiresIn: 60 * 60 * 12,
      updateAge: 60 * 60,
      freshAge: 60 * 10,
      // No cookie cache: revocation, role changes and deactivation must take effect immediately.
      // Session lookups are served from Valkey (secondaryStorage), so this costs no DB round trip.
      cookieCache: { enabled: false },
    },
    user: {
      additionalFields: {
        extension: { type: 'string', required: false, input: false },
        teamId: { type: 'string', required: false, input: false },
        phone: { type: 'string', required: false, input: false },
        timezone: { type: 'string', required: false, defaultValue: 'Africa/Nairobi', input: false },
        locale: { type: 'string', required: false, defaultValue: 'en', input: false },
        isActive: { type: 'boolean', required: false, defaultValue: true, input: false },
        avatarKey: { type: 'string', required: false, input: false },
      },
      changeEmail: { enabled: false },
      deleteUser: { enabled: false },
    },
    rateLimit: {
      enabled: env.NODE_ENV !== 'test',
      storage: 'secondary-storage',
      window: 60,
      max: 60,
      customRules: {
        '/sign-in/email': { window: 60, max: 5 },
        '/two-factor/verify-totp': { window: 60, max: 5 },
        '/two-factor/verify-backup-code': { window: 60, max: 5 },
        '/request-password-reset': { window: 300, max: 3 },
        '/reset-password': { window: 300, max: 5 },
      },
    },
    advanced: {
      useSecureCookies: isProd,
      cookiePrefix: 'crm',
      database: { generateId: () => newId() },
      // the Fastify handler overwrites x-forwarded-for with the proxy-resolved client ip (docs/08 A3)
      ipAddress: { ipAddressHeaders: ['x-forwarded-for'] },
    },
    databaseHooks: {
      session: {
        create: {
          async before(session) {
            const user = await db.user.findUnique({
              where: { id: session.userId },
              select: { isActive: true },
            });
            if (!user?.isActive) {
              throw new APIError('FORBIDDEN', { message: 'This account is deactivated' });
            }
            return undefined;
          },
        },
      },
    },
    plugins: [
      admin({
        ac,
        roles,
        defaultRole: 'agent',
        adminRoles: ['admin'],
        impersonationSessionDuration: isProd ? 1 : 60 * 60,
      }),
      twoFactor({ issuer: appName, skipVerificationOnEnable: false }),
      // k-anonymity breach check calls api.pwnedpasswords.com — never from tests
      ...(env.NODE_ENV === 'test'
        ? []
        : [
            haveIBeenPwned({
              customPasswordCompromisedMessage:
                'This password appears in a known data breach; choose another.',
            }),
          ]),
      ...(isProd ? [] : [openAPI()]),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
export type AuthSession = Auth['$Infer']['Session'];
export type AuthUser = AuthSession['user'];
