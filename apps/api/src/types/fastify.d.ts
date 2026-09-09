import type { IncomingHttpHeaders } from 'node:http';
import type { Redis } from 'ioredis';
import type { Auth, AuthSession, AuthUser } from '../auth/auth.js';
import type { Env } from '../config/env.js';
import type { Storage } from '../integrations/storage/storage.js';
import type { QUEUES } from '../jobs/queues.js';
import type { CustomFieldsValidator } from '../lib/custom-fields.js';
import type { ActivityService } from '../modules/activity/activity.service.js';
import type { AuditService } from '../modules/audit/audit.service.js';
import type { NotificationsService } from '../modules/notifications/notifications.service.js';
import type { SettingsService } from '../modules/settings/settings.service.js';
import type { EntitlementsService } from '../modules/entitlements/entitlements.service.js';
import type { StorageUsage } from '../modules/entitlements/usage.js';
import type { RouteAuth } from '../plugins/authorize.js';
import type { EventBus } from '../plugins/event-bus.js';
import type { ReadinessRegistry } from '../plugins/health.js';
import type { Mailer } from '../plugins/mailer.js';
import type { Db } from '../plugins/prisma.js';
import type { Queues } from '../plugins/queues.js';
import type { Broadcaster } from '../lib/realtime.js';
import type { Server } from 'socket.io';
import type { Cti } from '../plugins/cti.js';
import type { MessagingService } from '../modules/messaging/messaging.service.js';
import type { WhatsAppAdapter } from '../integrations/messaging/whatsapp-adapter.js';

declare module 'fastify' {
  interface FastifyInstance {
    config: Env;
    valkey: Redis;
    readiness: ReadinessRegistry;
    db: Db;
    mailer: Mailer;
    storage: Storage;
    queues: Queues;
    QUEUES: typeof QUEUES;
    events: EventBus;
    auth: Auth;
    getSession: (headers: IncomingHttpHeaders) => Promise<AuthSession | null>;
    settings: SettingsService;
    entitlements: EntitlementsService;
    storageUsage: StorageUsage;
    audit: AuditService;
    activity: ActivityService;
    notifications: NotificationsService;
    customFields: CustomFieldsValidator;
    realtime: Broadcaster;
    io: Server;
    cti: Cti;
    messaging: MessagingService;
    whatsappAdapter: WhatsAppAdapter;
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
