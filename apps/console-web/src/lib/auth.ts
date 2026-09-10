/**
 * Better Auth browser client for the console (docs/21). Cookie session, same origin, and the
 * two-factor plugin, which every account here uses: there is no console account without it.
 *
 * The console has one role, so there is no client-side access control plugin. `GET /api/v1/me`
 * says what this owner may do, and the server decides regardless.
 */
import { twoFactorClient, inferAdditionalFields } from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';
import { queryOptions } from '@tanstack/react-query';
import { http } from './api';
import { qk } from './query';
import type { Me } from './types';

export const TWO_FACTOR_ROUTE = '/two-factor';

export const authClient = createAuthClient({
  baseURL: typeof window === 'undefined' ? 'http://localhost' : window.location.origin,
  basePath: '/api/auth',
  fetchOptions: { credentials: 'include' },
  plugins: [
    twoFactorClient({
      onTwoFactorRedirect() {
        window.location.assign(TWO_FACTOR_ROUTE);
      },
    }),
    inferAdditionalFields({
      user: { isActive: { type: 'boolean', required: false, input: false } },
    }),
  ],
});

export type AuthClient = typeof authClient;

/**
 * Who is signed in. Reachable before two-factor is enrolled, which is how the shell knows to send
 * a new owner to set it up rather than showing them an empty console.
 */
export const meQuery = queryOptions({
  queryKey: qk.me(),
  queryFn: () => http.get<Me>('/api/v1/me'),
  staleTime: 60_000,
  retry: false,
});

export async function signOut(): Promise<void> {
  await authClient.signOut();
}
