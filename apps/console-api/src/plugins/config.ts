/*
 * Copied from apps/api. The two services are deliberately separate processes with
 * separate databases; this plumbing is identical in both. Candidate for a shared server
 * package once something needs it a third time.
 */
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import type { Env } from '../config/env.js';

export default fp(
  function configPlugin(app: FastifyInstance, opts: { env: Env }) {
    app.decorate('config', opts.env);
  },
  { name: 'config' },
);
