/**
 * CSV import and export (docs/09 · Import/Export).
 * GAP-09: IMPORT_FIELDS covers contact, company and lead only — deals and tasks cannot be
 * imported, though they are exportable.
 */
import type { ImportJobDto, ImportMapping } from '@crm/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { downloadFile, http, type OffsetList, type Query } from '@/lib/api/client';
import { qk } from '@/lib/query';

export type ImportEntity = 'contact' | 'company' | 'lead';
export type ExportEntity = 'contacts' | 'companies' | 'leads' | 'deals' | 'tasks' | 'calls';

export function useImports(filters: Query = {}, enabled = true) {
  return useQuery({
    queryKey: qk.list('imports', filters),
    enabled,
    queryFn: (): Promise<OffsetList<ImportJobDto>> =>
      http.list<ImportJobDto>('/api/v1/imports', filters),
    refetchInterval: (q) =>
      (q.state.data?.data ?? []).some((j) => j.status === 'running' || j.status === 'queued')
        ? 3000
        : false,
  });
}

export function useImportJob(id: string | null) {
  return useQuery({
    queryKey: qk.entity('import', id ?? ''),
    enabled: id !== null && id !== '',
    queryFn: () => http.get<ImportJobDto>(`/api/v1/imports/${id ?? ''}`),
    refetchInterval: (q) => {
      const s = q.state.data?.status;
      return s === 'running' || s === 'queued' ? 2000 : false;
    },
  });
}

export function useStartImport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      entity,
      file,
      mapping,
    }: {
      entity: ImportEntity;
      file: File;
      mapping: ImportMapping;
    }) => {
      const form = new FormData();
      // The route reads three multipart fields: the file, the entity, and the mapping as JSON.
      form.append('entity', entity);
      form.append('file', file);
      form.append('mapping', JSON.stringify(mapping));
      const res = await fetch('/api/v1/imports', {
        method: 'POST',
        body: form,
        credentials: 'include',
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
        throw new Error(body.error?.message ?? `Import failed (${String(res.status)})`);
      }
      return ((await res.json()) as { data: ImportJobDto }).data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.list('imports') });
    },
  });
}

export function importErrorReportUrl(id: string): string {
  return `/api/v1/imports/${id}/errors.csv`;
}

/** Exports carry the current filters so what you see is what you get. */
export async function exportCsv(entity: ExportEntity, filters: Query): Promise<void> {
  const stamp = new Date().toISOString().slice(0, 10);
  await downloadFile(
    `/api/v1/exports/${entity}`,
    { format: 'csv', ...filters },
    `${entity}-${stamp}.csv`,
  );
}

/** Reads the header row and a few sample rows in the browser, so mapping needs no round trip. */
export async function previewCsv(
  file: File,
  sampleRows = 5,
): Promise<{ headers: string[]; rows: string[][] }> {
  const text = await file.slice(0, 256 * 1024).text();
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  const parseLine = (line: string): string[] => {
    const out: string[] = [];
    let cur = '';
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i] ?? '';
      if (quoted) {
        if (c === '"' && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else if (c === '"') quoted = false;
        else cur += c;
      } else if (c === '"') quoted = true;
      else if (c === ',') {
        out.push(cur);
        cur = '';
      } else cur += c;
    }
    out.push(cur);
    return out.map((v) => v.trim());
  };
  const headers = parseLine(lines[0] ?? '');
  const rows = lines.slice(1, 1 + sampleRows).map(parseLine);
  return { headers, rows };
}

/** Guesses a column mapping by name, so a well-formed file needs no clicking at all. */
export function guessMapping(
  headers: string[],
  fields: Record<string, string>,
): Record<string, string> {
  const norm = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, '');
  const byField = new Map<string, string>();
  for (const [key, label] of Object.entries(fields)) {
    byField.set(norm(key), key);
    byField.set(norm(label), key);
  }
  const out: Record<string, string> = {};
  for (const h of headers) {
    const hit = byField.get(norm(h));
    if (hit !== undefined && !Object.values(out).includes(hit)) out[h] = hit;
  }
  return out;
}
