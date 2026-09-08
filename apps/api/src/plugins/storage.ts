import multipart from '@fastify/multipart';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { MemoryStorage, S3Storage, type Storage } from '../integrations/storage/storage.js';
import {
  createGoogleDriveClient,
  GoogleDriveStorage,
} from '../integrations/storage/google-drive.js';
import { prismaObjectStore } from '../integrations/storage/object-store.js';
import { RoutedStorage } from '../integrations/storage/routed.js';

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // docs/08 A4

export default fp(
  async function storagePlugin(app: FastifyInstance) {
    const { config } = app;
    const local: Storage =
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

    // The bulky object classes go to Drive; everything else stays on the local store, so avatars
    // and import scratch files never leave the server and the Drive quota holds only what matters.
    let storage: Storage = local;
    if (config.STORAGE_BACKEND === 'gdrive' && config.NODE_ENV !== 'test') {
      const drive = new GoogleDriveStorage({
        folderId: config.GDRIVE_FOLDER_ID ?? '',
        client: createGoogleDriveClient({
          keyFile: config.GDRIVE_SERVICE_ACCOUNT_FILE ?? '',
          impersonate: config.GDRIVE_IMPERSONATE,
        }),
        objects: prismaObjectStore(app.db),
      });
      const prefixes = config.GDRIVE_PREFIXES.split(',')
        .map((p) => p.trim())
        .filter((p) => p !== '');
      storage = new RoutedStorage(
        local,
        prefixes.map((prefix) => ({ prefix, storage: drive })),
      );
      app.log.info({ prefixes }, 'google drive storage enabled');
    }

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
  { name: 'storage', dependencies: ['config', 'health', 'prisma'] },
);
