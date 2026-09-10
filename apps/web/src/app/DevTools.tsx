import { lazy, Suspense } from 'react';

/**
 * Set by the help figure capture, which photographs the dev server because that is where the demo
 * data lives. Without it the router and query buttons sit in the corner of every screenshot in the
 * manual and on the marketing site, showing customers a piece of our toolchain.
 */
const HIDDEN_KEY = 'flare-devtools-hidden';

function hidden(): boolean {
  try {
    return globalThis.localStorage.getItem(HIDDEN_KEY) === '1';
  } catch {
    return false;
  }
}

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
  if (!Lazy || hidden()) return null;
  return (
    <Suspense fallback={null}>
      <Lazy />
    </Suspense>
  );
}
