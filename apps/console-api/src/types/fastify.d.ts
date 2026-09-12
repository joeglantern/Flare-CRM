import type { IncomingHttpHeaders } from 'node:http';
import type { Redis } from 'ioredis';
import type { Server } from 'socket.io';
import type { Auth, AuthSession, AuthUser } from '../auth/auth.js';
import type { RoleName } from '../auth/permissions.js';
import type { Env } from '../config/env.js';
import type { Signer } from '../lib/signing.js';
import type { AlertsService } from '../modules/alerts.service.js';
import type { AnalyticsService } from '../modules/analytics.service.js';
import type { AuditService } from '../modules/audit.service.js';
import type { CustomersService } from '../modules/customers.service.js';
import type { OwnersService } from '../modules/owners.service.js';
import type { RollupService } from '../modules/rollup.service.js';
import type { ConsoleSettingsService } from '../modules/settings.service.js';
import type { SupportService } from '../modules/support.service.js';
import type { ConsoleEntitlementsService } from '../modules/entitlements.service.js';
import type { StacksService } from '../modules/stacks.service.js';
import type { ConsoleLink } from '../plugins/link.js';
import type { RouteAuth } from '../plugins/authorize.js';
import type { ReadinessRegistry } from '../plugins/health.js';
import type { Mailer } from '../plugins/mailer.js';
import type { Db } from '../plugins/prisma.js';

export interface DnsResolver {
  resolveCname: (hostname: string) => Promise<string[]>;
  resolveTxt: (hostname: string) => Promise<string[][]>;
  resolve4: (hostname: string) => Promise<string[]>;
}

declare module 'fastify' {
  interface FastifyInstance {
    config: Env;
    valkey: Redis;
    readiness: ReadinessRegistry;
    db: Db;
    mailer: Mailer;
    auth: Auth;
    getSession: (headers: IncomingHttpHeaders) => Promise<AuthSession | null>;
    audit: AuditService;
    analytics: AnalyticsService;
    rollup: RollupService;
    settings: ConsoleSettingsService;
    alerts: AlertsService;
    owners: OwnersService;
    customers: CustomersService;
    support: SupportService;
    signer: Signer;
    entitlements: ConsoleEntitlementsService;
    stacks: StacksService;
    dnsResolver: DnsResolver;
    io: Server;
    link: ConsoleLink;
    /** Creates an account and emails them a set-password link. */
    inviteOwner: (
      name: string,
      email: string,
      actorHeaders: IncomingHttpHeaders,
      role?: RoleName,
    ) => Promise<{ id: string }>;
  }
  interface FastifyRequest {
    rawBody?: Buffer;
    session: AuthSession | null;
    user: AuthUser | null;
  }
  interface FastifyContextConfig {
    auth?: RouteAuth;
  }
}
