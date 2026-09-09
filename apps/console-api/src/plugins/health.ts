/*
 * Copied from apps/api. The two services are deliberately separate processes with
 * separate databases; this plumbing is identical in both. Candidate for a shared server
 * package once something needs it a third time.
 */
/**
 * Liveness and readiness (docs/08 M4, docs/12 §7).
 * `/health` is public and reveals nothing. `/ready` runs registered dependency checks.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { z } from 'zod';

export type ReadinessCheck = () => Promise<Record<string, unknown> | undefined>;

export interface ReadinessResult {
  ok: boolean;
  checks: Record<string, { ok: boolean; detail?: unknown; error?: string }>;
}

export class ReadinessRegistry {
  private readonly checks = new Map<string, ReadinessCheck>();

  register(name: string, check: ReadinessCheck): void {
    if (this.checks.has(name)) throw new Error(`readiness check "${name}" already registered`);
    this.checks.set(name, check);
  }

  async run(): Promise<ReadinessResult> {
    const entries = await Promise.all(
      [...this.checks.entries()].map(
        async ([name, check]): Promise<[string, ReadinessResult['checks'][string]]> => {
          try {
            const detail = await withTimeout(check(), 5000);
            return [name, detail === undefined ? { ok: true } : { ok: true, detail }];
          } catch (err) {
            return [name, { ok: false, error: err instanceof Error ? err.message : String(err) }];
          }
        },
      ),
    );
    return { ok: entries.every(([, r]) => r.ok), checks: Object.fromEntries(entries) };
  }
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`timed out after ${ms}ms`));
    }, ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const PRIVATE_RANGES = [
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^::1$/,
  /^fc/,
  /^fd/,
  /^::ffff:(127|10|192\.168)\./,
];

function isInternalCaller(request: FastifyRequest): boolean {
  return PRIVATE_RANGES.some((r) => r.test(request.ip));
}

export default fp(
  function health(app: FastifyInstance) {
    const registry = new ReadinessRegistry();
    app.decorate('readiness', registry);

    app.get(
      '/health',
      {
        schema: { hide: true, response: { 200: z.object({ status: z.literal('ok') }) } },
        logLevel: 'silent',
      },
      () => ({ status: 'ok' as const }),
    );

    app.get('/ready', { schema: { hide: true }, logLevel: 'silent' }, async (request, reply) => {
      const result = await registry.run();
      const detailed =
        isInternalCaller(request) || request.user?.role?.split(',').includes('admin') === true;
      void reply.status(result.ok ? 200 : 503);
      const status = result.ok ? 'ready' : 'degraded';
      return detailed ? { status, ...result } : { status };
    });
  },
  { name: 'health' },
);
