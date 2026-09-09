/**
 * Console authentication (docs/21). Same shape as the CRM's, with two differences that matter:
 * there is one role, and two-factor is not optional for anybody. Whoever signs in here can
 * change what every customer is entitled to, so a password on its own is not enough.
 */
import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { APIError } from 'better-auth/api';
import { admin, haveIBeenPwned, openAPI, twoFactor } from 'better-auth/plugins';
import type { Redis } from 'ioredis';
import type { Env } from '../config/env.js';
import { newId } from '../lib/ids.js';
import { createValkeySecondaryStorage } from '../lib/valkey-storage.js';
import type { Mailer } from '../plugins/mailer.js';
import type { Db } from '../plugins/prisma.js';
import { ac, roles } from './permissions.js';

export interface AuthDeps {
  env: Env;
  db: Db;
  valkey: Redis;
  mailer: Mailer;
  log: { warn: (o: unknown, m: string) => void; error: (o: unknown, m: string) => void };
}

/** Set when an owner is invited, so their first email reads as a welcome rather than a reset. */
export const WELCOME_FLAG_PREFIX = 'auth:welcome:';

const APP_NAME = 'Flare Console';
const NEWLINE = String.fromCharCode(10);

function setPasswordEmail(to: string, name: string, url: string, welcome: boolean) {
  const subject = welcome ? `Set up your ${APP_NAME} account` : `Reset your ${APP_NAME} password`;
  const lines = [
    `Hello ${name},`,
    '',
    welcome
      ? `You have been given access to ${APP_NAME}, where customer plans are managed.`
      : 'Someone asked to reset the password on your account.',
    '',
    welcome ? 'Choose a password here:' : 'Set a new password here:',
    url,
    '',
    'The link can be used once and expires in 15 minutes.',
    welcome
      ? 'You will be asked to set up an authenticator app straight afterwards; it is required here.'
      : 'If this was not you, ignore this email and tell the other owners.',
  ];
  return {
    to,
    subject,
    text: lines.join(NEWLINE),
    html: lines
      .map((line) =>
        line === '' ? '<br>' : `<p>${line === url ? `<a href="${url}">${url}</a>` : line}</p>`,
      )
      .join(''),
  };
}

export function createAuth(deps: AuthDeps) {
  const { env, db, valkey, mailer } = deps;
  const isProd = env.NODE_ENV === 'production';

  return betterAuth({
    appName: APP_NAME,
    baseURL: env.CONSOLE_URL,
    basePath: '/api/auth',
    secret: env.CONSOLE_AUTH_SECRET,
    database: prismaAdapter(db, { provider: 'postgresql' }),
    secondaryStorage: createValkeySecondaryStorage(valkey),
    trustedOrigins: [env.CONSOLE_URL, ...env.DEV_ORIGINS],
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      requireEmailVerification: false,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      autoSignIn: false,
      resetPasswordTokenExpiresIn: 60 * 15,
      revokeSessionsOnPasswordReset: true,
      async sendResetPassword({ user, url }) {
        const welcome = await valkey.getdel(`${WELCOME_FLAG_PREFIX}${user.id}`);
        await mailer.send(setPasswordEmail(user.email, user.name, url, welcome !== null));
      },
      async onPasswordReset({ user }) {
        await db.user.update({ where: { id: user.id }, data: { emailVerified: true } });
      },
    },
    session: {
      // Shorter than the CRM's twelve hours: this console can change every customer's plan.
      expiresIn: 60 * 60 * 8,
      updateAge: 60 * 60,
      freshAge: 60 * 10,
      cookieCache: { enabled: false },
    },
    user: {
      additionalFields: {
        isActive: { type: 'boolean', required: false, defaultValue: true, input: false },
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
      // Distinct from the CRM's, so a browser open on both never confuses the two.
      cookiePrefix: 'flarecon',
      database: { generateId: () => newId() },
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
      admin({ ac, roles, defaultRole: 'owner', adminRoles: ['owner'] }),
      twoFactor({ issuer: APP_NAME, skipVerificationOnEnable: false }),
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
