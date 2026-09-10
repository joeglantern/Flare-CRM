/**
 * Routes, declared in code (docs/21). There are eight of them and no nested layouts beyond the
 * shell, so file-based routing and its generated tree would be more machinery than this app needs.
 *
 * Three routes are reachable without a session: sign-in, the second factor, and setting the second
 * factor up. Everything else waits for `GET /me` and sends the owner to whichever of those applies.
 */
import { QueryClientProvider, useQuery, type QueryClient } from '@tanstack/react-query';
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Outlet,
  redirect,
  RouterProvider,
  useNavigate,
} from '@tanstack/react-router';
import { useEffect, useMemo, type ReactNode } from 'react';
import { ToastHost } from '@crm/ui';
import { ConsoleShell } from '@/app/ConsoleShell';
import { LoadingState, ErrorState } from '@/components/Page';
import { AuditScreen } from '@/features/audit/AuditScreen';
import { SignInScreen } from '@/features/auth/SignInScreen';
import { TwoFactorRoute } from '@/features/auth/TwoFactorRoute';
import { CustomerScreen } from '@/features/customers/CustomerScreen';
import { FleetScreen } from '@/features/fleet/FleetScreen';
import { OwnersScreen } from '@/features/owners/OwnersScreen';
import { PlansScreen } from '@/features/plans/PlansScreen';
import { SettingsScreen } from '@/features/settings/SettingsScreen';
import { meQuery } from '@/lib/auth';
import { isApiError } from '@/lib/errors';
import { createQueryClient } from '@/lib/query';
import { onUnauthenticated } from '@/lib/api';

export interface RouterContext {
  queryClient: QueryClient;
}

const rootRoute = createRootRouteWithContext<RouterContext>()({ component: Outlet });

/**
 * Everything behind a session. The gate is a component rather than a loader redirect so a slow
 * `/me` shows a spinner in place instead of a blank page.
 */
function Authenticated({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const { data: me, isPending, error, refetch } = useQuery(meQuery);

  useEffect(() => onUnauthenticated(() => void navigate({ to: '/sign-in' })), [navigate]);

  useEffect(() => {
    if (!isApiError(error)) return;
    if (error.isUnauthenticated) void navigate({ to: '/sign-in' });
    else if (error.isTwoFactorRequired)
      void navigate({ to: '/two-factor', search: { setup: true } });
  }, [error, navigate]);

  useEffect(() => {
    // A session exists but the second factor was never set up: that is the only thing to do here.
    if (me !== undefined && !me.twoFactorEnabled) {
      void navigate({ to: '/two-factor', search: { setup: true } });
    }
  }, [me, navigate]);

  if (isPending) return <LoadingState label="Checking your session" />;
  if (error !== null) {
    return isApiError(error) && (error.isUnauthenticated || error.isTwoFactorRequired) ? (
      <LoadingState label="Taking you to sign in" />
    ) : (
      <ErrorState
        error={error}
        onRetry={() => {
          void refetch();
        }}
      />
    );
  }
  if (!me.twoFactorEnabled) return <LoadingState label="One moment" />;
  return <ConsoleShell me={me}>{children}</ConsoleShell>;
}

const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'authenticated',
  component: () => (
    <Authenticated>
      <Outlet />
    </Authenticated>
  ),
});

const fleetRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/',
  component: FleetScreen,
});

const customerRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/customers/$customerId',
  component: CustomerScreen,
});

const plansRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/plans',
  component: PlansScreen,
});

const ownersRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/owners',
  component: OwnersScreen,
});

const auditRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/audit',
  component: AuditScreen,
});

const settingsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/settings',
  component: SettingsScreen,
});

const signInRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/sign-in',
  beforeLoad: async ({ context }) => {
    // Already signed in and enrolled: nothing to do on this page.
    try {
      const me = await context.queryClient.query(meQuery);
      if (me.twoFactorEnabled) throw redirect({ to: '/' });
      throw redirect({ to: '/two-factor', search: { setup: true } });
    } catch (error) {
      if (isApiError(error)) return;
      throw error;
    }
  },
  component: () => (
    <>
      <SignInScreen />
      <ToastHost />
    </>
  ),
});

const twoFactorRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/two-factor',
  validateSearch: (search: Record<string, unknown>): { setup?: boolean } => ({
    ...(search.setup === true || search.setup === 'true' ? { setup: true } : {}),
  }),
  component: () => (
    <>
      <TwoFactorRoute />
      <ToastHost />
    </>
  ),
});

const routeTree = rootRoute.addChildren([
  appRoute.addChildren([
    fleetRoute,
    customerRoute,
    plansRoute,
    ownersRoute,
    auditRoute,
    settingsRoute,
  ]),
  signInRoute,
  twoFactorRoute,
]);

function buildRouter(queryClient: QueryClient) {
  return createRouter({
    routeTree,
    context: { queryClient },
    defaultPreload: 'intent',
    defaultPreloadStaleTime: 0, // TanStack Query owns caching
    scrollRestoration: true,
  });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof buildRouter>;
  }
}

export function App() {
  const queryClient = useMemo(() => createQueryClient(), []);
  const router = useMemo(() => buildRouter(queryClient), [queryClient]);
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}

export { customerRoute, twoFactorRoute };
