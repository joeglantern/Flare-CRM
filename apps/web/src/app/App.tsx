import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createRouter } from '@tanstack/react-router';
import { useMemo } from 'react';
import { createQueryClient } from '@/lib/query';
import { routeTree } from '@/routeTree.gen';

export interface RouterContext {
  queryClient: ReturnType<typeof createQueryClient>;
}

function buildRouter(queryClient: RouterContext['queryClient']) {
  return createRouter({
    routeTree,
    context: { queryClient },
    defaultPreload: 'intent',
    defaultPreloadStaleTime: 0, // TanStack Query owns caching (docs/17 section 3)
    scrollRestoration: true,
    defaultStructuralSharing: true,
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
