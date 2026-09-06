import { z } from 'zod';

export const uuid = z.uuid();
export const isoDateTime = z.iso.datetime({ offset: true });
export const isoDate = z.iso.date();

export const emailSchema = z
  .email()
  .max(254)
  .transform((v) => v.toLowerCase());

/** Any user-typed phone; normalized server-side with the tenant default country. */
export const phoneInput = z.string().trim().min(3).max(32);

export const paginationOffset = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export const paginationCursor = z.object({
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const searchQuery = z.string().trim().min(2).max(200);

export const sortParam = (allowed: readonly string[]) =>
  z
    .string()
    .max(200)
    .optional()
    .transform((v, ctx) => {
      if (!v) return [] as { field: string; direction: 'asc' | 'desc' }[];
      const parts = v
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean);
      const out: { field: string; direction: 'asc' | 'desc' }[] = [];
      for (const p of parts) {
        const direction = p.startsWith('-') ? 'desc' : 'asc';
        const field = p.replace(/^-/, '');
        if (!allowed.includes(field)) {
          ctx.addIssue({ code: 'custom', message: `Cannot sort by "${field}"` });
          continue;
        }
        out.push({ field, direction });
      }
      return out;
    });

export const errorResponse = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
    requestId: z.string(),
  }),
});

export const offsetPage = z.object({
  page: z.number().int(),
  pageSize: z.number().int(),
  total: z.number().int(),
});

export const cursorPage = z.object({
  cursor: z.string().nullable(),
  hasMore: z.boolean(),
});

export function dataResponse<T extends z.ZodType>(schema: T) {
  return z.object({ data: schema });
}
export function offsetListResponse<T extends z.ZodType>(schema: T) {
  return z.object({ data: z.array(schema), page: offsetPage });
}
export function cursorListResponse<T extends z.ZodType>(schema: T) {
  return z.object({ data: z.array(schema), page: cursorPage });
}

export const idParams = z.object({ id: uuid });
