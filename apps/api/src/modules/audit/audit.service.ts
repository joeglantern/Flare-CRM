/**
 * Append-only audit writer (docs/08 §K). Never throws into the caller's flow unless the
 * write is part of a transaction (then the transaction correctly fails).
 */
import type { AuditActorType } from '@crm/shared';
import { newId } from '../../lib/ids.js';
import type { Db } from '../../plugins/prisma.js';

export interface AuditContext {
  actorId: string | null;
  actorType?: AuditActorType;
  ip?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

export interface AuditEntry {
  action: string;
  entity: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
}

/** Fields that must never be persisted in before/after snapshots. */
const REDACTED_KEYS = new Set([
  'password',
  'secret',
  'token',
  'accessToken',
  'refreshToken',
  'backupCodes',
  'secretsEncrypted',
]);

export function redactForAudit(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactForAudit);
  if (value && typeof value === 'object') {
    if (value instanceof Date) return value.toISOString();
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = REDACTED_KEYS.has(k) ? '[REDACTED]' : redactForAudit(v);
    }
    return out;
  }
  if (typeof value === 'bigint') return value.toString();
  return value;
}

type AuditWriter = Pick<Db, 'auditLog'>;

export class AuditService {
  constructor(private readonly db: Db) {}

  /** Write inside an existing transaction (preferred for mutations). */
  async writeWith(tx: AuditWriter, ctx: AuditContext, entry: AuditEntry): Promise<void> {
    await tx.auditLog.create({
      data: {
        id: newId(),
        actorId: ctx.actorId,
        actorType: ctx.actorType ?? (ctx.actorId ? 'user' : 'system'),
        action: entry.action,
        entity: entry.entity,
        entityId: entry.entityId ?? null,
        ...(entry.before === undefined ? {} : { before: redactForAudit(entry.before) as object }),
        ...(entry.after === undefined ? {} : { after: redactForAudit(entry.after) as object }),
        ip: ctx.ip ?? null,
        userAgent: ctx.userAgent?.slice(0, 512) ?? null,
        requestId: ctx.requestId ?? null,
      },
    });
  }

  /** Standalone write (auth events, webhooks). Errors are logged by the caller. */
  async write(ctx: AuditContext, entry: AuditEntry): Promise<void> {
    await this.writeWith(this.db, ctx, entry);
  }
}
