/**
 * Request id + raw body capture (docs/08 K3, H1).
 * - `X-Request-Id` is honoured only if it is a UUID; otherwise a UUIDv7 is generated (see app.ts genReqId).
 * - JSON bodies are parsed from a buffer so webhook handlers can verify signatures on the exact bytes.
 */
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

export default fp(
  function requestContext(app: FastifyInstance) {
    app.addHook('onSend', (request, reply, _payload, done) => {
      reply.header('x-request-id', request.id);
      done();
    });

    const defaultJsonParser = app.getDefaultJsonParser('error', 'error');
    app.removeContentTypeParser('application/json');
    app.addContentTypeParser(
      'application/json',
      { parseAs: 'buffer' },
      (request, payload, done) => {
        const buffer = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
        request.rawBody = buffer;
        // action endpoints (e.g. POST /users/:id/deactivate) legitimately send no body
        if (buffer.length === 0) {
          done(null, undefined);
          return;
        }
        void defaultJsonParser(request, buffer.toString('utf8'), done);
      },
    );
  },
  { name: 'request-context' },
);
