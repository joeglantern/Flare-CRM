/**
 * Storage accounting for the storage limit (docs/20 §6).
 *
 * A running total in Valkey, adjusted as objects are written and removed, so the check on an
 * upload is one hash read rather than three aggregate queries. The nightly retention job calls
 * `recompute()` so any drift (a crashed process between the object write and the counter update)
 * is corrected within a day. A missing counter also recomputes, which is what happens on first
 * boot and after Valkey is flushed.
 */
import type { Redis } from 'ioredis';
import type { Storage } from '../../integrations/storage/storage.js';
import type { Db } from '../../plugins/prisma.js';

const KEY = 'entitlements:usage:storage';

export type StorageKind = 'attachments' | 'recordings' | 'backups';

export interface StorageUsageSnapshot {
  attachments: number;
  recordings: number;
  backups: number;
  total: number;
  refreshedAt: string | null;
}

export class StorageUsage {
  constructor(
    private readonly valkey: Redis,
    private readonly db: Db,
    private readonly storage: Storage,
  ) {}

  /** Positive when an object is stored, negative when one is deleted. */
  async add(kind: StorageKind, bytes: number): Promise<void> {
    const delta = Math.round(bytes);
    if (delta === 0) return;
    if (!(await this.valkey.exists(KEY))) {
      // Nothing to adjust yet: the recompute that follows already includes this object.
      await this.recompute();
      return;
    }
    await this.valkey.hincrby(KEY, kind, delta);
  }

  async read(): Promise<StorageUsageSnapshot> {
    const hash = await this.valkey.hgetall(KEY);
    if (!hash.refreshedAt) return this.recompute();
    return snapshot(hash);
  }

  /**
   * Authoritative sums from the database and the object store.
   *
   * An unreachable object store does not fail this: the two database figures are still right, and
   * the backup total keeps whatever was last measured. A stack whose disk is unwell must still be
   * able to say how it is doing, which is exactly when the owner wants to hear from it.
   */
  async recompute(): Promise<StorageUsageSnapshot> {
    const [attachments, recordings, backups] = await Promise.all([
      this.db.attachment.aggregate({ _sum: { sizeBytes: true } }),
      this.db.call.aggregate({
        _sum: { recordingSizeBytes: true },
        where: { recordingStatus: 'stored' },
      }),
      this.storage.list('backups/', 1000).catch(() => null),
    ]);
    const lastKnownBackups =
      backups === null ? Number((await this.valkey.hget(KEY, 'backups')) ?? 0) : 0;
    const values = {
      attachments: Number(attachments._sum.sizeBytes ?? 0n),
      recordings: Number(recordings._sum.recordingSizeBytes ?? 0n),
      backups: backups === null ? lastKnownBackups : backups.reduce((sum, o) => sum + o.size, 0),
      refreshedAt: new Date().toISOString(),
    };
    await this.valkey.hset(KEY, values);
    return snapshot(values);
  }
}

function snapshot(hash: Record<string, string | number>): StorageUsageSnapshot {
  const num = (v: string | number | undefined) => Math.max(0, Number(v ?? 0) || 0);
  const attachments = num(hash.attachments);
  const recordings = num(hash.recordings);
  const backups = num(hash.backups);
  return {
    attachments,
    recordings,
    backups,
    total: attachments + recordings + backups,
    refreshedAt: typeof hash.refreshedAt === 'string' ? hash.refreshedAt : null,
  };
}
