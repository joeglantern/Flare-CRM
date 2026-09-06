import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { z } from 'zod';
import { LinkExpiredScreen, SetPasswordScreen } from '@/features/auth/PasswordScreens';
import { authClient } from '@/lib/auth/client';

const searchSchema = z.object({
  token: z.string().optional(),
  /** Better Auth appends this when the link has already been used or has expired. */
  error: z.string().optional(),
  /** A brand new account sets a password rather than replacing one. */
  mode: z.enum(['reset', 'set']).optional(),
});

export const Route = createFileRoute('/reset-password')({
  validateSearch: searchSchema,
  component: ResetPasswordRoute,
});

function ResetPasswordRoute() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const token = search.token;

  if (token === undefined || search.error !== undefined) {
    return (
      <LinkExpiredScreen
        onRequestNew={() => {
          void navigate({ to: '/forgot-password' });
        }}
      />
    );
  }

  return (
    <SetPasswordScreen
      mode={search.mode ?? 'reset'}
      onBack={() => {
        void navigate({ to: '/sign-in' });
      }}
      onSubmit={async (password) => {
        const res = await authClient.resetPassword({ newPassword: password, token });
        if (res.error) {
          return {
            ok: false,
            message: res.error.message ?? 'That link is no longer valid. Ask for a new one.',
          };
        }
        await navigate({ to: '/sign-in', search: { reason: 'signed-out' } });
        return { ok: true };
      }}
    />
  );
}
