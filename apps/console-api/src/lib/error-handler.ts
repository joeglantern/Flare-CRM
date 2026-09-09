/*
 * Copied from apps/api. The two services are deliberately separate processes with
 * separate databases; this plumbing is identical in both. Candidate for a shared server
 * package once something needs it a third time.
 */
/**
 * Single error → response mapping (docs/09 §3). Never leaks internals in production.
 */
import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import {
  hasZodFastifySchemaValidationErrors,
  isResponseSerializationError,
} from 'fastify-type-provider-zod';
import { isAppError } from './errors.js';

interface ErrorBody {
  error: { code: string; message: string; details?: unknown; requestId: string };
}

function body(reply: FastifyReply, code: string, message: string, details?: unknown): ErrorBody {
  const requestId = reply.request.id;
  return details === undefined
    ? { error: { code, message, requestId } }
    : { error: { code, message, details, requestId } };
}

interface PrismaLikeError {
  code?: string;
  meta?: { target?: unknown; cause?: unknown };
  name?: string;
}

export function errorHandler(
  this: unknown,
  error: FastifyError | Error,
  request: FastifyRequest,
  reply: FastifyReply,
): void {
  const isProd = process.env.NODE_ENV === 'production';

  if (hasZodFastifySchemaValidationErrors(error)) {
    const details = error.validation.map((v) => {
      const fromInstance = v.instancePath.replace(/^\//, '').replace(/\//g, '.');
      const fromIssue =
        (v.params as { issue?: { path?: (string | number)[] } }).issue?.path?.join('.') ?? '';
      return {
        path: fromInstance !== '' ? fromInstance : fromIssue,
        message: v.message ?? 'Invalid value',
      };
    });
    void reply
      .status(422)
      .send(body(reply, 'VALIDATION_FAILED', 'Request validation failed', details));
    return;
  }

  if (isResponseSerializationError(error)) {
    request.log.error({ err: error, requestId: request.id }, 'response serialization failed');
    void reply.status(500).send(body(reply, 'INTERNAL', 'Internal server error'));
    return;
  }

  if (isAppError(error)) {
    if (error.status >= 500)
      request.log.error({ err: error, requestId: request.id }, error.message);
    else request.log.info({ code: error.code, requestId: request.id }, error.message);
    void reply.status(error.status).send(body(reply, error.code, error.message, error.details));
    return;
  }

  const fe = error as FastifyError;
  const prismaErr = error as PrismaLikeError;

  // Prisma known request errors
  if (prismaErr.name === 'PrismaClientKnownRequestError' && typeof prismaErr.code === 'string') {
    if (prismaErr.code === 'P2002') {
      void reply.status(409).send(
        body(reply, 'CONFLICT', 'A record with the same unique value already exists', {
          target: prismaErr.meta?.target,
        }),
      );
      return;
    }
    if (prismaErr.code === 'P2025') {
      void reply.status(404).send(body(reply, 'NOT_FOUND', 'Resource not found'));
      return;
    }
  }

  // Fastify built-ins by status code
  const status = typeof fe.statusCode === 'number' ? fe.statusCode : 500;
  if (status === 429) {
    void reply.status(429).send(body(reply, 'RATE_LIMITED', 'Too many requests'));
    return;
  }
  if (status === 413) {
    void reply.status(413).send(body(reply, 'PAYLOAD_TOO_LARGE', 'Payload too large'));
    return;
  }
  if (status === 415) {
    void reply.status(415).send(body(reply, 'BAD_REQUEST', 'Unsupported media type'));
    return;
  }
  if (status === 400) {
    void reply.status(400).send(body(reply, 'BAD_REQUEST', isProd ? 'Bad request' : fe.message));
    return;
  }
  if (status === 401) {
    void reply.status(401).send(body(reply, 'UNAUTHENTICATED', 'Authentication required'));
    return;
  }
  if (status === 403) {
    void reply.status(403).send(body(reply, 'FORBIDDEN', 'Forbidden'));
    return;
  }
  if (status === 404) {
    void reply.status(404).send(body(reply, 'NOT_FOUND', 'Resource not found'));
    return;
  }
  if (status === 503) {
    void reply
      .status(503)
      .send(body(reply, 'SERVICE_UNAVAILABLE', 'Service temporarily unavailable'));
    return;
  }

  request.log.error({ err: error, requestId: request.id }, 'unhandled error');
  void reply
    .status(500)
    .send(body(reply, 'INTERNAL', isProd ? 'Internal server error' : error.message));
}

export function notFoundHandler(request: FastifyRequest, reply: FastifyReply): void {
  void reply
    .status(404)
    .send(
      body(
        reply,
        'NOT_FOUND',
        `Route ${request.method} ${request.url.split('?')[0] ?? ''} not found`,
      ),
    );
}
