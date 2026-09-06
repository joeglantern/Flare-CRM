import { v7 as uuidv7, validate as uuidValidate } from 'uuid';

/** Time-ordered, unguessable ids for every row (docs/02, docs/05). */
export function newId(): string {
  return uuidv7();
}

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && uuidValidate(value);
}
