/**
 * Unified timeline writer/reader (docs/03 §3.5, docs/05 "activities"). Every module records
 * activities inside its own transaction via `record(tx, …)`.
 */
import type { ActivityDto, ActivityType, VisibilityScope } from '@crm/shared';
import type { z } from 'zod';
import type { timelineQuery } from '@crm/shared';
import { newId } from '../../lib/ids.js';
import { decodeCursor, pageOf } from '../../lib/pagination.js';
import { SHAPES, scopeWhere } from '../../lib/scope.js';
import type { Db } from '../../plugins/prisma.js';

export interface ActivityInput {
  type: ActivityType;
  contactId?: string | null;
  dealId?: string | null;
  companyId?: string | null;
  actorId?: string | null;
  occurredAt?: Date;
  summary: string;
  refTable: string;
  refId: string;
  meta?: Record<string, unknown>;
}

type ActivityWriter = Pick<Db, 'activity'>;

const select = {
  id: true,
  type: true,
  contactId: true,
  dealId: true,
  companyId: true,
  actorId: true,
  occurredAt: true,
  summary: true,
  refTable: true,
  refId: true,
  meta: true,
} as const;

export class ActivityService {
  constructor(private readonly db: Db) {}

  async record(tx: ActivityWriter, input: ActivityInput): Promise<string> {
    const id = newId();
    await tx.activity.create({
      data: {
        id,
        type: input.type,
        contactId: input.contactId ?? null,
        dealId: input.dealId ?? null,
        companyId: input.companyId ?? null,
        actorId: input.actorId ?? null,
        occurredAt: input.occurredAt ?? new Date(),
        summary: input.summary.slice(0, 500),
        refTable: input.refTable,
        refId: input.refId,
        meta: (input.meta ?? {}) as object,
      },
    });
    return id;
  }

  private async actorNames(ids: (string | null)[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter((v): v is string => v !== null))];
    if (unique.length === 0) return new Map();
    const users = await this.db.user.findMany({
      where: { id: { in: unique } },
      select: { id: true, name: true },
    });
    return new Map(users.map((u) => [u.id, u.name]));
  }

  private toDto(
    row: {
      id: string;
      type: string;
      contactId: string | null;
      dealId: string | null;
      companyId: string | null;
      actorId: string | null;
      occurredAt: Date;
      summary: string;
      refTable: string;
      refId: string;
      meta: unknown;
    },
    names: Map<string, string>,
  ): ActivityDto {
    return {
      id: row.id,
      type: row.type as ActivityType,
      contactId: row.contactId,
      dealId: row.dealId,
      companyId: row.companyId,
      actor: row.actorId ? { id: row.actorId, name: names.get(row.actorId) ?? 'Unknown' } : null,
      occurredAt: row.occurredAt.toISOString(),
      summary: row.summary,
      ref: { table: row.refTable, id: row.refId },
      meta: (row.meta ?? {}) as Record<string, unknown>,
    };
  }

  /** Last N activities for a contact (screen pop, R-4.1.4). */
  async recentForContact(contactId: string, limit = 5): Promise<ActivityDto[]> {
    const rows = await this.db.activity.findMany({
      where: { contactId },
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      take: limit,
      select,
    });
    const names = await this.actorNames(rows.map((r) => r.actorId));
    return rows.map((r) => this.toDto(r, names));
  }

  /**
   * Notes written on this contact's calls. Such a note records no contact of its own, and the call
   * may only have been linked to one later, so looking it up when reading covers notes already
   * written and calls linked after the fact, which a value stored at write time would miss.
   */
  private async callNotesOf(
    contactId: string,
    contactScope: Record<string, unknown>,
  ): Promise<string[]> {
    const rows = await this.db.note.findMany({
      where: { contactId: null, call: { contactId, contact: { is: contactScope } } },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  async timeline(scope: VisibilityScope, query: z.infer<typeof timelineQuery>) {
    const cursor = decodeCursor(query.cursor);
    const contactScope = scopeWhere(scope, SHAPES.contact);
    const callNotes = query.contactId ? await this.callNotesOf(query.contactId, contactScope) : [];
    const ofCallNotes = { refTable: 'notes', refId: { in: callNotes } };
    const where: Record<string, unknown> = {
      ...(query.contactId
        ? callNotes.length > 0
          ? { AND: [{ OR: [{ contactId: query.contactId }, ofCallNotes] }] }
          : { contactId: query.contactId }
        : {}),
      ...(query.dealId ? { dealId: query.dealId } : {}),
      ...(query.companyId ? { companyId: query.companyId } : {}),
      ...(query.types ? { type: { in: query.types } } : {}),
      ...(query.from || query.to
        ? {
            occurredAt: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lte: new Date(query.to) } : {}),
            },
          }
        : {}),
      ...(cursor
        ? {
            OR: [
              { occurredAt: { lt: cursor.at } },
              { occurredAt: cursor.at, id: { lt: cursor.id } },
            ],
          }
        : {}),
    };
    // visibility: the activity is visible if its contact (or deal) is visible to the caller
    if (scope.kind !== 'all') {
      const dealScope = scopeWhere(scope, SHAPES.deal);
      /*
       * `is`: the shared address book makes the contact filter `{}`, and an OR drops a bare empty
       * relation filter, which left an agent seeing nothing of a contact's journal but deals. Only
       * for one named contact: with the book on, an unfiltered feed would otherwise become every
       * contact's activity.
       */
      const viaContact =
        query.contactId || Object.keys(contactScope).length > 0
          ? [{ contact: { is: contactScope } }]
          : [];
      where.AND = [
        ...((where.AND as unknown[] | undefined) ?? []),
        {
          OR: [...viaContact, { deal: dealScope }, ...(callNotes.length > 0 ? [ofCallNotes] : [])],
        },
      ];
    }

    if (query.q) {
      // full-text over the generated tsvector, restricted to the same filters via a subquery on ids
      const rows = await this.db.$queryRaw<{ id: string }[]>`
        SELECT id FROM activities
        WHERE search_vector @@ plainto_tsquery('simple', ${query.q})
        ORDER BY occurred_at DESC LIMIT 2000`;
      const ids = rows.map((r) => r.id);
      if (ids.length === 0) return { data: [], page: { cursor: null, hasMore: false } };
      where.id = { in: ids };
    }

    const rows = await this.db.activity.findMany({
      where,
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      select,
    });
    const names = await this.actorNames(rows.map((r) => r.actorId));
    const page = pageOf(rows, query.limit, (r) => r.occurredAt);
    return { data: page.data.map((r) => this.toDto(r, names)), page: page.page };
  }
}
