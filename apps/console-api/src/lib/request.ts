/*
 * Copied from apps/api and trimmed: the console has no teams and no visibility scopes.
 */
import type { FastifyRequest } from 'fastify';
import type { AuthUser } from '../auth/auth.js';
import { UnauthenticatedError } from './errors.js';
import type { AuditContext } from '../modules/audit.service.js';

/** The signed-in owner; every non-public route has one. */
export function requireUser(request: FastifyRequest): AuthUser {
  if (!request.user) throw new UnauthenticatedError();
  return request.user;
}

export function auditContext(request: FastifyRequest): AuditContext {
  return {
    actorId: request.user?.id ?? null,
    ip: request.ip,
    userAgent: request.headers['user-agent'] ?? null,
    requestId: request.id,
  };
}
