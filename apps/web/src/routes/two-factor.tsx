import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import { z } from 'zod';
import { TwoFactorEnrolScreen, TwoFactorVerifyScreen } from '@/features/auth/TwoFactorScreen';
import { authClient } from '@/lib/auth/client';
import { safeRedirect } from './sign-in';

const searchSchema = z.object({
  redirect: z.string().optional(),
  /** true when the role requires 2FA and the user has not enrolled yet */
  setup: z.boolean().optional(),
});

export const Route = createFileRoute('/two-factor')({
  validateSearch: searchSchema,
  // Enrolling needs a session: the server re-checks the password against the signed-in account.
  // Without this a signed-out visitor gets the form, and the server's "Unauthorized" is shown in
  // the password field as though the password were wrong. The verify step is deliberately not
  // guarded, because during sign-in the second factor is supplied before a session exists.
  beforeLoad: async ({ search, location }) => {
    if (search.setup !== true) return;
    const { data } = await authClient.getSession();
    if (!data) throw redirect({ to: '/sign-in', search: { redirect: location.href } });
  },
  component: TwoFactorRoute,
});

function TwoFactorRoute() {
  const search = Route.useSearch();
  const navigate = useNavigate();

  const signOut = () => {
    void authClient.signOut().then(() => navigate({ to: '/sign-in' }));
  };

  if (search.setup === true) {
    return (
      <TwoFactorEnrolScreen
        onSignOut={signOut}
        onBegin={async (password) => {
          const res = await authClient.twoFactor.enable({ password });
          if (res.error)
            return { ok: false, message: res.error.message ?? 'That password was not accepted.' };
          if (!('totpURI' in res.data)) {
            return {
              ok: false,
              message: 'This account uses email codes, which an admin configures.',
            };
          }
          return { ok: true, totpURI: res.data.totpURI, backupCodes: res.data.backupCodes };
        }}
        onConfirm={async (code) => {
          const res = await authClient.twoFactor.verifyTotp({ code });
          if (res.error)
            return { ok: false, message: res.error.message ?? 'That code did not match.' };
          await navigate({ to: safeRedirect(search.redirect) });
          return { ok: true };
        }}
      />
    );
  }

  return (
    <TwoFactorVerifyScreen
      onSignOut={signOut}
      onVerify={async (code, trustDevice) => {
        // A backup code is longer than the six digit TOTP, which is how one field serves both.
        const res =
          code.length > 6
            ? await authClient.twoFactor.verifyBackupCode({ code })
            : await authClient.twoFactor.verifyTotp({ code, trustDevice });
        if (res.error)
          return { ok: false, message: res.error.message ?? 'That code was not accepted.' };
        await navigate({ to: safeRedirect(search.redirect) });
        return { ok: true };
      }}
    />
  );
}
