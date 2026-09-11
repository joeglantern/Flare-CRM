/**
 * Where a welcome email lands.
 *
 * A new account is created with a password nobody knows and is then sent through the password
 * reset flow with the welcome template (docs/07 §6), so the link carries a reset token but the
 * person on the other end has never had a password to reset. That is why this exists as its own
 * address rather than as a query on /reset-password: it is the path the invitation already points
 * at, so every link already sitting in somebody's inbox works, and the wording is right for
 * somebody setting a first password rather than replacing a forgotten one.
 *
 * An expired welcome link cannot be replaced by the person holding it: they have no account they
 * can prove they own yet. It sends them to their administrator instead of to forgot-password,
 * which would ask them to confirm an address they have not signed in with.
 */
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { z } from 'zod';
import { LinkExpiredScreen, SetPasswordScreen } from '@/features/auth/PasswordScreens';
import { authClient } from '@/lib/auth/client';

const searchSchema = z.object({
  token: z.string().optional(),
  /** Better Auth appends this when the link has already been used or has expired. */
  error: z.string().optional(),
});

export const Route = createFileRoute('/set-password')({
  validateSearch: searchSchema,
  component: SetPasswordRoute,
});

function SetPasswordRoute() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const token = search.token;

  if (token === undefined || search.error !== undefined) {
    return (
      <LinkExpiredScreen
        onRequestNew={() => {
          void navigate({ to: '/sign-in' });
        }}
      />
    );
  }

  return (
    <SetPasswordScreen
      mode="set"
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
