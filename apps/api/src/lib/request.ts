import type { FastifyRequest } from 'fastify';
import type { AuthUser } from '../auth/auth.js';
import { UnauthenticatedError } from './errors.js';
import type { AuditContext } from '../modules/audit/audit.service.js';

/** The authenticated user; routes with `config.auth` non-public always have one. */
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

export function actorOf(request: FastifyRequest): {
  id: string;
  role: string;
  teamId: string | null;
} {
  const user = requireUser(request);
  return { id: user.id, role: user.role ?? 'agent', teamId: user.teamId ?? null };
}
