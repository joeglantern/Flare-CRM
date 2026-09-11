/**
 * The services that need more than a database: alerts send email and shout at owner browsers,
 * support commands ride the link, owner actions reach into Better Auth. They are registered after
 * those things exist rather than alongside the plain ones.
 */
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { ownerContact as ownerContactSchema } from '@crm/shared';
import { AlertsService } from '../modules/alerts.service.js';
import { OwnersService } from '../modules/owners.service.js';
import { SupportService } from '../modules/support.service.js';

const OWNER_CONTACT_KEY = 'ownerContact';

export default fp(
  function operations(app: FastifyInstance) {
    app.decorate(
      'owners',
      new OwnersService({
        db: app.db,
        auth: app.auth,
        audit: app.audit,
        mailer: app.mailer,
        consoleUrl: app.config.CONSOLE_URL,
        ...(app.config.MAIL_MARK_URL === undefined ? {} : { markUrl: app.config.MAIL_MARK_URL }),
        log: app.log,
      }),
    );
    app.decorate('support', new SupportService({ db: app.db, link: app.link, audit: app.audit }));
    app.decorate(
      'alerts',
      new AlertsService({
        db: app.db,
        mailer: app.mailer,
        log: app.log,
        consoleUrl: app.config.CONSOLE_URL,
        ...(app.config.MAIL_MARK_URL === undefined ? {} : { markUrl: app.config.MAIL_MARK_URL }),
        /** Whoever the console is told is the provider's contact, which customers also see. */
        ownerEmail: async () => {
          const row = await app.db.consoleSetting.findUnique({ where: { key: OWNER_CONTACT_KEY } });
          const parsed = ownerContactSchema.safeParse(row?.value);
          return parsed.success ? parsed.data.email : (app.config.FIRST_OWNER_EMAIL ?? '');
        },
        onChange: (change) => {
          app.io.of('/').to('owners').emit('alert:changed', {
            at: new Date().toISOString(),
            id: change.id,
            kind: change.kind,
            level: change.level,
            customerId: change.customerId,
            customerName: change.customerName,
            open: change.open,
            summary: change.summary,
          });
        },
      }),
    );
  },
  { name: 'operations', dependencies: ['services', 'auth', 'link', 'mailer'] },
);
