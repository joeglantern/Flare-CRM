/**
 * Authenticated layout route (docs/07, docs/17 section 2). Everything under `_app/` requires a
 * session: `me` is loaded before render, guests are redirected to sign-in with a return path, and
 * privileged users without two-factor are sent to enrolment. The shell (sidebar, topbar, call
 * popup host, banners) mounts here once the designs land; the plumbing already runs.
 */
import { Outlet, createFileRoute, redirect } from '@tanstack/react-router';
import { AuthenticatedRuntime } from '@/app/AuthenticatedRuntime';
import { AppShell } from '@/app/shell/AppShell';
import { EntitlementsProvider } from '@/providers/entitlements';
import { SettingsProvider } from '@/providers/settings';
import { SocketProvider } from '@/providers/socket';
import { isApiError } from '@/lib/api/errors';
import { meQuery } from '@/lib/auth/me';

export const Route = createFileRoute('/_app')({
  beforeLoad: async ({ context, location }) => {
    try {
      const me = await context.queryClient.query({ ...meQuery, staleTime: 'static' });
      // Reading your own profile is allowed without two-factor, so this never throws for an
      // account that still has to enrol. Without this check the shell would mount and every
      // other request would come back refused.
      if (me.twoFactorRequired && !me.twoFactorEnabled) {
        throw redirect({ to: '/two-factor', search: { redirect: location.href, setup: true } });
      }
      return { me };
    } catch (error) {
      if (isApiError(error) && error.isUnauthenticated) {
        throw redirect({ to: '/sign-in', search: { redirect: location.href } });
      }
      if (isApiError(error) && error.isTwoFactorRequired) {
        throw redirect({ to: '/two-factor', search: { redirect: location.href, setup: true } });
      }
      throw error;
    }
  },
  component: AppLayout,
});

function AppLayout() {
  return (
    <SettingsProvider>
      <SocketProvider>
        <EntitlementsProvider>
          <AuthenticatedRuntime>
            <AppShell>
              <Outlet />
            </AppShell>
          </AuthenticatedRuntime>
        </EntitlementsProvider>
      </SocketProvider>
    </SettingsProvider>
  );
}
