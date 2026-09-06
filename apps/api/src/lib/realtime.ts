/**
 * Broadcaster abstraction (docs/10). The api process emits through its Socket.IO server; the
 * worker emits through the Valkey-backed emitter. Payloads are validated in non-production.
 */
import { assertServerEvent, type ServerEventName, type ServerEventPayload } from '@crm/shared';

export interface Broadcaster {
  to(rooms: string | string[]): {
    emit<E extends ServerEventName>(event: E, payload: ServerEventPayload<E>): void;
  };
}

export const rooms = {
  user: (id: string) => `user:${id}`,
  ext: (extension: string) => `ext:${extension}`,
  team: (id: string) => `team:${id}`,
  role: (role: string) => `role:${role}`,
  conv: (id: string) => `conv:${id}`,
  entity: (type: string, id: string) => `entity:${type}:${id}`,
  all: 'all',
} as const;

export function validatedPayload<E extends ServerEventName>(
  event: E,
  payload: ServerEventPayload<E>,
  validate: boolean,
): ServerEventPayload<E> {
  return validate ? assertServerEvent(event, payload) : payload;
}

export function nowIso(): string {
  return new Date().toISOString();
}
