/**
 * OpenAPI document generated from the Zod route schemas (docs/09 §6).
 * Enabled by OPENAPI_ENABLED; the UI is served only to admins in production.
 */
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { jsonSchemaTransform } from 'fastify-type-provider-zod';
import { hasRole } from './authorize.js';

export default fp(
  async function openapi(app: FastifyInstance) {
    await app.register(swagger, {
      openapi: {
        openapi: '3.1.0',
        info: {
          title: 'CRM API',
          version: '1.0.0',
          description: 'CRM with Yeastar P-Series CTI integration',
        },
        servers: [{ url: app.config.APP_URL }],
        components: {
          securitySchemes: {
            cookieAuth: { type: 'apiKey', in: 'cookie', name: 'crm.session_token' },
          },
        },
        security: [{ cookieAuth: [] }],
      },
      transform: jsonSchemaTransform,
    });

    await app.register(swaggerUi, {
      routePrefix: '/api/docs',
      uiConfig: { docExpansion: 'list', deepLinking: false },
      staticCSP: true,
      uiHooks: {
        onRequest: (request, reply, done) => {
          const notFound = () => {
            void reply.status(404).send({
              error: { code: 'NOT_FOUND', message: 'Resource not found', requestId: request.id },
            });
          };
          app.entitlements
            .has('api_docs')
            .then(async (inPlan) => {
              if (!inPlan) {
                notFound();
                return;
              }
              if (app.config.NODE_ENV !== 'production') {
                done();
                return;
              }
              const session = await app.getSession(request.headers);
              if (session && hasRole(session.user.role, 'admin')) done();
              else notFound();
            })
            .catch(done);
        },
      },
    });
  },
  { name: 'openapi', dependencies: ['config', 'auth'] },
);
