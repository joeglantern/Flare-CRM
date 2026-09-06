import { Outlet, createRootRouteWithContext } from '@tanstack/react-router';
import type { RouterContext } from '@/app/App';
import { DevTools } from '@/app/DevTools';
import { ToastHost } from '@/components/ui/toast';

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
  notFoundComponent: NotFound,
});

function RootLayout() {
  return (
    <>
      <Outlet />
      <ToastHost />
      <DevTools />
    </>
  );
}

// Placeholder until the designed 404 lands (docs/18 checklist, App shell).
function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center bg-bg text-text">
      <div className="text-center">
        <p className="text-2xs font-medium tracking-[0.2em] text-muted">404</p>
        <h1 className="mt-2 text-lg">Page not found</h1>
        <a href="/" className="mt-4 inline-block text-sm">
          Back to Flare
        </a>
      </div>
    </main>
  );
}
