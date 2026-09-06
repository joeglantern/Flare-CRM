import { z } from 'zod';
import { ActivityType, valuesOf } from '../enums.js';
import { isoDateTime, paginationCursor, uuid } from './common.js';

export const activityDto = z.object({
  id: uuid,
  type: z.enum(valuesOf(ActivityType)),
  contactId: uuid.nullable(),
  dealId: uuid.nullable(),
  companyId: uuid.nullable(),
  actor: z.object({ id: uuid, name: z.string() }).nullable(),
  occurredAt: isoDateTime,
  summary: z.string(),
  ref: z.object({ table: z.string(), id: uuid }),
  meta: z.record(z.string(), z.unknown()),
});
export type ActivityDto = z.infer<typeof activityDto>;

const typesParam = z
  .string()
  .max(300)
  .optional()
  .transform((v, ctx) => {
    if (!v) return undefined;
    const list = v
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const allowed = new Set<string>(valuesOf(ActivityType));
    for (const t of list) {
      if (!allowed.has(t))
        ctx.addIssue({ code: 'custom', message: `Unknown activity type "${t}"` });
    }
    return list as (typeof ActivityType)[keyof typeof ActivityType][];
  });

export const timelineQuery = paginationCursor.extend({
  contactId: uuid.optional(),
  dealId: uuid.optional(),
  companyId: uuid.optional(),
  types: typesParam,
  q: z.string().trim().min(2).max(120).optional(),
  from: isoDateTime.optional(),
  to: isoDateTime.optional(),
});
