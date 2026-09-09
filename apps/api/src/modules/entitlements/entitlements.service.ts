/**
 * Entitlements inside a customer stack (docs/20).
 *
 * Holds the one document this stack operates under and answers "is this feature on", "what is
 * this limit", "has the plan expired" for the authorization hook, the services that enforce
 * limits, and the web app. Precedence when loading: a document received from the console, then
 * a signed file on disk, then the built-in defaults (everything on, no limits). Nothing inside
 * the stack can change the document except applying another correctly signed one.
 *
 * Cached for ten seconds in-process like settings, invalidated across processes over Valkey.
 */
import { readFile } from 'node:fs/promises';
import {
  DEFAULT_ENTITLEMENTS,
  FEATURES,
  LIMITS,
  daysUntilExpiry,
  entitlementsDocument,
  isExpired,
  normaliseFeatures,
  signedEnvelope,
  type EntitlementSource,
  type EntitlementsDocument,
  type EntitlementsDto,
  type FeatureKey,
  type LimitKey,
  type SignedEnvelope,
} from '@crm/shared';
import type { Redis } from 'ioredis';
import type { Env } from '../../config/env.js';
import { LimitReachedError } from '../../lib/errors.js';
import { newId } from '../../lib/ids.js';
import type { Db } from '../../plugins/prisma.js';
import type { EventBus } from '../../plugins/event-bus.js';
import type { AuditContext, AuditService } from '../audit/audit.service.js';
import type { SettingsService } from '../settings/settings.service.js';
import { parsePublicKey, verifyEnvelope, type TrustedKey } from './signature.js';
import type { StorageUsage } from './usage.js';

const CACHE_TTL_MS = 10_000;
const CHANNEL = 'entitlements:changed';
const CURRENT_ID = 'current';
const STATUS_KEY = 'console:status';
export const SYSTEM_AUDIT: AuditContext = { actorId: null, actorType: 'system' };

export interface EntitlementsState {
  doc: EntitlementsDocument;
  source: EntitlementSource;
  receivedAt: string | null;
  issueId: string | null;
  keyId: string | null;
}

export type ApplyResult =
  { result: 'applied'; state: EntitlementsState } | { result: 'rejected'; reason: string };

export interface LinkStatus {
  configured: boolean;
  connected: boolean;
  lastHeartbeatAt: string | null;
}

interface Logger {
  info: (o: unknown, m: string) => void;
  warn: (o: unknown, m: string) => void;
  error: (o: unknown, m: string) => void;
}

const DEFAULT_STATE: EntitlementsState = {
  doc: DEFAULT_ENTITLEMENTS,
  source: 'default',
  receivedAt: null,
  issueId: null,
  keyId: null,
};

export class EntitlementsService {
  private cache: { value: EntitlementsState; expiresAt: number } | null = null;
  private subscriber: Redis | null = null;
  private readonly keys: TrustedKey[];

  constructor(
    private readonly deps: {
      db: Db;
      valkey: Redis;
      config: Env;
      audit: AuditService;
      events: EventBus;
      settings: SettingsService;
      usage: StorageUsage;
      log: Logger;
    },
  ) {
    this.keys = deps.config.CONSOLE_PUBLIC_KEY.map(parsePublicKey);
  }

  async start(): Promise<void> {
    this.subscriber = this.deps.valkey.duplicate();
    await this.subscriber.subscribe(CHANNEL);
    this.subscriber.on('message', (channel) => {
      if (channel === CHANNEL) this.cache = null;
    });
    if (this.deps.config.ENTITLEMENTS_FILE !== undefined) {
      const outcome = await this.reloadFromFile(SYSTEM_AUDIT);
      if (outcome.result === 'rejected') {
        this.deps.log.error({ reason: outcome.reason }, 'entitlements file was not applied');
      }
    }
    const state = await this.getState();
    this.deps.log.info(
      { source: state.source, plan: state.doc.plan.name, issueId: state.issueId },
      'entitlements loaded',
    );
  }

