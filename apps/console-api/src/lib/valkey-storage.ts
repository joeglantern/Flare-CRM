/*
 * Copied from apps/api. The two services are deliberately separate processes with
 * separate databases; this plumbing is identical in both. Candidate for a shared server
 * package once something needs it a third time.
 */
import type { Redis } from 'ioredis';

/**
 * Better Auth `SecondaryStorage` backed by Valkey (docs/07 §1).
 * `increment` creates the key with the TTL only on first increment so rate-limit windows are fixed.
 */
const INCREMENT_LUA = `
local v = redis.call('INCR', KEYS[1])
if v == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return v`;

export function createValkeySecondaryStorage(valkey: Redis, prefix = 'auth:') {
  return {
    async get(key: string): Promise<string | null> {
      return valkey.get(prefix + key);
    },
    async getAndDelete(key: string): Promise<string | null> {
      return valkey.getdel(prefix + key);
    },
    async increment(key: string, ttl: number): Promise<number> {
      const result = await valkey.eval(INCREMENT_LUA, 1, prefix + key, Math.max(1, Math.ceil(ttl)));
      return Number(result);
    },
    async set(key: string, value: string, ttl?: number): Promise<void> {
      if (ttl !== undefined && ttl > 0) await valkey.set(prefix + key, value, 'EX', Math.ceil(ttl));
      else await valkey.set(prefix + key, value);
    },
    async delete(key: string): Promise<void> {
      await valkey.del(prefix + key);
    },
  };
}
