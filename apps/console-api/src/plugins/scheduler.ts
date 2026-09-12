/**
 * The console's background work (docs/21 §8).
 *
 * There is no queue here and no worker process: this service is one small API and its scheduled
 * work is three timers. They sit behind a Valkey lock anyway, so that if the console is ever run
 * as two replicas the rollup does not race itself and nobody is emailed twice about the same
 * silent stack.
 *
 * Everything a timer does is idempotent. A tick that is missed, or one that runs twice, leaves the
 * same rows behind, which is what makes an interval an acceptable substitute for a scheduler.
 */
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { newId } from '../lib/ids.js';

const LOCK_KEY = 'console:scheduler';
const LOCK_TTL_MS = 60_000;
const ROLLUP_EVERY_MS = 10 * 60_000;
const ALERTS_EVERY_MS = 5 * 60_000;
const PRUNE_EVERY_MS = 24 * 60 * 60_000;
/** Long enough after boot that a restart loop cannot hammer the database. */
const FIRST_RUN_DELAY_MS = 20_000;

export default fp(
  function scheduler(app: FastifyInstance) {
    const instanceId = newId();
    const timers: NodeJS.Timeout[] = [];

    /** Only the holder of the lock does the work; everyone else quietly skips this tick. */
    const asLeader = async (what: string, run: () => Promise<void>): Promise<void> => {
      const held = await app.valkey
        .set(LOCK_KEY, instanceId, 'PX', LOCK_TTL_MS, 'NX')
        .catch(() => null);
      if (held !== 'OK') return;
      try {
        await run();
      } catch (err) {
        app.log.error({ err, what }, 'scheduled work failed');
      } finally {
        // Released rather than left to expire, so the next tick is not blocked for a minute.
        const current = await app.valkey.get(LOCK_KEY).catch(() => null);
        if (current === instanceId) await app.valkey.del(LOCK_KEY).catch(() => undefined);
      }
    };

    const every = (ms: number, what: string, run: () => Promise<void>) => {
      const timer = setInterval(() => {
        void asLeader(what, run);
      }, ms);
      timer.unref();
      timers.push(timer);
    };

    const start = setTimeout(() => {
      void asLeader('rollup', async () => {
        const summary = await app.rollup.run();
        app.log.info(summary, 'rollup complete');
      });
      void asLeader('alerts', async () => {
        const summary = await app.alerts.sweep();
        if (summary.opened > 0 || summary.resolved > 0) app.log.info(summary, 'alerts swept');
      });
    }, FIRST_RUN_DELAY_MS);
    start.unref();
    timers.push(start);

    every(ROLLUP_EVERY_MS, 'rollup', async () => {
      const summary = await app.rollup.run();
      app.log.info(summary, 'rollup complete');
    });

    every(ALERTS_EVERY_MS, 'alerts', async () => {
      const summary = await app.alerts.sweep();
      if (summary.opened > 0 || summary.resolved > 0) app.log.info(summary, 'alerts swept');
    });

    every(PRUNE_EVERY_MS, 'prune', async () => {
      // How long each kind is kept is an owner's setting, read each time rather than at boot so a
      // change on the settings screen takes effect at the next nightly run.
      const summary = await app.rollup.prune(new Date(), await app.settings.retention());
      app.log.info(summary, 'what the console had finished with was pruned');
      await app.audit.write(
        { actorId: null, actorType: 'system' },
        { action: 'analytics.prune', entity: 'system', after: summary },
      );
    });

    app.addHook('onClose', () => {
      for (const timer of timers) clearInterval(timer);
      return Promise.resolve();
    });
  },
  { name: 'scheduler', dependencies: ['config', 'valkey', 'prisma', 'services', 'link'] },
);
