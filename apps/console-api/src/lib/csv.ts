/*
 * Copied from apps/api/src/lib/csv.ts and trimmed: the console writes CSV and never reads it, so
 * only the streaming half is here. Kept as a copy rather than shared, because a formula-injection
 * rule is the kind of thing that should not change under one app because the other needed it to.
 */
import { format as csvFormat } from '@fast-csv/format';
import type { Readable } from 'node:stream';

const DANGEROUS = /^[=+\-@\t\r]/;

/** Prefix cells that a spreadsheet would interpret as formulas (docs/08 E5). */
export function safeCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let s: string;
  if (value instanceof Date) s = value.toISOString();
  else if (typeof value === 'string') s = value;
  else if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint')
    s = String(value);
  else s = JSON.stringify(value);
  return DANGEROUS.test(s) ? `'${s}` : s;
}

/** Streams rows as CSV with a header row, so an export never builds the whole file in memory. */
export function csvStream(headers: string[], rows: AsyncIterable<unknown[]>): Readable {
  const formatter = csvFormat({ headers, writeBOM: true, quoteColumns: true });
  void (async () => {
    try {
      for await (const row of rows) formatter.write(row.map(safeCell));
      formatter.end();
    } catch (err) {
      formatter.destroy(err instanceof Error ? err : new Error(String(err)));
    }
  })();
  return formatter;
}
