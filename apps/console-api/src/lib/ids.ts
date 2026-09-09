/*
 * Copied from apps/api. The two services are deliberately separate processes with
 * separate databases; this plumbing is identical in both. Candidate for a shared server
 * package once something needs it a third time.
 */
import { v7 as uuidv7, validate as uuidValidate } from 'uuid';

/** Time-ordered, unguessable ids for every row (docs/02, docs/05). */
export function newId(): string {
  return uuidv7();
}

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && uuidValidate(value);
}
