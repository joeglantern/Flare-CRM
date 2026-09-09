/*
 * Copied from apps/api. The two services are deliberately separate processes with
 * separate databases; this plumbing is identical in both. Candidate for a shared server
 * package once something needs it a third time.
 */
/**
 * Edge security plugins (docs/08 §A, §B, §C2, §G).
 */
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import underPressure from '@fastify/under-pressure';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { getHeapStatistics } from 'node:v8';
import { BadRequestError } from '../lib/errors.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export default fp(
  async function security(app: FastifyInstance) {
    const { config } = app;
    const allowedOrigins = new Set<string>([config.CONSOLE_URL, ...config.DEV_ORIGINS]);

    await app.register(helmet, {
      global: true,
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'none'"],
          frameAncestors: ["'none'"],
          baseUri: ["'none'"],
          formAction: ["'none'"],
        },
      },
      crossOriginOpenerPolicy: { policy: 'same-origin' },
      crossOriginResourcePolicy: { policy: 'same-origin' },
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
      strictTransportSecurity:
        config.NODE_ENV === 'production'
          ? { maxAge: 31536000, includeSubDomains: true, preload: true }
          : false,
      hidePoweredBy: true,
      noSniff: true,
      permittedCrossDomainPolicies: { permittedPolicies: 'none' },
    });

    await app.register(cors, {
      origin: (origin, cb) => {
        // same-origin / non-browser requests carry no Origin header
        if (origin === undefined) {
          cb(null, true);
          return;
        }
        cb(null, allowedOrigins.has(origin));
      },
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id', 'Idempotency-Key'],
      exposedHeaders: ['X-Request-Id', 'Retry-After'],
      maxAge: 86400,
    });

    await app.register(cookie, { hook: 'onRequest' });

    await app.register(rateLimit, {
      global: true,
      max: 300,
      timeWindow: '1 minute',
      redis: config.NODE_ENV === 'test' ? undefined : app.valkey,
      nameSpace: 'rl:global:',
      keyGenerator: (request: FastifyRequest) =>
        request.user ? `u:${request.user.id}` : `ip:${request.ip}`,
      addHeadersOnExceeding: {
        'x-ratelimit-limit': false,
        'x-ratelimit-remaining': false,
        'x-ratelimit-reset': false,
      },
      addHeaders: {
        'x-ratelimit-limit': false,
        'x-ratelimit-remaining': false,
        'x-ratelimit-reset': true,
        'retry-after': true,
      },
      allowList: (request: FastifyRequest) => request.url === '/health' || request.url === '/ready',
    });

    // load shedding is production behaviour; test suites run many app instances in one process
    if (config.NODE_ENV !== 'test')
      await app.register(underPressure, {
        maxEventLoopDelay: 1000,
        maxEventLoopUtilization: 0.98,
        maxHeapUsedBytes: Math.floor(heapLimitBytes() * 0.9),
        retryAfter: 50,
        exposeStatusRoute: false,
      });

    /**
     * CSRF hardening for our own state-changing routes (docs/08 C2): browsers must send a
     * same-origin Origin (or Sec-Fetch-Site) header. Better Auth routes and webhooks do their own checks.
     */
    app.addHook('onRequest', (request, _reply, done) => {
      if (SAFE_METHODS.has(request.method)) {
        done();
        return;
      }
      const url = request.url;
      if (
        url.startsWith('/webhooks/') ||
        url.startsWith('/api/auth/') ||
        url.startsWith('/public/')
      ) {
        done();
        return;
      }
      const origin = request.headers.origin;
      const fetchSite = request.headers['sec-fetch-site'];
      const crossSite =
        (fetchSite !== undefined &&
          fetchSite !== 'same-origin' &&
          fetchSite !== 'none' &&
          (origin === undefined || !allowedOrigins.has(origin))) ||
        (origin !== undefined && !allowedOrigins.has(origin));
      // no Origin and no Sec-Fetch-Site → non-browser client (tests, CLI); auth is still required
      done(crossSite ? new BadRequestError('Cross-site request rejected') : undefined);
    });
  },
  { name: 'security', dependencies: ['config', 'valkey'] },
);

function heapLimitBytes(): number {
  return getHeapStatistics().heap_size_limit;
}
