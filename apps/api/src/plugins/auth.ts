/**
 * Mounts Better Auth under /api/auth/* and exposes `app.auth` + `app.getSession()` (docs/07 §1).
 * Sign-in failures are audited here because Better Auth's `after` hooks only run on success.
 */
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { fromNodeHeaders } from 'better-auth/node';
import type { IncomingHttpHeaders } from 'node:http';
import { z } from 'zod';
import { createAuth, type AuthSession } from '../auth/auth.js';
import { AuditService } from '../modules/audit/audit.service.js';
import { NotFoundError } from '../lib/errors.js';
import { auditContext } from '../lib/request.js';

const AUDITED: Record<string, string> = {
  '/api/auth/sign-in/email': 'auth.sign_in',
  '/api/auth/sign-out': 'auth.sign_out',
  '/api/auth/change-password': 'auth.password_changed',
  '/api/auth/reset-password': 'auth.password_reset',
  '/api/auth/request-password-reset': 'auth.password_reset_requested',
  '/api/auth/two-factor/enable': 'auth.two_factor_enabled',
  '/api/auth/two-factor/disable': 'auth.two_factor_disabled',
  '/api/auth/two-factor/verify-totp': 'auth.two_factor_verified',
};
// Nothing under /api/auth/admin/ is listed, because nothing under it is reachable: the handler
// refuses that prefix outright. Entries here would say the door exists and is merely watched.

const bodyEmail = z.object({ email: z.string().max(254).optional() });

export default fp(
  function authPlugin(app: FastifyInstance) {
    const auth = createAuth({
      env: app.config,
      db: app.db,
      valkey: app.valkey,
      mailer: app.mailer,
      log: app.log,
    });
    const audit = new AuditService(app.db);
    app.decorate('auth', auth);

    app.decorate(
      'getSession',
      async (headers: IncomingHttpHeaders): Promise<AuthSession | null> => {
        return auth.api.getSession({ headers: fromNodeHeaders(headers) });
      },
    );

    app.route({
      method: ['GET', 'POST'],
      url: '/api/auth/*',
      config: { auth: { public: true }, rateLimit: { max: 120, timeWindow: '1 minute' } },
      schema: { hide: true },
      async handler(request, reply) {
        const url = new URL(request.url, app.config.APP_URL);

        /*
         * Better Auth's admin surface is shut, exactly as it is in the console (docs/21).
         *
         * This route is declared public, so the authorize hook never runs on it: no permission
         * check, no feature check, and no plan-expiry check. Behind it, an administrator's role
         * carries Better Auth's full admin access, which reaches creating a user, deleting one,
         * impersonating one, and setting another person's password or email.
         *
         * Every one of those has a house rule that lives somewhere else and would be skipped here.
         * Creating a user through this door adds a seat without `assertLimit('seats')`, and seats
         * are the main thing a plan sells. Deleting one skips the refusal that keeps a departed
         * person's work attributed to them, and the foreign keys then quietly strip their name off
         * it. None of it is audited by us, and work done while impersonating is recorded as the
         * impersonated person.
         *
         * Nothing needs the HTTP surface: the browser uses sign-in, sign-out, the session and the
         * second factor, and the server's own admin calls go through `auth.api.*` in process, which
         * never passes through this mount. Answered as a route that does not exist rather than one
         * you may not use, so it says nothing about what is behind it.
         */
        if (url.pathname.startsWith('/api/auth/admin/')) {
          await app.audit
            .write(auditContext(request), {
              action: 'access.denied',
              entity: 'auth',
              after: { method: request.method, url: url.pathname },
            })
            .catch(() => undefined);
          throw new NotFoundError('Route');
        }

        const headers = fromNodeHeaders(request.headers);
        headers.set('x-forwarded-for', request.ip);
        const init: RequestInit = { method: request.method, headers };
        if (
          request.method === 'POST' &&
          request.rawBody !== undefined &&
          request.rawBody.length > 0
        ) {
          init.body = new Uint8Array(request.rawBody);
        }
        const response = await auth.handler(new Request(url, init));

        void reply.status(response.status);
        response.headers.forEach((value, key) => {
          if (key.toLowerCase() !== 'set-cookie') void reply.header(key, value);
        });
        const cookies = response.headers.getSetCookie();
        if (cookies.length > 0) void reply.header('set-cookie', cookies);

        const path = url.pathname;
        const action = AUDITED[path];
        if (action !== undefined && request.method === 'POST') {
          const session = response.ok
            ? await app.getSession({
                ...request.headers,
                cookie: mergeCookies(request.headers.cookie, cookies),
              })
            : null;
          const parsedBody = bodyEmail.safeParse(request.body ?? {});
          const email = parsedBody.success ? parsedBody.data.email : undefined;
          const outcome = response.ok ? action : `${action}_failed`;
          try {
            await audit.write(
              {
                actorId: session?.user.id ?? null,
                ip: request.ip,
                userAgent: request.headers['user-agent'] ?? null,
                requestId: request.id,
              },
              {
                action: outcome,
                entity: 'auth',
                entityId: session?.user.id ?? null,
                ...(email ? { after: { email } } : {}),
              },
            );
          } catch (err) {
            request.log.error({ err }, 'audit write failed');
          }
        }

        const text = await response.text();
        return reply.send(text);
      },
    });
  },
  { name: 'auth', dependencies: ['config', 'prisma', 'valkey', 'mailer'] },
);

/** Sign-in sets cookies on the response; to resolve the new session we must read them. */
function mergeCookies(existing: string | undefined, setCookies: string[]): string {
  const jar = new Map<string, string>();
  for (const part of (existing ?? '').split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0) jar.set(part.slice(0, idx).trim(), part.slice(idx + 1).trim());
  }
  for (const sc of setCookies) {
    const first = sc.split(';')[0] ?? '';
    const idx = first.indexOf('=');
    if (idx > 0) jar.set(first.slice(0, idx).trim(), first.slice(idx + 1).trim());
  }
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}
