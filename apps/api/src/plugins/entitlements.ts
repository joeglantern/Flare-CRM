/**
 * Registers the entitlements service (docs/20) before security and authorization so the
 * authorization hook can gate routes on features, and the storage usage counter that limits
 * are checked against. Readiness reports the document in force but never fails on it: a stack
 * with an expired or missing document is still a healthy process.
 */
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { EntitlementsService } from '../modules/entitlements/entitlements.service.js';
import { StorageUsage } from '../modules/entitlements/usage.js';

export default fp(
  async function entitlementsPlugin(app: FastifyInstance) {
    const usage = new StorageUsage(app.valkey, app.db, app.storage);
    const entitlements = new EntitlementsService({
      db: app.db,
      valkey: app.valkey,
      config: app.config,
      audit: app.audit,
      events: app.events,
      settings: app.settings,
      usage,
      log: app.log,
    });
    await entitlements.start();
    app.decorate('entitlements', entitlements);
    app.decorate('storageUsage', usage);
    app.customFields.setFeatureGate(() => entitlements.has('custom_fields'));
    app.readiness.register('entitlements', () => entitlements.readiness());
    app.addHook('onClose', async () => {
      await entitlements.stop();
    });
  },
  { name: 'entitlements', dependencies: ['prisma', 'valkey', 'storage', 'services', 'event-bus'] },
);
