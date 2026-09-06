/**
 * Valkey (Redis-protocol) client (docs/02). One shared client for commands; subscribers
 * create their own connections via `app.valkey.duplicate()`.
 */
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { Redis } from 'ioredis';

export function createValkeyClient(url: string, name: string): Redis {
  return new Redis(url, {
    connectionName: `crm-${name}`,
    lazyConnect: true,
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    enableOfflineQueue: true,
    retryStrategy: (times) => Math.min(1000 * 2 ** Math.min(times, 5), 30_000),
  });
}

export default fp(
  async function valkey(app: FastifyInstance) {
    const client = createValkeyClient(app.config.VALKEY_URL, app.config.APP_MODE);
    client.on('error', (err: Error) => {
      app.log.error({ err }, 'valkey connection error');
    });
    await client.connect();
    app.decorate('valkey', client);

    app.readiness.register('valkey', async () => {
      await client.ping();
      return undefined;
    });

    app.addHook('onClose', async () => {
      await client.quit().catch(() => {
        client.disconnect();
      });
    });
  },
  { name: 'valkey', dependencies: ['config', 'health'] },
);
