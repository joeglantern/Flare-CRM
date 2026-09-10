/**
 * The console's own services: audit, signing, entitlement merging, stack credentials.
 */
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { promises as dns } from 'node:dns';
import { createSigner } from '../lib/signing.js';
import { AnalyticsService } from '../modules/analytics.service.js';
import { AuditService } from '../modules/audit.service.js';
import { ConsoleEntitlementsService } from '../modules/entitlements.service.js';
import { RollupService } from '../modules/rollup.service.js';
import { StacksService } from '../modules/stacks.service.js';

export default fp(
  function services(app: FastifyInstance) {
    const signer = createSigner(app.config);
    app.decorate('signer', signer);
    app.decorate('audit', new AuditService(app.db));
    app.decorate(
      'entitlements',
      new ConsoleEntitlementsService(app.db, signer, app.config.CONSOLE_URL),
    );
    app.decorate(
      'stacks',
      new StacksService(app.db, app.config.CONSOLE_URL, signer.publicKeySpkiBase64),
    );
    app.decorate('analytics', new AnalyticsService(app.db));
    app.decorate('rollup', new RollupService(app.db));
    // Injected so domain verification can be tested without touching real DNS.
    app.decorate('dnsResolver', {
      resolveCname: (h: string) => dns.resolveCname(h),
      resolveTxt: (h: string) => dns.resolveTxt(h),
      resolve4: (h: string) => dns.resolve4(h),
    });
  },
  { name: 'services', dependencies: ['config', 'prisma'] },
);
