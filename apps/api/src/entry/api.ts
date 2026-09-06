/**
 * `api` process: HTTP API + Socket.IO (docs/03 §1).
 */
import { buildApp } from '../app.js';
import { loadEnv } from '../config/env.js';

async function main(): Promise<void> {
  const env = loadEnv({ ...process.env, APP_MODE: 'api' });
  const app = await buildApp({ env });

  const shutdown = (signal: string) => {
    app.log.info({ signal }, 'shutting down');
    const timer = setTimeout(() => {
      app.log.error('forced exit after 25s');
      process.exit(1);
    }, 25_000);
    timer.unref();
    app
      .close()
      .then(() => process.exit(0))
      .catch((err: unknown) => {
        app.log.error({ err }, 'error during shutdown');
        process.exit(1);
      });
  };
  process.on('SIGTERM', () => {
    shutdown('SIGTERM');
  });
  process.on('SIGINT', () => {
    shutdown('SIGINT');
  });
  process.on('unhandledRejection', (reason) => {
    app.log.fatal({ err: reason }, 'unhandled rejection');
    shutdown('unhandledRejection');
  });

  await app.listen({ host: env.API_HOST, port: env.API_PORT });
}

main().catch((err: unknown) => {
  // logger may not exist yet (env failure) — this is the one permitted console usage
  // eslint-disable-next-line no-console
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
