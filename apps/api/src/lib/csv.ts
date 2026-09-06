/**
 * CSV helpers (docs/08 E5): formula-injection-safe cells, streamed output.
 */
import { format as csvFormat } from '@fast-csv/format';
import Papa from 'papaparse';
import type { Readable } from 'node:stream';

const DANGEROUS = /^[=+\-@\t\r]/;

/** Prefix cells that a spreadsheet would interpret as formulas. */
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

/** Streams rows (arrays) as CSV with a header row. */
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

export interface ParsedCsv {
  headers: string[];
  rows: Record<string, string>[];
  errors: { row: number; message: string }[];
}

const BOM = String.fromCharCode(0xfeff);

/** Parses a whole CSV buffer (imports are capped at 25 MiB by the upload limit). `maxRows = 0` keeps everything. */
export function parseCsv(buffer: Buffer, maxRows = 50_000): ParsedCsv {
  // strip a UTF-8 byte-order mark (Excel exports start with one)
  const raw = buffer.toString('utf8');
  const text = raw.startsWith(BOM) ? raw.slice(1) : raw;
  const result = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (h) => h.trim(),
  });
  const headers = result.meta.fields ?? [];
  const errors = result.errors.map((e) => ({ row: (e.row ?? 0) + 2, message: e.message }));
  const rows = maxRows > 0 ? result.data.slice(0, maxRows) : result.data;
  if (maxRows > 0 && result.data.length > maxRows)
    errors.push({ row: maxRows + 2, message: `Only the first ${maxRows} rows were processed` });
  return { headers, rows, errors };
}
