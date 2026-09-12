/**
 * Owner console application (docs/21).
 *
 * Same shape as the CRM's, minus everything a CRM needs and a console does not: no object
 * storage, no queues, no telephony, no messaging. What it adds is the link namespace customer
 * stacks connect to and the signing key they trust.
 *
 * Registration order matters: config, then infrastructure, then services, then auth, then the
 * link, then routes.
 */
import Fastify, { type FastifyBaseLogger, type FastifyInstance, LogController } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { buildLoggerOptions } from './config/logger.js';
import type { Env } from './config/env.js';
import { errorHandler, notFoundHandler } from './lib/error-handler.js';
import { isUuid, newId } from './lib/ids.js';
import authPlugin from './plugins/auth.js';
import authorizePlugin from './plugins/authorize.js';
import configPlugin from './plugins/config.js';
import healthPlugin from './plugins/health.js';
import linkPlugin from './plugins/link.js';
import operationsPlugin from './plugins/operations.js';
import schedulerPlugin from './plugins/scheduler.js';
import mailerPlugin from './plugins/mailer.js';
import prismaPlugin from './plugins/prisma.js';
import requestContextPlugin from './plugins/request-context.js';
import securityPlugin from './plugins/security.js';
import servicesPlugin from './plugins/services.js';
import valkeyPlugin from './plugins/valkey.js';
import analyticsRoutes from './modules/analytics.routes.js';
import consoleRoutes from './modules/console.routes.js';
import linkRoutes from './modules/link.routes.js';
import stacksRoutes from './modules/stacks.routes.js';

export type App = FastifyInstance<
  Server,
  IncomingMessage,
  ServerResponse,
  FastifyBaseLogger,
  ZodTypeProvider
>;

export const API_PREFIX = '/api/v1';

export interface BuildAppOptions {
  env: Env;
  logger?: boolean;
}

export async function buildApp(options: BuildAppOptions): Promise<App> {
  const { env } = options;

  const app = Fastify({
    logger: options.logger === false ? false : buildLoggerOptions(env),
    trustProxy: (_address: string, hop: number) => hop < env.TRUST_PROXY_HOPS,
    bodyLimit: 1024 * 1024,
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
  await app.register(servicesPlugin);
  await app.register(securityPlugin);
  await app.register(requestContextPlugin);
  await app.register(authPlugin);
  await app.register(authorizePlugin);
  await app.register(linkPlugin);
  await app.register(operationsPlugin);
  // Timers only outside tests: a suite should decide when a rollup runs, not a clock.
  if (env.NODE_ENV !== 'test') await app.register(schedulerPlugin);
  await app.register(linkRoutes);
  await app.register(consoleRoutes, { prefix: API_PREFIX });
  await app.register(stacksRoutes, { prefix: API_PREFIX });
  await app.register(analyticsRoutes, { prefix: API_PREFIX });

  app.readiness.register('signing', () =>
    Promise.resolve({ keyId: app.signer.keyId, algorithm: 'Ed25519' }),
  );
  app.readiness.register('link', () =>
    Promise.resolve({ connectedStacks: app.link.connectedStacks().length }),
  );

  return app;
}
