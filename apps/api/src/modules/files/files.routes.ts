/**
 * Streams private objects through the API with a permission check per key prefix (docs/12 §3).
 * Recordings are served by /calls/:id/recording (per-call authorization), never here.
 */
import { roleHasPermission } from '@crm/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { ForbiddenError, NotFoundError } from '../../lib/errors.js';
import { requireUser } from '../../lib/request.js';

const INLINE_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'application/pdf',
  'audio/mpeg',
  'audio/ogg',
  'audio/wav',
  'audio/x-wav',
  'video/mp4',
]);

const filesRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/files/*', {
    config: { auth: { authenticated: true }, rateLimit: { max: 600, timeWindow: '1 minute' } },
    schema: { tags: ['files'], params: z.object({ '*': z.string().min(1).max(300) }), hide: true },
    handler: async (request, reply) => {
      const user = requireUser(request);
      const key = decodeURIComponent(request.params['*']);
      if (key.includes('..') || key.startsWith('/')) throw new NotFoundError('File');

      const prefix = key.split('/')[0];
      if (prefix === 'avatars') {
        // any authenticated user may see avatars
      } else if (prefix === 'attachments') {
        if (
          !roleHasPermission(user.role ?? 'agent', 'chat:read') &&
          !roleHasPermission(user.role ?? 'agent', 'note:read')
        )
          throw new ForbiddenError();
      } else if (prefix === 'exports') {
        const owned = await app.db.importJob.findFirst({
          where: { fileKey: key, createdById: user.id },
          select: { id: true },
        });
        if (!owned && !roleHasPermission(user.role ?? 'agent', 'report:export'))
          throw new ForbiddenError();
      } else {
        throw new NotFoundError('File');
      }

      const range = typeof request.headers.range === 'string' ? request.headers.range : undefined;
      const obj = await app.storage.get(key, range);
      if (!obj) throw new NotFoundError('File');

      void reply.header('content-type', obj.contentType);
      void reply.header('x-content-type-options', 'nosniff');
      void reply.header('cache-control', 'private, max-age=300');
      void reply.header('accept-ranges', 'bytes');
      void reply.header(
        'content-disposition',
        INLINE_TYPES.has(obj.contentType) ? 'inline' : 'attachment',
      );
      if (obj.contentLength !== undefined) void reply.header('content-length', obj.contentLength);
      if (obj.contentRange) {
        void reply.header('content-range', obj.contentRange);
        void reply.status(206);
      }
      return reply.send(obj.body);
    },
  });
};

export default filesRoutes;
