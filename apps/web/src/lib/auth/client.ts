/**
 * Better Auth browser client (docs/07). Cookie session, same origin, plugins mirror the server:
 * admin (shared access control), two-factor, and the additional user fields the server exposes.
 */
import { ac, roles } from '@crm/shared';
import { adminClient, inferAdditionalFields, twoFactorClient } from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';

export const TWO_FACTOR_ROUTE = '/two-factor';

export const authClient = createAuthClient({
  baseURL: typeof window === 'undefined' ? 'http://localhost' : window.location.origin,
  basePath: '/api/auth',
  fetchOptions: { credentials: 'include' },
  plugins: [
    adminClient({ ac, roles }),
    twoFactorClient({
      onTwoFactorRedirect() {
        window.location.assign(TWO_FACTOR_ROUTE);
      },
    }),
    inferAdditionalFields({
      user: {
        extension: { type: 'string', required: false, input: false },
        teamId: { type: 'string', required: false, input: false },
        phone: { type: 'string', required: false, input: false },
        timezone: { type: 'string', required: false, input: false },
        locale: { type: 'string', required: false, input: false },
        isActive: { type: 'boolean', required: false, input: false },
        avatarKey: { type: 'string', required: false, input: false },
      },
    }),
  ],
});

export type AuthClient = typeof authClient;
