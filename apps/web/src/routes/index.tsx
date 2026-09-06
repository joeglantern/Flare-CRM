import { createFileRoute, redirect } from '@tanstack/react-router';

/** "/" always lands on the authenticated home; the guard in `_app` sends guests to sign-in. */
export const Route = createFileRoute('/')({
  beforeLoad: () => {
    throw redirect({ to: '/home' });
  },
});
