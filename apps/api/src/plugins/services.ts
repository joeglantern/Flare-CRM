/**
 * Cross-cutting services that many modules need (settings, audit, activity, notifications,
 * custom-field validation). Registered once, before auth and modules.
 */
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { CustomFieldsValidator } from '../lib/custom-fields.js';
import { ActivityService } from '../modules/activity/activity.service.js';
import { AuditService } from '../modules/audit/audit.service.js';
import { NotificationsService } from '../modules/notifications/notifications.service.js';
import { SettingsService } from '../modules/settings/settings.service.js';

export default fp(
  async function services(app: FastifyInstance) {
    const settings = new SettingsService(app.db, app.valkey);
    await settings.start();
    app.decorate('settings', settings);
    app.decorate('audit', new AuditService(app.db));
    app.decorate('activity', new ActivityService(app.db));
    app.decorate(
      'notifications',
      new NotificationsService(app.db, app.queues, app.events, app.config.APP_URL),
    );
    app.decorate('customFields', new CustomFieldsValidator(app.db));
    app.addHook('onClose', async () => {
      await settings.stop();
    });
  },
  { name: 'services', dependencies: ['prisma', 'valkey', 'queues', 'event-bus'] },
);
