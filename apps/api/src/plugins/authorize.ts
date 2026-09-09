/**
 * Route authorization (docs/07 §3, docs/08 §D).
 * Every route MUST declare `config.auth`. Missing declarations fail at startup.
 *
 *   config: { auth: { public: true } }
 *   config: { auth: { authenticated: true } }
 *   config: { auth: { permission: 'contact:read' } }
 */
import { FEATURES, roleHasPermission, type FeatureKey, type Permission } from '@crm/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import {
  FeatureNotInPlanError,
  ForbiddenError,
  PlanExpiredError,
  TwoFactorRequiredError,
  UnauthenticatedError,
} from '../lib/errors.js';
import { auditContext } from '../lib/request.js';
import type { EntitlementsService } from '../modules/entitlements/entitlements.service.js';
import type { SettingsService } from '../modules/settings/settings.service.js';

export type RouteAuth =
  | { public: true }
  | {
      authenticated?: true;
      permission?: Permission | Permission[];
      /** Routes needed to *set up* 2FA or read own profile. */
      allowWithout2FA?: boolean;
      /** Plan features that must all be on (docs/20 §4). */
      feature?: FeatureKey | FeatureKey[];
      /**
       * Whether this route changes data. Defaults to "anything but GET, HEAD, OPTIONS", which
       * is what an expired plan refuses. Set explicitly for a POST that only reads.
       */
      write?: boolean;
    };

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** URL prefixes that may be public without declaring config.auth (docs/08 D4). */
const PUBLIC_PREFIXES = [
  '/health',
  '/ready',
  '/metrics',
  '/api/auth/',
  '/webhooks/',
  '/public/',
  '/api/docs',
];

const PRIVILEGED_ROLES = new Set(['admin', 'manager']);

export function hasRole(role: string | null | undefined, wanted: string): boolean {
  return (role ?? '').split(',').some((r) => r.trim() === wanted);
}

/**
 * Whether this role must have two-factor enabled before it may use anything. Exported because
 * GET /users/me reports it: that route is deliberately reachable without 2FA, so a client cannot
 * discover the requirement by being refused, and would otherwise load the app and have every
 * other request rejected.
 */
export function twoFactorRequiredFor(
  role: string | null | undefined,
  security: { require2FAForAll: boolean; require2FAForPrivileged: boolean },
): boolean {
  const privileged = [...PRIVILEGED_ROLES].some((r) => hasRole(role, r));
  return security.require2FAForAll || (security.require2FAForPrivileged && privileged);
}

export default fp(
  function authorize(
    app: FastifyInstance,
    opts: { settings: SettingsService; entitlements: EntitlementsService },
  ) {
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
      if (auth === undefined || 'public' in auth) return;

      const session = await app.getSession(request.headers);
      if (!session) throw new UnauthenticatedError();

      // Better Auth caches the user snapshot with the session; security-relevant flags must be fresh
      // (deactivation, bans, role changes, 2FA enrolment). One indexed PK read per request.
      const fresh = await app.db.user.findUnique({
        where: { id: session.user.id },
        select: {
          isActive: true,
          banned: true,
          banExpires: true,
          role: true,
          twoFactorEnabled: true,
          teamId: true,
          extension: true,
        },
      });
      if (!fresh) throw new UnauthenticatedError();
      const banActive =
        fresh.banned === true && (fresh.banExpires === null || fresh.banExpires > new Date());
      if (!fresh.isActive || banActive) throw new UnauthenticatedError('Account is not active');

      const user = { ...session.user, ...fresh };
      request.session = session;
      request.user = user;
      const role = user.role ?? 'agent';

      const declared = auth;
      if (!declared.allowWithout2FA) {
        const security = await opts.settings.get('security');
        if (twoFactorRequiredFor(role, security) && user.twoFactorEnabled !== true) {
          throw new TwoFactorRequiredError();
        }
      }

      if (declared.permission !== undefined) {
        const required = Array.isArray(declared.permission)
          ? declared.permission
          : [declared.permission];
        const missing = required.filter((p) => !roleHasPermission(role, p));
        if (missing.length > 0) {
          request.log.info({ userId: user.id, missing }, 'permission denied');
          await denied(request, { reason: 'FORBIDDEN', required: missing });
          throw new ForbiddenError('Insufficient permissions', { required: missing });
        }
      }

      // Plan gates come after permissions so a user who could never use a feature is told about
      // their role, not about the plan. Both are audited (docs/08 K2).
      if (declared.feature !== undefined) {
        const required = Array.isArray(declared.feature) ? declared.feature : [declared.feature];
        for (const feature of required) {
          if (!(await opts.entitlements.has(feature))) {
            await denied(request, { reason: 'FEATURE_NOT_IN_PLAN', feature });
            throw new FeatureNotInPlanError(feature, FEATURES[feature].label);
          }
        }
      }
      const isWrite = declared.write ?? !READ_METHODS.has(request.method);
      if (isWrite && !declared.allowWithout2FA && (await opts.entitlements.isExpired())) {
        const state = await opts.entitlements.getState();
        await denied(request, { reason: 'PLAN_EXPIRED', expiredAt: state.doc.expiresAt });
        throw new PlanExpiredError(state.doc.expiresAt ?? '');
      }
    });

    /** Refusals are part of the record: the owner can see a plan being hit, not only bypassed. */
    async function denied(request: FastifyRequest, detail: Record<string, unknown>): Promise<void> {
      await app.audit.write(auditContext(request), {
        action: 'access.denied',
        entity: 'route',
        after: { ...detail, method: request.method, url: request.routeOptions.url ?? request.url },
      });
    }
  },
  { name: 'authorize', dependencies: ['auth'] },
);
