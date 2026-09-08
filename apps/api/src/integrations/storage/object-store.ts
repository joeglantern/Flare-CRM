/**
 * The key to provider id map behind backends that cannot address an object by our key. Kept as
 * a tiny interface so the Drive backend is testable without a database.
 */
import type { Db } from '../../plugins/prisma.js';

export interface StoredObjectRow {
  key: string;
  provider: string;
  providerId: string;
  size: number;
  contentType: string;
  sha256: string | null;
}

export interface ObjectStore {
  get(key: string): Promise<StoredObjectRow | null>;
  put(row: StoredObjectRow): Promise<void>;
  delete(key: string): Promise<void>;
}

export function prismaObjectStore(db: Db): ObjectStore {
  return {
    async get(key) {
      const r = await db.storageObject.findUnique({ where: { key } });
      return r
        ? {
            key: r.key,
            provider: r.provider,
            providerId: r.providerId,
            size: Number(r.sizeBytes),
            contentType: r.contentType,
            sha256: r.sha256,
          }
        : null;
    },
    async put(row) {
      const data = {
        provider: row.provider,
        providerId: row.providerId,
        sizeBytes: BigInt(row.size),
        contentType: row.contentType,
        sha256: row.sha256,
      };
      await db.storageObject.upsert({
        where: { key: row.key },
        create: { key: row.key, ...data },
        update: data,
      });
    },
    async delete(key) {
      await db.storageObject.deleteMany({ where: { key } });
    },
  };
}

export function memoryObjectStore(): ObjectStore {
  const rows = new Map<string, StoredObjectRow>();
  return {
    get: (key) => Promise.resolve(rows.get(key) ?? null),
    put: (row) => {
      rows.set(row.key, row);
      return Promise.resolve();
    },
    delete: (key) => {
      rows.delete(key);
      return Promise.resolve();
    },
  };
}
