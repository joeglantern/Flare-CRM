import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import { z } from 'zod';
import { TwoFactorEnrolScreen, TwoFactorVerifyScreen } from '@/features/auth/TwoFactorScreen';
import { twoFactorStep, type TwoFactorVerdict } from '@crm/shared';
import { isApiError } from '@/lib/api/errors';
import { authClient } from '@/lib/auth/client';
import { ME_QUERY_KEY, meQuery } from '@/lib/auth/me';
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
  beforeLoad: async ({ context, search, location }) => {
    const api = await verdict(context.queryClient);
    const step = twoFactorStep({
      api,
      // Only read when the API has no session for this person, which is the one state it cannot
      // tell apart on its own: mid-sign-in and signed out look identical from there.
      hasClientSession:
        api.kind === 'unauthenticated' ? (await authClient.getSession()).data !== null : true,
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

/**
 * What the API says about this person. It is the same answer the authenticated layout acts on, so
 * the two cannot send each other in circles, and it rereads the second-factor flag from the
 * database rather than trusting a session snapshot that enrolment has just made obsolete.
 */
async function verdict(queryClient: QueryClient): Promise<TwoFactorVerdict> {
  try {
    const me = await queryClient.query({ ...meQuery, staleTime: 'static' });
    return { kind: 'ok', twoFactorEnabled: me.twoFactorEnabled };
  } catch (error) {
    if (isApiError(error) && error.isUnauthenticated) return { kind: 'unauthenticated' };
    if (isApiError(error) && error.isTwoFactorRequired) return { kind: 'two-factor-required' };
    throw error;
  }
}

function TwoFactorRoute() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  /**
   * Enrolling or verifying changes the very flag every route guard is about to read, and the guards
   * read it from the query cache. Dropping the cached answer rather than marking it stale, because
   * this one is loaded with `staleTime: 'static'` and a stale entry would be served anyway: the
   * person would arrive at the application, be judged by the old answer, and be sent back here.
   */
  const forgetMe = async () => {
    queryClient.removeQueries({ queryKey: ME_QUERY_KEY });
    await Promise.resolve();
  };

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
          await forgetMe();
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
        await forgetMe();
        await navigate({ to: safeRedirect(search.redirect) });
        return { ok: true };
      }}
    />
  );
}
