/**
 * Application factory. Used by both entrypoints and by tests (`app.inject()`).
 * Plugin registration order matters: config → health → valkey → prisma → mailer → services →
 * security → request-context → auth → authorize → openapi → modules.
 */
import Fastify, { type FastifyBaseLogger, type FastifyInstance, LogController } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { type Env } from './config/env.js';
import { buildLoggerOptions } from './config/logger.js';
import { errorHandler, notFoundHandler } from './lib/error-handler.js';
import { isUuid, newId } from './lib/ids.js';
import modules, { API_PREFIX, webhookModules } from './modules/index.js';
import authPlugin from './plugins/auth.js';
import authorizePlugin from './plugins/authorize.js';
import configPlugin from './plugins/config.js';
import ctiPlugin from './plugins/cti.js';
import eventBusPlugin from './plugins/event-bus.js';
import healthPlugin from './plugins/health.js';
import mailerPlugin from './plugins/mailer.js';
import messagingPlugin from './plugins/messaging.js';
import metricsPlugin from './plugins/metrics.js';
import openapiPlugin from './plugins/openapi.js';
import prismaPlugin from './plugins/prisma.js';
import queuesPlugin from './plugins/queues.js';
import requestContextPlugin from './plugins/request-context.js';
import securityPlugin from './plugins/security.js';
import servicesPlugin from './plugins/services.js';
import socketPlugin from './plugins/socket.js';
import storagePlugin from './plugins/storage.js';
import valkeyPlugin from './plugins/valkey.js';

export type App = FastifyInstance<
  Server,
  IncomingMessage,
  ServerResponse,
  FastifyBaseLogger,
  ZodTypeProvider
>;

export interface BuildAppOptions {
  env: Env;
  /** Override logger (tests pass `false`). */
  logger?: boolean;
  /** Worker processes skip HTTP modules but keep infrastructure plugins. */
  withHttpModules?: boolean;
}

export async function buildApp(options: BuildAppOptions): Promise<App> {
  const { env } = options;
  const withHttpModules = options.withHttpModules ?? true;

  const app = Fastify({
    logger: options.logger === false ? false : buildLoggerOptions(env),
    // trust exactly N proxy hops (Caddy = 1); hop 0 is the direct peer (docs/08 A3)
    trustProxy: (_address: string, hop: number) => hop < env.TRUST_PROXY_HOPS,
    bodyLimit: 1024 * 1024, // 1 MiB (docs/08 A4)
    connectionTimeout: 10_000,
    requestTimeout: 30_000,
    keepAliveTimeout: 72_000,
    logController: new LogController({ disableRequestLogging: env.NODE_ENV === 'test' }),
    genReqId: (req) => {
      const header = req.headers['x-request-id'];
      const value = Array.isArray(header) ? header[0] : header;
      return value !== undefined && isUuid(value) ? value : newId();
    },
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.setErrorHandler(errorHandler);
  app.setNotFoundHandler(notFoundHandler);

  await app.register(configPlugin, { env });
  await app.register(healthPlugin);
  await app.register(valkeyPlugin);
  await app.register(prismaPlugin);
  await app.register(mailerPlugin);
  await app.register(storagePlugin);
  await app.register(queuesPlugin);
  await app.register(eventBusPlugin);
  await app.register(servicesPlugin);
  await app.register(securityPlugin);
  await app.register(requestContextPlugin);
  await app.register(authPlugin);
  await app.register(authorizePlugin, { settings: app.settings });
  await app.register(socketPlugin);
  await app.register(ctiPlugin);
  await app.register(messagingPlugin);
  await app.register(metricsPlugin);

  if (withHttpModules) {
    if (env.OPENAPI_ENABLED) await app.register(openapiPlugin);
    await app.register(modules, { prefix: API_PREFIX });
    await app.register(webhookModules);
  }

  return app;
}
