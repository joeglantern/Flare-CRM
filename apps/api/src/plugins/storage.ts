import multipart from '@fastify/multipart';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { MemoryStorage, S3Storage, type Storage } from '../integrations/storage/storage.js';

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // docs/08 A4

export default fp(
  async function storagePlugin(app: FastifyInstance) {
    const { config } = app;
    const storage: Storage =
      config.NODE_ENV === 'test'
        ? new MemoryStorage()
        : new S3Storage({
            endpoint: config.S3_ENDPOINT,
            region: config.S3_REGION,
            bucket: config.S3_BUCKET,
            accessKey: config.S3_ACCESS_KEY,
            secretKey: config.S3_SECRET_KEY,
            forcePathStyle: config.S3_FORCE_PATH_STYLE,
            publicUrl: config.STORAGE_PUBLIC_URL,
          });

    try {
      await storage.ensureReady();
    } catch (err) {
      // storage being down must not prevent boot (calls are still logged; recordings retry) — docs/03 §4
      app.log.error({ err }, 'object storage not ready at boot');
    }
    app.decorate('storage', storage);
    app.readiness.register('storage', async () => {
      await storage.ensureReady();
      return undefined;
    });

    await app.register(multipart, {
      limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 20, parts: 30 },
      throwFileSizeLimit: true,
    });
  },
  { name: 'storage', dependencies: ['config', 'health'] },
);