  async stop(): Promise<void> {
    if (this.subscriber) {
      await this.subscriber.quit().catch(() => undefined);
      this.subscriber = null;
    }
  }

  /**
   * Drops the in-process cache. Applying a document does this everywhere over Valkey; this is for
   * the one case that bypasses `apply`, a test truncating the table underneath the service.
   */
  invalidate(): void {
    this.cache = null;
  }

  /** The document in force, with where it came from. */
  async getState(): Promise<EntitlementsState> {
    if (this.cache && this.cache.expiresAt > Date.now()) return this.cache.value;
    const value = await this.load();
    this.cache = { value, expiresAt: Date.now() + CACHE_TTL_MS };
    return value;
  }

  private async load(): Promise<EntitlementsState> {
    const row = await this.deps.db.entitlement.findUnique({ where: { id: CURRENT_ID } });
    if (!row) return DEFAULT_STATE;
    const parsed = entitlementsDocument.safeParse(row.payload);
    if (!parsed.success) {
      // A row this process cannot read is a bug, not a reason to unlock everything or to lock
      // the customer out; log loudly and behave as if unmanaged.
      this.deps.log.error({ issueId: row.issueId }, 'stored entitlements are unreadable');
      return DEFAULT_STATE;
    }
    return {
      doc: { ...parsed.data, features: normaliseFeatures(parsed.data.features) },
      source: row.source === 'console' ? 'console' : 'file',
      receivedAt: row.receivedAt.toISOString(),
      issueId: row.issueId,
      keyId: row.keyId,
    };
  }

  async has(feature: FeatureKey): Promise<boolean> {
    return (await this.getState()).doc.features[feature];
  }

  async limit(key: LimitKey): Promise<number | null> {
    return (await this.getState()).doc.limits[key];
  }

  async isExpired(): Promise<boolean> {
    return isExpired((await this.getState()).doc);
  }

  /** The retention the stack actually applies: the customer's setting capped by the plan. */
  async effectiveRecordingRetentionDays(configured: number): Promise<number> {
    const max = await this.limit('recording_retention_days');
    return max === null ? configured : Math.min(configured, max);
  }

  /**
   * Refuses the next unit when the plan's ceiling is already reached. `used` is what exists now;
   * the caller is about to add one more.
   */
  async assertLimit(key: LimitKey, used: number, ctx: AuditContext): Promise<void> {
    const max = await this.limit(key);
    if (max === null || used < max) return;
    await this.deps.audit.write(ctx, {
      action: 'entitlements.limit_reached',
      entity: 'entitlements',
      after: { limit: key, used, max },
    });
    throw new LimitReachedError(key, LIMITS[key].label, used, max);
  }

  /** Storage is counted in bytes against a limit expressed in whole gigabytes. */
  async assertStorage(bytesToAdd: number, ctx: AuditContext): Promise<void> {
    const maxGb = await this.limit('storage_gb');
    if (maxGb === null) return;
    const maxBytes = maxGb * 1024 ** 3;
    const used = await this.deps.usage.read();
    if (used.total + bytesToAdd <= maxBytes) return;
    await this.deps.audit.write(ctx, {
      action: 'entitlements.limit_reached',
      entity: 'entitlements',
      after: { limit: 'storage_gb', usedBytes: used.total, addBytes: bytesToAdd, maxBytes },
    });
    throw new LimitReachedError(
      'storage_gb',
      LIMITS.storage_gb.label,
      Math.ceil(used.total / 1024 ** 3),
      maxGb,
    );
  }

