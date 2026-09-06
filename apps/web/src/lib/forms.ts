/**
 * Form plumbing (docs/17 section 4): Zod schemas come from @crm/shared, server 422 details are
 * mapped onto the same field paths so the user sees the error next to the field, not in a toast.
 */
import { zodResolver } from '@hookform/resolvers/zod';
import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';
import { ApiError } from './api/errors';

export { zodResolver };

/**
 * Returns true when at least one issue matched a field. Unmatched issues land on `root.server`
 * so the form can show them at the top.
 */
export function applyServerErrors<T extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<T>,
): boolean {
  if (!(error instanceof ApiError)) {
    setError('root.server', {
      type: 'server',
      message: error instanceof Error ? error.message : 'Something went wrong.',
    });
    return false;
  }
  const issues = error.fieldIssues;
  if (issues.length === 0) {
    setError('root.server', { type: 'server', message: error.message });
    return false;
  }
  let matched = false;
  for (const issue of issues) {
    const path = issue.path.replace(/\[(\d+)\]/g, '.$1');
    if (path.length === 0) continue;
    setError(path as Path<T>, { type: 'server', message: issue.message });
    matched = true;
  }
  if (!matched) setError('root.server', { type: 'server', message: error.message });
  return matched;
}

/** Flattens Zod issues onto `a.b.0.c` keys, the same shape the server uses in a 422. */
export function zodFieldErrors(error: {
  issues: { path: PropertyKey[]; message: string }[];
}): Record<string, string> {
  const next: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.map((p) => String(p)).join('.');
    next[key] ??= issue.message;
  }
  return next;
}

/** Maps a server 422 onto the same field keys. Returns null when nothing matched a field. */
export function serverFieldErrors(error: unknown): Record<string, string> | null {
  if (!(error instanceof ApiError) || error.fieldIssues.length === 0) return null;
  const next: Record<string, string> = {};
  for (const issue of error.fieldIssues) {
    const key = issue.path.replace(/\[(\d+)\]/g, '.$1');
    if (key !== '') next[key] ??= issue.message;
  }
  return Object.keys(next).length === 0 ? null : next;
}

/** Moves focus to the first field that failed, so the user is never left hunting for it. */
export function focusFirstError(errors: Record<string, string>): void {
  const first = Object.keys(errors)[0];
  if (first === undefined || typeof document === 'undefined') return;
  requestAnimationFrame(() => {
    const el = document.querySelector<HTMLElement>(`[name="${CSS.escape(first)}"]`);
    el?.focus();
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  });
}
