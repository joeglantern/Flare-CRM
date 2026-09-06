/**
 * Prisma 7 client with the node-postgres driver adapter (docs/02).
 * A client extension hides soft-deleted rows by default (docs/05).
 */
import { PrismaPg } from '@prisma/adapter-pg';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { PrismaClient } from '../generated/prisma/client.js';

/** Models that carry `deletedAt` and must be filtered by default. */
const SOFT_DELETE_MODELS = new Set([
  'Contact',
  'Company',
  'Deal',
  'Lead',
  'Task',
  'Note',
  'ContactPhone',
  'ContactEmail',
]);
const READ_OPERATIONS = new Set([
  'findMany',
  'findFirst',
  'findFirstOrThrow',
  'count',
  'aggregate',
  'groupBy',
]);

export function createPrismaClient(
  databaseUrl: string,
  log: { error: (obj: unknown, msg: string) => void },
) {
  const adapter = new PrismaPg({
    connectionString: databaseUrl,
    max: 20,
    idleTimeoutMillis: 30_000,
  });
  const base = new PrismaClient({
    adapter,
    log: [{ emit: 'event', level: 'error' }],
  });
  base.$on('error', (e) => {
    log.error(e, 'prisma error');
  });

  return base.$extends({
    name: 'softDelete',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (SOFT_DELETE_MODELS.has(model) && READ_OPERATIONS.has(operation)) {
            const a = args as { where?: Record<string, unknown>; includeDeleted?: boolean };
            if (a.includeDeleted) {
              const { includeDeleted: _ignored, ...rest } = a;
              return query(rest);
            }
            const where = a.where ?? {};
            if (!('deletedAt' in where)) {
              return query({ ...a, where: { ...where, deletedAt: null } });
            }
          }
          return query(args);
        },
      },
    },
  });
}

export type Db = ReturnType<typeof createPrismaClient>;

export default fp(
  async function prismaPlugin(app: FastifyInstance) {
    const db = createPrismaClient(app.config.DATABASE_URL, app.log);
    await db.$connect();
    app.decorate('db', db);

    app.readiness.register('database', async () => {
      await db.$queryRaw`SELECT 1`;
      return undefined;
    });

    app.addHook('onClose', async () => {
      await db.$disconnect();
    });
  },
  { name: 'prisma', dependencies: ['config', 'health'] },
);
