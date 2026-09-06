/**
 * Extension → user lookup, cached in Valkey (docs/06 §8). Refreshed from the DB periodically
 * and whenever a user's extension/active flag changes (published on `cti:ext-map:changed`).
 */
import type { Redis } from 'ioredis';
import type { Db } from '../../plugins/prisma.js';

export interface MappedUser {
  userId: string;
  name: string;
  teamId: string | null;
}

const KEY = 'cti:ext2user';
const CHANNEL = 'cti:ext-map:changed';

export class ExtensionMap {
  private timer: NodeJS.Timeout | null = null;
  private subscriber: Redis | null = null;

  constructor(
    private readonly db: Db,
    private readonly valkey: Redis,
    private readonly log: { error: (o: unknown, m: string) => void },
  ) {}

  async start(refreshMs = 60_000): Promise<void> {
    await this.refresh();
    this.timer = setInterval(() => {
      this.refresh().catch((err: unknown) => {
        this.log.error({ err }, 'extension map refresh failed');
      });
    }, refreshMs);
    this.timer.unref();
    this.subscriber = this.valkey.duplicate();
    await this.subscriber.subscribe(CHANNEL);
    this.subscriber.on('message', () => {
      this.refresh().catch((err: unknown) => {
        this.log.error({ err }, 'extension map refresh failed');
      });
    });
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    if (this.subscriber) await this.subscriber.quit().catch(() => undefined);
  }

  async refresh(): Promise<void> {
    const users = await this.db.user.findMany({
      where: { isActive: true, extension: { not: null } },
      select: { id: true, name: true, teamId: true, extension: true },
    });
    const entries: Record<string, string> = {};
    for (const u of users)
      if (u.extension)
        entries[u.extension] = JSON.stringify({
          userId: u.id,
          name: u.name,
          teamId: u.teamId,
        } satisfies MappedUser);
    const multi = this.valkey.multi().del(KEY);
    if (Object.keys(entries).length > 0) multi.hset(KEY, entries);
    await multi.exec();
  }

  async lookup(extension: string): Promise<MappedUser | null> {
    const raw = await this.valkey.hget(KEY, extension);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as MappedUser;
    } catch {
      return null;
    }
  }

  static async notifyChanged(valkey: Redis): Promise<void> {
    await valkey.publish(CHANNEL, 'changed');
  }
}
