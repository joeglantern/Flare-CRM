/*
 * Copied from apps/api. The two services are deliberately separate processes with
 * separate databases; this plumbing is identical in both. Candidate for a shared server
 * package once something needs it a third time.
 */
/**
 * Prisma 7 client with the node-postgres driver adapter (docs/02).
 */
import { PrismaPg } from '@prisma/adapter-pg';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { PrismaClient } from '../generated/prisma/client.js';

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

  return base;
}

// The CRM wraps its client in a soft-delete extension; nothing in the console is soft deleted
// (a customer who leaves is marked churned, the audit log is append-only), so there is none here.
export type Db = ReturnType<typeof createPrismaClient>;

export default fp(
  async function prismaPlugin(app: FastifyInstance) {
    const db = createPrismaClient(app.config.CONSOLE_DATABASE_URL, app.log);
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
