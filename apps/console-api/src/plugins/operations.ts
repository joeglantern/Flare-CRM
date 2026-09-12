/**
 * The services that need more than a database: alerts send email and shout at owner browsers,
 * support commands ride the link, owner actions reach into Better Auth. They are registered after
 * those things exist rather than alongside the plain ones.
 */
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { ownerContact as ownerContactSchema } from '@crm/shared';
import { AlertsService } from '../modules/alerts.service.js';
import { CustomersService } from '../modules/customers.service.js';
import { DiagnosticsService } from '../modules/diagnostics.service.js';
import { OwnersService } from '../modules/owners.service.js';
import { SupportService } from '../modules/support.service.js';
import { readOwnerContact } from '../lib/owner-contact.js';

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
      'diagnostics',
      new DiagnosticsService({ db: app.db, link: app.link, audit: app.audit }),
    );
    // Here rather than in `services`, because filing a customer away ends in a signed document
    // going down the link, and the link does not exist that early.
    app.decorate(
      'customers',
      new CustomersService({
        db: app.db,
        audit: app.audit,
        entitlements: app.entitlements,
        link: app.link,
        ownerContact: () => readOwnerContact(app.db),
      }),
    );
    app.decorate(
      'alerts',
      new AlertsService({
        db: app.db,
        mailer: app.mailer,
        log: app.log,
        settings: app.settings,
        consoleUrl: app.config.CONSOLE_URL,
        ...(app.config.MAIL_MARK_URL === undefined ? {} : { markUrl: app.config.MAIL_MARK_URL }),
        /**
         * Who hears about one kind of alert. A kind with its own list gets that; anything else
         * goes to the general one, and with neither set it falls back to the provider contact the
         * customers themselves are given, which is always somebody real.
         */
        recipientsFor: async (kind: string) => {
          const configured = await app.settings.alertRecipients();
          const chosen = configured.byKind[kind] ?? configured.default;
          if (chosen.length > 0) return chosen;
          const row = await app.db.consoleSetting.findUnique({ where: { key: OWNER_CONTACT_KEY } });
          const parsed = ownerContactSchema.safeParse(row?.value);
          const fallback = parsed.success
            ? parsed.data.email
            : (app.config.FIRST_OWNER_EMAIL ?? '');
          return fallback === '' ? [] : [fallback];
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
