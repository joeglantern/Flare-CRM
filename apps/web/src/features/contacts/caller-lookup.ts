/**
 * Where the phone system's popup should land for a caller's number (docs/06 section 17).
 *
 * Kept apart from the route and the page so the decision is one function with no router in it:
 * exactly one contact with the number is that contact's page, and anything else is the caller
 * page, which offers to save the number.
 */
import type { ContactSummaryDto } from '@crm/shared';

export type LookupOutcome =
  | { kind: 'none' }
  | { kind: 'contact'; contactId: string }
  | { kind: 'unknown'; number: string; candidates: ContactSummaryDto[] };

/**
 * The number as text. The router reads a query value through JSON, so `number=254712345678`
 * arrives as a number and `number=0712345678` as a string; both are the same kind of thing here.
 */
export function cleanNumber(raw: unknown): string {
  if (typeof raw === 'string') return raw.trim();
  if (typeof raw === 'number' && Number.isFinite(raw)) return String(raw);
  return '';
}

export function lookupOutcome(number: string, rows: ContactSummaryDto[]): LookupOutcome {
  if (number === '') return { kind: 'none' };
  const [only, second] = rows;
  if (only !== undefined && second === undefined) return { kind: 'contact', contactId: only.id };
  return { kind: 'unknown', number, candidates: rows };
}
