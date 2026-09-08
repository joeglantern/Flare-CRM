/**
 * Sends each object class to its own backend by key prefix, so the bulky classes can live off the
 * server while the small, hot ones stay local. Anything without a matching prefix goes to the
 * fallback.
 */
import type { ObjectStream, PutResult, Storage } from './storage.js';

export class RoutedStorage implements Storage {
  constructor(
    private readonly fallback: Storage,
    private readonly routes: { prefix: string; storage: Storage }[],
  ) {}

  private pick(key: string): Storage {
    const prefix = key.split('/')[0] ?? '';
    return this.routes.find((r) => r.prefix === prefix)?.storage ?? this.fallback;
  }

  async ensureReady(): Promise<void> {
    const seen = new Set<Storage>([this.fallback, ...this.routes.map((r) => r.storage)]);
    await Promise.all([...seen].map((s) => s.ensureReady()));
  }
  put(key: string, body: Buffer, contentType: string): Promise<PutResult> {
    return this.pick(key).put(key, body, contentType);
  }
  get(key: string, range?: string): Promise<ObjectStream | null> {
    return this.pick(key).get(key, range);
  }
  head(key: string): Promise<{ size: number; contentType: string } | null> {
    return this.pick(key).head(key);
  }
  delete(key: string): Promise<void> {
    return this.pick(key).delete(key);
  }
  presignGet(key: string, ttlSeconds: number, downloadName?: string): Promise<string | null> {
    return this.pick(key).presignGet(key, ttlSeconds, downloadName);
  }
}
