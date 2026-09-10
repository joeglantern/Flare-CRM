/**
 * Routes, declared in code (docs/21). There are nine of them and no nested layouts beyond the
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
import { twoFactorStep } from '@crm/shared';
import { ToastHost } from '@crm/ui';
import { ConsoleShell } from '@/app/ConsoleShell';
import { LoadingState, ErrorState } from '@/components/Page';
import { OverviewScreen } from '@/features/analytics/OverviewScreen';
import { AuditScreen } from '@/features/audit/AuditScreen';
import {
  ForgotPasswordScreen,
  LinkExpiredScreen,
  SetPasswordScreen,
} from '@/features/auth/PasswordScreens';
import { SignInScreen } from '@/features/auth/SignInScreen';
import { TwoFactorRoute } from '@/features/auth/TwoFactorRoute';
import { CustomerScreen } from '@/features/customers/CustomerScreen';
import { FleetScreen } from '@/features/fleet/FleetScreen';
import { OwnersScreen } from '@/features/owners/OwnersScreen';
import { PlansScreen } from '@/features/plans/PlansScreen';
import { SettingsScreen } from '@/features/settings/SettingsScreen';
import { authClient, meQuery } from '@/lib/auth';
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

/**
 * The landing screen is the fleet-wide dashboard rather than the fleet table: an owner opening the
 * console wants to know whether anything needs them, not to read forty rows.
 */
const overviewRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/',
  component: OverviewScreen,
});

/**
 * The list of customers and the state of each one's system. "Fleet" stays the internal word for
 * every stack taken together, which is what the socket event and the analytics tables mean by it;
 * what an owner opens is a list of customers, so that is what it is called here.
 */
const customersRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/customers',
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

/** Where the emailed invitation lands, and where a forgotten password is replaced. */
const forgotPasswordRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/forgot-password',
  component: ForgotPassword,
});

const resetPasswordRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/reset-password',
  validateSearch: (search: Record<string, unknown>): ResetSearch => ({
    ...(typeof search.token === 'string' ? { token: search.token } : {}),
    ...(typeof search.error === 'string' ? { error: search.error } : {}),
    ...(search.mode === 'set' ? { mode: 'set' as const } : {}),
  }),
  component: ResetPassword,
});

const twoFactorRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/two-factor',
  validateSearch: (search: Record<string, unknown>): { setup?: boolean } => ({
    ...(search.setup === true || search.setup === 'true' ? { setup: true } : {}),
  }),
  // Which screen applies is decided by the session, not by how the browser got here (docs/21 §2).
  // An owner whose second factor was just reset arrives with a working session and no second
  // factor; if a bookmark or a back button drops them on the code box they can never leave it,
  // because the secret their code would have to match was deleted.
  beforeLoad: async ({ search }) => {
    const { data } = await authClient.getSession();
    const step = twoFactorStep({
      session: data ? { twoFactorEnabled: data.user.twoFactorEnabled === true } : null,
      setup: search.setup === true,
    });
    if (step === 'app') throw redirect({ to: '/' });
    if (step === 'sign-in') throw redirect({ to: '/sign-in' });
    if (step === 'enrol' && search.setup !== true) {
      throw redirect({ to: '/two-factor', search: { setup: true } });
    }
  },
  component: () => (
    <>
      <TwoFactorRoute />
      <ToastHost />
    </>
  ),
});

interface ResetSearch {
  token?: string;
  /** Better Auth appends this when a link has already been used or has expired. */
  error?: string;
  /** A brand new owner sets a password rather than replacing one. */
  mode?: 'set';
}

function ForgotPassword() {
  const navigate = useNavigate();
  return (
    <>
      <ForgotPasswordScreen
        onBack={() => {
          void navigate({ to: '/sign-in' });
        }}
        onSubmit={async (email) => {
          // Whether the send succeeded is deliberately not reported: it would reveal whether the
          // address has an account here. Only a transport failure is worth surfacing.
          try {
            await authClient.requestPasswordReset({ email, redirectTo: '/reset-password' });
            return { ok: true };
          } catch {
            return {
              ok: false,
              message: 'Could not reach the console. Check your connection and try again.',
            };
          }
        }}
      />
      <ToastHost />
    </>
  );
}

function ResetPassword() {
  const search = resetPasswordRoute.useSearch();
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
        await navigate({ to: '/sign-in' });
        return { ok: true };
      }}
    />
  );
}

const routeTree = rootRoute.addChildren([
  appRoute.addChildren([
    overviewRoute,
    customersRoute,
    customerRoute,
    plansRoute,
    ownersRoute,
    auditRoute,
    settingsRoute,
  ]),
  signInRoute,
  twoFactorRoute,
  forgotPasswordRoute,
  resetPasswordRoute,
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
