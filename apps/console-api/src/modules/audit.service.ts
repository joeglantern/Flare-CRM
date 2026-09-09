/**
 * Append-only audit for the console (docs/21). Same rule as the CRM's: what an owner did to a
 * customer's plan is a record nobody, including that owner, can quietly edit afterwards.
 */
import { newId } from '../lib/ids.js';
import type { Db } from '../plugins/prisma.js';

export interface AuditContext {
  actorId: string | null;
  actorType?: 'user' | 'system' | 'stack';
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

/** Never persisted, whatever a caller passes in. */
const REDACTED_KEYS = new Set(['secret', 'secretHash', 'password', 'token', 'privateKey']);

export function redactForAudit(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactForAudit);
  if (value && typeof value === 'object') {
    if (value instanceof Date) return value.toISOString();
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = REDACTED_KEYS.has(k) ? '[redacted]' : redactForAudit(v);
    }
    return out;
  }
  return value;
}

export class AuditService {
  constructor(private readonly db: Db) {}

  /** Never throws into the caller's flow: a failed audit write must not fail the action. */
  async write(ctx: AuditContext, entry: AuditEntry): Promise<void> {
    try {
      await this.db.auditLog.create({
        data: {
          id: newId(),
          actorId: ctx.actorId,
          actorType: ctx.actorType ?? 'user',
          action: entry.action,
          entity: entry.entity,
          entityId: entry.entityId ?? null,
          before: (redactForAudit(entry.before) ?? null) as object,
          after: (redactForAudit(entry.after) ?? null) as object,
          ip: ctx.ip ?? null,
          userAgent: ctx.userAgent ?? null,
          requestId: ctx.requestId ?? null,
        },
      });
    } catch {
      // swallowed on purpose; the caller's work is already done
    }
  }
}