  /**
   * Verifies and stores a document. Rejections never change what is in force; they are audited
   * so the owner can see a stack refusing what the console sent.
   */
  async apply(
    input: unknown,
    opts: { issueId: string | null; source: 'console' | 'file'; ctx: AuditContext },
  ): Promise<ApplyResult> {
    const envelope = signedEnvelope.safeParse(input);
    if (!envelope.success) return this.reject('envelope is malformed', opts);
    const verified = verifyEnvelope(envelope.data, this.keys);
    if (!verified.ok) return this.reject(verified.reason, opts, envelope.data);
    const doc = verified.document;
    const stackId = this.deps.config.CONSOLE_STACK_ID;
    if (doc.audience !== undefined && doc.audience !== stackId) {
      return this.reject('document is addressed to a different stack', opts, envelope.data);
    }
    const current = await this.load();
    if (
      current.source !== 'default' &&
      Date.parse(doc.issuedAt) < Date.parse(current.doc.issuedAt) &&
      !(current.source === 'file' && opts.source === 'console')
    ) {
      return this.reject('document is older than the one in force', opts, envelope.data);
    }
    const features = normaliseFeatures(doc.features);
    const payload: EntitlementsDocument = { ...doc, features };
    const receivedAt = new Date();
    await this.deps.db.$transaction(async (tx) => {
      await tx.entitlement.upsert({
        where: { id: CURRENT_ID },
        create: {
          id: CURRENT_ID,
          source: opts.source,
          envelope: envelope.data,
          payload: payload as object,
          keyId: envelope.data.keyId,
          issueId: opts.issueId,
          issuedAt: new Date(doc.issuedAt),
          expiresAt: doc.expiresAt === null ? null : new Date(doc.expiresAt),
          receivedAt,
        },
        update: {
          source: opts.source,
          envelope: envelope.data,
          payload: payload as object,
          keyId: envelope.data.keyId,
          issueId: opts.issueId,
          issuedAt: new Date(doc.issuedAt),
          expiresAt: doc.expiresAt === null ? null : new Date(doc.expiresAt),
          receivedAt,
        },
      });
      await tx.entitlementHistory.create({
        data: {
          id: newId(),
          source: opts.source,
          keyId: envelope.data.keyId,
          issueId: opts.issueId,
          issuedAt: new Date(doc.issuedAt),
          payload: payload as object,
          appliedById: opts.ctx.actorId,
          receivedAt,
        },
      });
      await this.deps.audit.writeWith(tx, opts.ctx, {
        action: 'entitlements.applied',
        entity: 'entitlements',
        before: summarise(current.doc),
        after: { ...summarise(payload), issueId: opts.issueId, source: opts.source },
      });
    });
    this.cache = null;
    await this.deps.valkey.publish(CHANNEL, opts.issueId ?? '');
    this.deps.events.emit('entitlements.changed', {
      plan: payload.plan.name,
      features,
      expiresAt: payload.expiresAt,
      issueId: opts.issueId,
    });
    const state = await this.getState();
    this.deps.log.info(
      { issueId: opts.issueId, source: opts.source, plan: payload.plan.name },
      'entitlements applied',
    );
    return { result: 'applied', state };
  }

  private async reject(
    reason: string,
    opts: { issueId: string | null; source: 'console' | 'file'; ctx: AuditContext },
    envelope?: SignedEnvelope,
  ): Promise<ApplyResult> {
    await this.deps.audit.write(opts.ctx, {
      action: 'entitlements.rejected',
      entity: 'entitlements',
      after: { reason, issueId: opts.issueId, source: opts.source, keyId: envelope?.keyId ?? null },
    });
    this.deps.log.warn(
      { reason, issueId: opts.issueId, source: opts.source },
      'entitlements rejected',
    );
    return { result: 'rejected', reason };
  }

