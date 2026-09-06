import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import type { Env } from '../config/env.js';

export default fp(
  function configPlugin(app: FastifyInstance, opts: { env: Env }) {
    app.decorate('config', opts.env);
  },
  { name: 'config' },
);
