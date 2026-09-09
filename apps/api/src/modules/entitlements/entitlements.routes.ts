/**
 * What this stack is entitled to (docs/20 §5). Readable by every signed-in user because the web
 * app hides and locks screens from it; reachable without two-factor for the same reason
 * GET /users/me is. The only write is a re-read of a signed file, for installs with no console.
 */
import { dataResponse, entitlementsDto } from '@crm/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { ConflictError } from '../../lib/errors.js';
import { auditContext } from '../../lib/request.js';

const entitlementsRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/entitlements', {
    config: { auth: { authenticated: true, allowWithout2FA: true } },
    schema: { tags: ['entitlements'], response: { 200: dataResponse(entitlementsDto) } },
    handler: async () => ({ data: await app.entitlements.toDto() }),
  });

  app.post('/entitlements/reload', {
    config: { auth: { permission: 'settings:manage', allowWithout2FA: false, write: false } },
    schema: {
      tags: ['entitlements'],
      response: {
        200: dataResponse(
          z.object({
            result: z.enum(['applied', 'rejected']),
            reason: z.string().optional(),
            entitlements: entitlementsDto,
          }),
        ),
      },
    },
    handler: async (request) => {
      if (app.config.ENTITLEMENTS_FILE === undefined) {
        throw new ConflictError('This stack does not load entitlements from a file');
      }
      const outcome = await app.entitlements.reloadFromFile(auditContext(request));
      return {
        data: {
          result: outcome.result,
          ...(outcome.result === 'rejected' ? { reason: outcome.reason } : {}),
          entitlements: await app.entitlements.toDto(),
        },
      };
    },
  });
};

export default entitlementsRoutes;
