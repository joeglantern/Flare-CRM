/**
 * Database snapshots for administrators (docs/13).
 *
 * The application never takes a snapshot itself: `pg_dump` is a command, and running commands from
 * api or worker code is forbidden (docs/08 §N). The backup sidecar produces them on its schedule
 * and puts them in the object store; this module lists, serves, accepts and removes them. The
 * object store is the catalogue, so there is no second record to drift out of step with it.
 *
 * Restoring is deliberately absent. Replacing the database under a running application breaks
 * whatever is in flight, and the interface that just destroyed the data is the worst place to
 * discover that. Uploading is supported, because carrying a snapshot to another server is the step
 * before an operator restores it with the stack stopped.
 */
import { backupDto, dataResponse, offsetListResponse } from '@crm/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { MAX_BACKUP_BYTES } from '../../lib/backups.js';
import { NotFoundError, ValidationError } from '../../lib/errors.js';
import { auditContext } from '../../lib/request.js';
import { sha256Of } from '../../integrations/storage/storage.js';

const PREFIX = 'backups/';

/** Keys come back to us from the client, so they are checked rather than trusted. */
const keyQuery = z.object({
  key: z
    .string()
    .min(PREFIX.length + 1)
    .max(300)
    .refine((k) => k.startsWith(PREFIX) && !k.includes('..') && !k.includes('//'), {
      message: 'Not a backup key',
    }),
});

function nameOf(key: string): string {
  return key.slice(key.lastIndexOf('/') + 1);
}

const backupsRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/backups', {
    config: { auth: { permission: 'settings:manage' } },
    schema: { tags: ['backups'], response: { 200: offsetListResponse(backupDto) } },
    handler: async () => {
      const objects = await app.storage.list(PREFIX, 100);
      const data = objects.map((o) => ({
        key: o.key,
        fileName: nameOf(o.key),
        sizeBytes: o.size,
        createdAt: o.lastModified,
        origin: nameOf(o.key).startsWith('upload-')
          ? ('uploaded' as const)
          : ('generated' as const),
      }));
      return { data, page: { page: 1, pageSize: data.length, total: data.length } };
    },
  });

  app.post('/backups/upload', {
    config: {
      auth: { permission: 'settings:manage' },
      rateLimit: { max: 6, timeWindow: '1 hour' },
    },
    schema: { tags: ['backups'], response: { 201: dataResponse(backupDto) } },
    handler: async (request, reply) => {
      const file = await request.file();
      if (!file) throw new ValidationError([{ path: 'file', message: 'A file is required' }]);
      const buffer = await file.toBuffer();
      if (buffer.length === 0)
        throw new ValidationError([{ path: 'file', message: 'The file is empty' }]);
      if (buffer.length > MAX_BACKUP_BYTES)
        throw new ValidationError([{ path: 'file', message: 'The file is too large' }]);
      // A pg_dump custom-format archive starts with "PGDMP". Rejecting anything else here means an
      // operator finds out now rather than during the restore they were relying on.
      if (buffer.subarray(0, 5).toString('latin1') !== 'PGDMP')
        throw new ValidationError([
          { path: 'file', message: 'Not a pg_dump archive (expected custom format)' },
        ]);

      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const key = `${PREFIX}upload-${stamp}.dump`;
      const stored = await app.storage.put(key, buffer, 'application/octet-stream');
      await app.audit.write(auditContext(request), {
        action: 'backup.uploaded',
        entity: 'backup',
        // No UUID identity here: the object store's key is the identity, and that column only
        // accepts a UUID, so it goes in the metadata instead of entityId.
        after: { key, fileName: nameOf(key), sizeBytes: stored.size, sha256: sha256Of(buffer) },
      });
      return reply.status(201).send({
        data: {
          key,
          fileName: nameOf(key),
          sizeBytes: stored.size,
          createdAt: new Date().toISOString(),
          origin: 'uploaded' as const,
        },
      });
    },
  });

  app.get('/backups/download', {
    config: { auth: { permission: 'settings:manage' } },
    schema: { tags: ['backups'], querystring: keyQuery, hide: true },
    handler: async (request, reply) => {
      const { key } = request.query;
      const obj = await app.storage.get(key);
      if (!obj) throw new NotFoundError('Backup');
      await app.audit.write(auditContext(request), {
        action: 'backup.downloaded',
        entity: 'backup',
        after: { key },
      });
      void reply.header('content-type', 'application/octet-stream');
      void reply.header('x-content-type-options', 'nosniff');
      void reply.header('cache-control', 'private, no-store');
      void reply.header('content-disposition', `attachment; filename="${nameOf(key)}"`);
      if (obj.contentLength !== undefined) void reply.header('content-length', obj.contentLength);
      return reply.send(obj.body);
    },
  });

  app.delete('/backups', {
    config: { auth: { permission: 'settings:manage' } },
    schema: { tags: ['backups'], querystring: keyQuery, response: { 204: z.null() } },
    handler: async (request, reply) => {
      const { key } = request.query;
      if (!(await app.storage.head(key))) throw new NotFoundError('Backup');
      await app.storage.delete(key);
      await app.audit.write(auditContext(request), {
        action: 'backup.deleted',
        entity: 'backup',
        before: { key, fileName: nameOf(key) },
      });
      return reply.status(204).send(null);
    },
  });
};

export default backupsRoutes;
