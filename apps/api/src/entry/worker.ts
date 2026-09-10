/**
 * `worker` process (docs/03 §1): BullMQ processors, schedulers and the Yeastar CTI subscriber.
 * Reuses the app factory for config/logging/valkey/db/services; the HTTP port is internal-only
 * (Docker healthcheck + /ready).
 */
import { buildApp } from '../app.js';
import { loadEnv } from '../config/env.js';
import { catchUp } from '../integrations/console/catch-up.js';
import { ConsoleLink } from '../integrations/console/link.js';
import { YeastarSubscriber } from '../integrations/yeastar/subscriber.js';
import { reconcileCdrs } from '../integrations/yeastar/reconcile.js';
import { QUEUES } from '../jobs/queues.js';
import { startProcessors } from '../jobs/processors.js';
import { nowIso, rooms } from '../lib/realtime.js';

async function main(): Promise<void> {
  const env = loadEnv({ ...process.env, APP_MODE: 'worker' });
  const app = await buildApp({ env });
  await app.ready();

  const processors = startProcessors(app);

  // nightly retention (docs/08 J3) — 02:30 server time, single run per day across replicas
  await app.queues
    .get(QUEUES.retention)
    .upsertJobScheduler(
      'retention-daily',
      { pattern: '0 30 2 * * *' },
      { name: 'scheduled', data: {} },
    );

  /*
   * The owner console link lives in this process and nowhere else: the api process serves people
   * and never dials out (docs/21). With no console configured the stack runs standalone, which is
   * exactly how it ran before any of this existed.
   */
  let consoleLink: ConsoleLink | null = null;
  if (
    env.CONSOLE_URL !== undefined &&
    env.CONSOLE_STACK_ID !== undefined &&
    env.CONSOLE_STACK_SECRET !== undefined
  ) {
    const consoleConfig = {
      CONSOLE_URL: env.CONSOLE_URL,
      CONSOLE_STACK_ID: env.CONSOLE_STACK_ID,
      CONSOLE_STACK_SECRET: env.CONSOLE_STACK_SECRET,
      APP_URL: env.APP_URL,
      APP_VERSION: env.APP_VERSION,
    };

    // Before the socket: whatever was issued while this stack was down is applied first, so it
    // starts on the current plan rather than on the one it had when it stopped.
    const caught = await catchUp({
      entitlements: app.entitlements,
      log: app.log,
      config: consoleConfig,
    });
    if (caught.result === 'unreachable') {
      app.log.warn({ reason: caught.reason }, 'could not reach the console at boot');
    }

    consoleLink = new ConsoleLink({
      valkey: app.valkey,
      entitlements: app.entitlements,
      readiness: app.readiness,
      storage: app.storage,
      log: app.log,
      config: consoleConfig,
      onAnnounce: (announcement) => {
        app.realtime.to(rooms.all).emit('system:announce', {
          at: nowIso(),
          level: announcement.level,
          message: announcement.message,
        });
        void app.audit
          .write(
            { actorId: null, actorType: 'system' },
            {
              action: 'system.announce',
              entity: 'system',
              after: announcement,
            },
          )
          .catch(() => undefined);
      },
    });
    consoleLink.start();
    app.readiness.register('console', () =>
      Promise.resolve({ configured: true, connected: consoleLink?.connected === true }),
    );
  } else {
    app.log.info('no owner console configured; running standalone');
  }

  let subscriber: YeastarSubscriber | null = null;
  const telephonyPossible =
    app.cti.enabled &&
    app.cti.client !== null &&
    app.cti.tokens !== null &&
    env.YEASTAR_EVENT_SOURCE !== 'webhook';
  const startSubscriber = () => {
    const client = app.cti.client;
    const tokens = app.cti.tokens;
    if (subscriber || !telephonyPossible || !client || !tokens) return;
    subscriber = new YeastarSubscriber({
      valkey: app.valkey,
      tokens,
      machine: app.cti.machine,
      baseUrl: env.YEASTAR_BASE_URL ?? '',
      tls: {
        caFile: env.YEASTAR_TLS_CA_FILE,
        fingerprintSha256: env.YEASTAR_TLS_FINGERPRINT_SHA256,
      },
      log: app.log,
      onStatus: ({ connected }) => {
        app.realtime
          .to([rooms.role('admin'), ...(connected ? [] : [rooms.all])])
          .emit('pbx:status', {
            at: nowIso(),
            connected,
            since: connected ? nowIso() : null,
            lastEventAt: null,
          });
      },
      onConnected: async () => {
        await reconcileCdrs({
          client,
          machine: app.cti.machine,
          valkey: app.valkey,
          pbxTimeZone: env.YEASTAR_TIMEZONE,
          log: app.log,
        });
      },
    });
    subscriber.start();
  };
  const stopSubscriber = async () => {
    if (!subscriber) return;
    await subscriber.stop();
    subscriber = null;
  };

  if (telephonyPossible) {
    if (await app.entitlements.has('telephony')) startSubscriber();
    else app.log.warn('telephony is not in the plan; PBX subscriber not started');
    // Toggling telephony in the owner console takes effect without a restart.
    app.events.on('entitlements.changed', async (e) => {
      if (e.features.telephony === true) startSubscriber();
      else await stopSubscriber();
    });

    // periodic reconciliation + token keep-alive (docs/06 §4, §13)
    await app.queues
      .get(QUEUES.ctiReconcile)
      .upsertJobScheduler(
        'cti-reconcile-10m',
        { every: 10 * 60 * 1000 },
        { name: 'scheduled', data: {} },
      );
    const tokenTimer = setInterval(() => {
      app.cti.tokens?.getAccessToken().catch((err: unknown) => {
        app.log.warn({ err }, 'PBX token keep-alive failed');
      });
    }, 60_000);
    tokenTimer.unref();
  } else if (app.cti.enabled) {
    app.log.info('CTI event source is webhook-only; websocket subscriber not started');
  } else {
    app.log.warn('YEASTAR_ENABLED=false — telephony integration inactive');
  }

  const shutdown = (signal: string) => {
    app.log.info({ signal }, 'worker shutting down');
    const timer = setTimeout(() => process.exit(1), 25_000);
    timer.unref();
    (async () => {
      await subscriber?.stop();
      await consoleLink?.stop();
      await processors.close();
      await app.cti.tokens?.revoke().catch(() => undefined);
      await app.close();
    })()
      .then(() => process.exit(0))
      .catch(() => process.exit(1));
  };
  process.on('SIGTERM', () => {
    shutdown('SIGTERM');
  });
  process.on('SIGINT', () => {
    shutdown('SIGINT');
  });

  await app.listen({ host: env.API_HOST, port: env.API_PORT });
  app.log.info('worker started');
}

main().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
