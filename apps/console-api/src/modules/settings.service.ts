/**
 * The console's own settings, read and written as the shapes they actually are.
 *
 * `ConsoleSetting` is a key and a blob, which is the right storage and the wrong thing to hand to
 * the rest of the code. Everything goes through here instead: a value that has never been written
 * comes back as the default, and a value written into something unreadable comes back as the
 * default too rather than taking a sweep down with it.
 *
 * Cached for a few seconds because the alert sweep asks for the thresholds once per customer and
 * the answer cannot meaningfully change in the middle of one run.
 */
import {
  CONSOLE_SETTING_KEYS,
  DEFAULT_ALERT_THRESHOLDS,
  DEFAULT_RETENTION,
  alertRecipients,
  alertThresholds,
  ownerContact as ownerContactSchema,
  retentionSettings,
  type AlertRecipients,
  type AlertThresholds,
  type OwnerContact,
  type RetentionSettings,
} from '@crm/shared';
import { FALLBACK_OWNER_CONTACT } from '../lib/owner-contact.js';
import type { Db } from '../plugins/prisma.js';

const CACHE_MS = 5_000;

const EMPTY_RECIPIENTS: AlertRecipients = { default: [], byKind: {} };

export class ConsoleSettingsService {
  private readonly cache = new Map<string, { value: unknown; expiresAt: number }>();

  constructor(private readonly db: Db) {}

  async alertThresholds(): Promise<AlertThresholds> {
    return this.read(
      CONSOLE_SETTING_KEYS.alertThresholds,
      alertThresholds,
      DEFAULT_ALERT_THRESHOLDS,
    );
  }

  async alertRecipients(): Promise<AlertRecipients> {
    return this.read(CONSOLE_SETTING_KEYS.alertRecipients, alertRecipients, EMPTY_RECIPIENTS);
  }

  async retention(): Promise<RetentionSettings> {
    return this.read(CONSOLE_SETTING_KEYS.retention, retentionSettings, DEFAULT_RETENTION);
  }

  async ownerContact(): Promise<OwnerContact> {
    return this.read(CONSOLE_SETTING_KEYS.ownerContact, ownerContactSchema, FALLBACK_OWNER_CONTACT);
  }

  /** Writes one setting and drops its cache, so the next read is the new value. */
  async write(key: string, value: unknown): Promise<void> {
    await this.db.consoleSetting.upsert({
      where: { key },
      create: { key, value: value as object },
      update: { value: value as object },
    });
    this.cache.delete(key);
  }

  /** For tests and for a settings screen that has just written several at once. */
  forget(): void {
    this.cache.clear();
  }

  private async read<T>(
    key: string,
    schema: { safeParse: (v: unknown) => { success: true; data: T } | { success: false } },
    fallback: T,
  ): Promise<T> {
    const cached = this.cache.get(key);
    if (cached !== undefined && cached.expiresAt > Date.now()) return cached.value as T;
    const row = await this.db.consoleSetting.findUnique({ where: { key } });
    const parsed = schema.safeParse(row?.value);
    const value = parsed.success ? parsed.data : fallback;
    this.cache.set(key, { value, expiresAt: Date.now() + CACHE_MS });
    return value;
  }
}
