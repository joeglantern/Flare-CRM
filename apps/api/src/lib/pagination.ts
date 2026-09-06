/**
 * Opaque cursors for time-ordered lists (docs/09 §2): base64url of `{ t: ISO, id }`.
 */
import { BadRequestError } from './errors.js';
import { isUuid } from './ids.js';

export interface TimeCursor {
  at: Date;
  id: string;
}

export function encodeCursor(c: TimeCursor): string {
  return Buffer.from(JSON.stringify({ t: c.at.toISOString(), id: c.id }), 'utf8').toString(
    'base64url',
  );
}

export function decodeCursor(raw: string | undefined): TimeCursor | null {
  if (raw === undefined) return null;
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as {
      t?: unknown;
      id?: unknown;
    };
    if (typeof parsed.t !== 'string' || !isUuid(parsed.id)) throw new Error('shape');
    const at = new Date(parsed.t);
    if (Number.isNaN(at.getTime())) throw new Error('date');
    return { at, id: parsed.id };
  } catch {
    throw new BadRequestError('Invalid cursor');
  }
}

/** Trim a `take = limit + 1` result set into a page + next cursor. */
export function pageOf<T extends { id: string }>(rows: T[], limit: number, at: (row: T) => Date) {
  const hasMore = rows.length > limit;
  const data = hasMore ? rows.slice(0, limit) : rows;
  const last = data.at(-1);
  return {
    data,
    page: { cursor: hasMore && last ? encodeCursor({ at: at(last), id: last.id }) : null, hasMore },
  };
}
