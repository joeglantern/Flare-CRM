import { describe, expect, it } from 'vitest';
import type { Redis } from 'ioredis';
import { createValkeySecondaryStorage } from './valkey-storage.js';

function fakeRedis() {
  const store = new Map<string, string>();
  const ttls = new Map<string, number>();
  const client = {
    get: (k: string) => Promise.resolve(store.get(k) ?? null),
    getdel: (k: string) => {
      const v = store.get(k) ?? null;
      store.delete(k);
      return Promise.resolve(v);
    },
    set: (k: string, v: string, mode?: string, ttl?: number) => {
      store.set(k, v);
      if (mode === 'EX' && ttl !== undefined) ttls.set(k, ttl);
      return Promise.resolve('OK');
    },
    del: (k: string) => {
      store.delete(k);
      return Promise.resolve(1);
    },
    eval: (_script: string, _n: number, k: string, ttl: number) => {
      const next = Number(store.get(k) ?? '0') + 1;
      store.set(k, String(next));
      if (next === 1) ttls.set(k, ttl);
      return Promise.resolve(next);
    },
  } as unknown as Redis;
  return { store, ttls, client };
}

describe('createValkeySecondaryStorage', () => {
  it('prefixes keys and applies TTLs in seconds', async () => {
    const { client, store, ttls } = fakeRedis();
    const storage = createValkeySecondaryStorage(client, 'auth:');
    await storage.set('session-1', '{"a":1}', 120.4);
    expect(store.get('auth:session-1')).toBe('{"a":1}');
    expect(ttls.get('auth:session-1')).toBe(121);
    expect(await storage.get('session-1')).toBe('{"a":1}');
    expect(await storage.getAndDelete('session-1')).toBe('{"a":1}');
    expect(await storage.get('session-1')).toBeNull();
  });

  it('increments atomically and sets the window TTL only on creation', async () => {
    const { client, ttls } = fakeRedis();
    const storage = createValkeySecondaryStorage(client);
    expect(await storage.increment('rl:x', 60)).toBe(1);
    expect(await storage.increment('rl:x', 60)).toBe(2);
    expect(ttls.get('auth:rl:x')).toBe(60);
  });
});