  /** Re-reads ENTITLEMENTS_FILE. A console-issued document always outranks the file. */
  async reloadFromFile(ctx: AuditContext): Promise<ApplyResult> {
    const path = this.deps.config.ENTITLEMENTS_FILE;
    if (path === undefined) return { result: 'rejected', reason: 'ENTITLEMENTS_FILE is not set' };
    const current = await this.load();
    if (current.source === 'console') {
      return { result: 'rejected', reason: 'a console-issued document is in force' };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(path, 'utf8'));
    } catch (err) {
      return this.reject(`file could not be read: ${(err as Error).message}`, {
        issueId: null,
        source: 'file',
        ctx,
      });
    }
    return this.apply(parsed, { issueId: null, source: 'file', ctx });
  }

  /** Written by the worker's console link; read here so the api can report it. */
  async linkStatus(): Promise<LinkStatus> {
    const configured = this.deps.config.CONSOLE_URL !== undefined;
    if (!configured) return { configured, connected: false, lastHeartbeatAt: null };
    const raw = await this.deps.valkey.get(STATUS_KEY);
    if (!raw) return { configured, connected: false, lastHeartbeatAt: null };
    try {
      const parsed = JSON.parse(raw) as { connected?: boolean; lastHeartbeatAt?: string | null };
      return {
        configured,
        connected: parsed.connected === true,
        lastHeartbeatAt: parsed.lastHeartbeatAt ?? null,
      };
    } catch {
      return { configured, connected: false, lastHeartbeatAt: null };
    }
  }

  async setLinkStatus(status: {
    connected: boolean;
    lastHeartbeatAt: string | null;
  }): Promise<void> {
    await this.deps.valkey.set(
      STATUS_KEY,
      JSON.stringify({ ...status, updatedAt: new Date().toISOString() }),
      'EX',
      120,
    );
  }

  async usage(): Promise<EntitlementsDto['usage']> {
    const { db } = this.deps;
    const [seats, channels, pipelines, storage, recording, state] = await Promise.all([
      db.user.count({ where: { isActive: true } }),
      db.channel.count({ where: { isActive: true } }),
      db.pipeline.count(),
      this.deps.usage.read(),
      this.deps.settings.get('recording'),
      this.getState(),
    ]);
    const limits = state.doc.limits;
    const maxBytes = limits.storage_gb === null ? null : limits.storage_gb * 1024 ** 3;
    return {
      seats: { used: seats, max: limits.seats },
      storage: {
        usedBytes: storage.total,
        maxBytes,
        breakdown: {
          attachments: storage.attachments,
          recordings: storage.recordings,
          backups: storage.backups,
        },
        refreshedAt: storage.refreshedAt,
      },
      channels: { used: channels, max: limits.channels },
      pipelines: { used: pipelines, max: limits.pipelines },
      recordingRetentionDays: {
        configured: recording.retentionDays,
        max: limits.recording_retention_days,
        effective: await this.effectiveRecordingRetentionDays(recording.retentionDays),
      },
    };
  }

  async toDto(): Promise<EntitlementsDto> {
    const [state, usage, link] = await Promise.all([
      this.getState(),
      this.usage(),
      this.linkStatus(),
    ]);
    const { doc } = state;
    return {
      customerName: doc.customerName,
      plan: doc.plan,
      features: doc.features,
      limits: doc.limits,
      usage,
      expiresAt: doc.expiresAt,
      expired: isExpired(doc),
      expiresInDays: daysUntilExpiry(doc),
      ownerContact: doc.ownerContact,
      source: state.source,
      receivedAt: state.receivedAt,
      issuedAt: state.source === 'default' ? null : doc.issuedAt,
      issueId: state.issueId,
      keyId: state.keyId,
      link,
    };
  }

  /** For readiness: never fails, only describes. */
  async readiness(): Promise<Record<string, unknown>> {
    const state = await this.getState();
    return {
      source: state.source,
      plan: state.doc.plan.name,
      expired: isExpired(state.doc),
      issueId: state.issueId,
      trustedKeys: this.keys.map((k) => k.keyId),
    };
  }
}

export function featureLabel(feature: FeatureKey): string {
  return FEATURES[feature].label;
}

function summarise(doc: EntitlementsDocument): Record<string, unknown> {
  return {
    plan: doc.plan,
    features: doc.features,
    limits: doc.limits,
    expiresAt: doc.expiresAt,
    issuedAt: doc.issuedAt,
  };
}
