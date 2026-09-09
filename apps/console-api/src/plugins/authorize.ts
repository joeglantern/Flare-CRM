/**
 * Route authorization for the console (docs/21). Every route declares `config.auth`, and a
 * missing declaration fails at startup exactly as it does in the CRM.
 *
 * Two-factor is required of everyone here, not only of privileged roles: there is no unprivileged
 * role. The only routes reachable without it are the ones needed to set it up.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { ForbiddenError, TwoFactorRequiredError, UnauthenticatedError } from '../lib/errors.js';
import { auditContext } from '../lib/request.js';
import { roleHasPermission, type Permission } from '../auth/permissions.js';

export type RouteAuth =
  | { public: true }
  /** The stack link: authenticated by a stack id and secret, not by a session. */
  | { stack: true }
  | {
      authenticated?: true;
      permission?: Permission | Permission[];
      /** Only for the routes that set two-factor up in the first place. */
      allowWithout2FA?: boolean;
    };

const PUBLIC_PREFIXES = ['/health', '/ready', '/metrics', '/api/auth/', '/api/link/', '/api/docs'];

export default fp(
  function authorize(app: FastifyInstance) {
    const undeclared: string[] = [];
    app.addHook('onRoute', (route) => {
      const auth = (route.config as { auth?: RouteAuth } | undefined)?.auth;
      if (auth !== undefined) return;
      if (PUBLIC_PREFIXES.some((p) => route.url === p || route.url.startsWith(p))) return;
      if (route.method === 'HEAD' || route.method === 'OPTIONS') return;
      undeclared.push(`${String(route.method)} ${route.url}`);
    });
    app.addHook('onReady', async () => {
      if (undeclared.length > 0) {
        throw new Error(`Routes without config.auth declaration:\n  ${undeclared.join('\n  ')}`);
      }
      return Promise.resolve();
    });

    app.decorateRequest('session', null);
    app.decorateRequest('user', null);

    app.addHook('preValidation', async (request: FastifyRequest) => {
      const auth = (request.routeOptions.config as { auth?: RouteAuth }).auth;
      if (auth === undefined || 'public' in auth || 'stack' in auth) return;

      const session = await app.getSession(request.headers);
      if (!session) throw new UnauthenticatedError();

      const fresh = await app.db.user.findUnique({
        where: { id: session.user.id },
        select: {
          isActive: true,
          banned: true,
          banExpires: true,
          role: true,
          twoFactorEnabled: true,
        },
      });
      if (!fresh) throw new UnauthenticatedError();
      const banActive =
        fresh.banned === true && (fresh.banExpires === null || fresh.banExpires > new Date());
      if (!fresh.isActive || banActive) throw new UnauthenticatedError('Account is not active');

      request.session = session;
      request.user = { ...session.user, ...fresh };
      const role = fresh.role ?? 'owner';

      if (!auth.allowWithout2FA && fresh.twoFactorEnabled !== true) {
        throw new TwoFactorRequiredError();
      }

      if (auth.permission !== undefined) {
        const required = Array.isArray(auth.permission) ? auth.permission : [auth.permission];
        const missing = required.filter((p) => !roleHasPermission(role, p));
        if (missing.length > 0) {
          request.log.info({ userId: session.user.id, missing }, 'permission denied');
          await app.audit
            .write(auditContext(request), {
              action: 'access.denied',
              entity: 'route',
              after: { required: missing, method: request.method, url: request.routeOptions.url },
            })
            .catch(() => undefined);
          throw new ForbiddenError('Insufficient permissions', { required: missing });
        }
      }
    });
  },
  { name: 'authorize', dependencies: ['auth'] },
);
