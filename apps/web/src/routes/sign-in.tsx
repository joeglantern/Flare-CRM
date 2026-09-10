import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import { z } from 'zod';
import { SignInScreen } from '@/features/auth/SignInScreen';
import { isApiError } from '@/lib/api/errors';
import { authClient } from '@/lib/auth/client';
import { meQuery } from '@/lib/auth/me';

const searchSchema = z.object({
  redirect: z.string().optional(),
  reason: z.enum(['idle', 'signed-out']).optional(),
});

export const Route = createFileRoute('/sign-in')({
  validateSearch: searchSchema,
  beforeLoad: async ({ context, search }) => {
    // already signed in: go where they were heading
    try {
      await context.queryClient.query({ ...meQuery, staleTime: 'static' });
      throw redirect({ to: safeRedirect(search.redirect) });
    } catch (error) {
      if (isApiError(error)) return; // 401 or 2FA required: show the form / let _app route them
      throw error;
    }
  },
  component: SignInRoute,
});

/**
 * The auth screens themselves are never a destination. Sending somebody back to one after they
 * have just signed in is how a person whose second factor was reset ends up staring at a code box
 * with no code to give.
 */
const AUTH_PATHS = ['/sign-in', '/two-factor', '/forgot-password', '/reset-password'];

/** Only same-origin paths are honoured, never absolute URLs (open-redirect guard). */
export function safeRedirect(target: string | undefined): string {
  if (!target || !target.startsWith('/') || target.startsWith('//')) return '/home';
  const path = target.split(/[?#]/)[0] ?? '';
  if (AUTH_PATHS.some((auth) => path === auth || path.startsWith(`${auth}/`))) return '/home';
  return target;
}

function SignInRoute() {
  const search = Route.useSearch();
  const navigate = useNavigate();

  return (
    <SignInScreen
      {...(search.reason !== undefined ? { reason: search.reason } : {})}
      onForgot={() => {
        void navigate({ to: '/forgot-password' });
      }}
      onSubmit={async (values) => {
        const { error } = await authClient.signIn.email(values);
        if (error) {
          // A deactivated account is the one failure the user cannot fix alone, so it is named.
          // Everything else stays vague on purpose: saying which half was wrong lets an attacker
          // work out which email addresses exist.
          const deactivated = error.code === 'BANNED_USER' || error.status === 403;
          return {
            ok: false,
            message: deactivated
              ? 'This account has been deactivated. Ask an administrator to reactivate it.'
              : 'That email and password do not match.',
          };
        }
        // twoFactorClient redirects to /two-factor itself when a second step is required
        await navigate({ to: safeRedirect(search.redirect) });
        return { ok: true };
      }}
    />
  );
}
