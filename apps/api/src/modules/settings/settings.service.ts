/**
 * Settings service with a short in-process cache (docs/03 §6). Reads are hot (every scoped
 * query needs `agentVisibility`), so values are cached for 10 s and invalidated on write via
 * a Valkey pub/sub notice so all processes refresh.
 */
import type { Redis } from 'ioredis';
import type { Db } from '../../plugins/prisma.js';
import {
  settingDefaults,
  settingKeys,
  settingSchemas,
  type SettingKey,
  type SettingValue,
  type Settings,
} from './settings.schema.js';

const CACHE_TTL_MS = 10_000;
const CHANNEL = 'settings:changed';

export class SettingsService {
  private cache: { value: Settings; expiresAt: number } | null = null;
  private subscriber: Redis | null = null;

  constructor(
    private readonly db: Db,
    private readonly valkey: Redis,
  ) {}

  async start(): Promise<void> {
    this.subscriber = this.valkey.duplicate();
    await this.subscriber.subscribe(CHANNEL);
    this.subscriber.on('message', (channel) => {
      if (channel === CHANNEL) this.cache = null;
    });
  }

  async stop(): Promise<void> {
    if (this.subscriber) {
      await this.subscriber.quit().catch(() => undefined);
      this.subscriber = null;
    }
  }

  async getAll(): Promise<Settings> {
    if (this.cache && this.cache.expiresAt > Date.now()) return this.cache.value;
    const rows = await this.db.setting.findMany();
    const merged: Record<string, unknown> = { ...settingDefaults };
    for (const row of rows) {
      if (!settingKeys.includes(row.key as SettingKey)) continue;
      const parsed = settingSchemas[row.key as SettingKey].safeParse(row.value);
      if (parsed.success) merged[row.key] = parsed.data;
    }
    const value = merged as Settings;
    this.cache = { value, expiresAt: Date.now() + CACHE_TTL_MS };
    return value;
  }

  async get<K extends SettingKey>(key: K): Promise<SettingValue<K>> {
    const all = await this.getAll();
    return all[key];
  }

  async set<K extends SettingKey>(
    key: K,
    value: SettingValue<K>,
    updatedById: string | null,
  ): Promise<void> {
    const parsed = settingSchemas[key].parse(value);
    await this.db.setting.upsert({
      where: { key },
      create: { key, value: parsed as object, updatedById },
      update: { value: parsed as object, updatedById },
    });
    this.cache = null;
    await this.valkey.publish(CHANNEL, key);
  }

  async patch(
    patch: { [K in SettingKey]?: SettingValue<K> | undefined },
    updatedById: string | null,
  ): Promise<Settings> {
    for (const key of settingKeys) {
      const value = patch[key];
      if (value !== undefined) await this.set(key, value, updatedById);
    }
    return this.getAll();
  }
}
