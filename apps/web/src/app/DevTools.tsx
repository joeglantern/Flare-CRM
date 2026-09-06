import { lazy, Suspense } from 'react';

/** Router and Query devtools, development builds only; tree-shaken from production. */
const Lazy = import.meta.env.DEV
  ? lazy(async () => {
      const [{ ReactQueryDevtools }, { TanStackRouterDevtools }] = await Promise.all([
        import('@tanstack/react-query-devtools'),
        import('@tanstack/react-router-devtools'),
      ]);
      return {
        default: () => (
          <>
            <ReactQueryDevtools buttonPosition="bottom-left" initialIsOpen={false} />
            <TanStackRouterDevtools position="bottom-right" initialIsOpen={false} />
          </>
        ),
      };
    })
  : null;

export function DevTools() {
  if (!Lazy) return null;
  return (
    <Suspense fallback={null}>
      <Lazy />
    </Suspense>
  );
}
