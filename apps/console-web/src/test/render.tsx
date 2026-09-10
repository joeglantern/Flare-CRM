/**
 * Test helpers: a router and a query client around the component under test, and a stand-in for
 * `fetch` that answers the console's endpoints and records what was sent to them.
 *
 * Nothing here mocks the app's own modules. A component reads through the same client, the same
 * query cache and the same socket registration it uses in the browser.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { render, type RenderResult } from '@testing-library/react';
import { vi } from 'vitest';
import type { ReactNode } from 'react';

export function testQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: 0 } },
  });
}

/** Renders inside a memory router, for screens that navigate or link. */
export function renderWithRouter(
  ui: ReactNode,
  queryClient: QueryClient = testQueryClient(),
): RenderResult & { queryClient: QueryClient } {
  const rootRoute = createRootRoute({ component: () => <>{ui}</> });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  const result = render(
    <QueryClientProvider client={queryClient}>
      {/* The router's own types are registered against the real route tree; a test tree is not it. */}
      <RouterProvider router={router as never} />
    </QueryClientProvider>,
  );
  return { ...result, queryClient };
}

/** Renders with only the query client, for components that take their data as props. */
export function renderWithQuery(
  ui: ReactNode,
  queryClient: QueryClient = testQueryClient(),
): RenderResult & { queryClient: QueryClient } {
  const result = render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
  return { ...result, queryClient };
}

export interface RecordedRequest {
  method: string;
  path: string;
  body: unknown;
}

export interface FetchStub {
  /** Every request the component made, in order. */
  requests: RecordedRequest[];
  /** The last body sent to one endpoint, which is what a payload assertion is about. */
  lastBody: (method: string, path: string) => unknown;
  restore: () => void;
}

/**
 * Answers the routes given and fails loudly on anything else: a screen quietly calling an endpoint
 * the test did not expect is worth knowing about.
 */
export function stubFetch(routes: Record<string, unknown>): FetchStub {
  const requests: RecordedRequest[] = [];
  const original = globalThis.fetch;

  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const path = url.split('?')[0] ?? url;
    const method = (init?.method ?? 'GET').toUpperCase();
    const body =
      typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : (init?.body ?? null);
    requests.push({ method, path, body });

    const key = `${method} ${path}`;
    if (!(key in routes)) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            error: { code: 'NOT_STUBBED', message: `${key} was not stubbed`, requestId: 'test' },
          }),
          { status: 500, headers: { 'content-type': 'application/json' } },
        ),
      );
    }
    const answer = routes[key];
    return Promise.resolve(
      new Response(JSON.stringify({ data: answer }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  });

  return {
    requests,
    lastBody: (method, path) =>
      [...requests].reverse().find((r) => r.method === method && r.path === path)?.body ?? null,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}
