import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import { z } from 'zod';
import { TwoFactorEnrolScreen, TwoFactorVerifyScreen } from '@/features/auth/TwoFactorScreen';
import { twoFactorStep } from '@crm/shared';
import { authClient } from '@/lib/auth/client';
import { safeRedirect } from './sign-in';

const searchSchema = z.object({
  redirect: z.string().optional(),
  /** true when the role requires 2FA and the user has not enrolled yet */
  setup: z.boolean().optional(),
});

export const Route = createFileRoute('/two-factor')({
  validateSearch: searchSchema,
  // Which of the two screens applies is decided by whether a session exists, not by how the
  // browser got here (docs/07). During sign-in the second factor is supplied before a session
  // exists, so no session means the code box is right. A full session means it never is.
  //
  // That is what a person whose second factor was just reset runs into: a stale tab, a bookmark or
  // a back button lands them on the code screen, and no code they can produce will ever work,
  // because the secret it would have to match was deleted.
  beforeLoad: async ({ search, location }) => {
    const { data } = await authClient.getSession();
    const step = twoFactorStep({
      session: data ? { twoFactorEnabled: data.user.twoFactorEnabled === true } : null,
      setup: search.setup === true,
    });
    if (step === 'verify') return;
    if (step === 'sign-in') throw redirect({ to: '/sign-in', search: { redirect: location.href } });
    if (step === 'app') throw redirect({ to: safeRedirect(search.redirect) });
    if (search.setup !== true) {
      throw redirect({
        to: '/two-factor',
        search: {
          ...(search.redirect === undefined ? {} : { redirect: search.redirect }),
          setup: true,
        },
      });
    }
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
