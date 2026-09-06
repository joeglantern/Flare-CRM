import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { ForgotPasswordScreen } from '@/features/auth/PasswordScreens';
import { authClient } from '@/lib/auth/client';

export const Route = createFileRoute('/forgot-password')({ component: ForgotPasswordRoute });

function ForgotPasswordRoute() {
  const navigate = useNavigate();
  return (
    <ForgotPasswordScreen
      onBack={() => {
        void navigate({ to: '/sign-in' });
      }}
      onSubmit={async (email) => {
        // The result is deliberately not reported: saying whether the send succeeded would reveal
        // whether the address is registered. Only a transport failure is worth surfacing.
        try {
          await authClient.requestPasswordReset({ email, redirectTo: '/reset-password' });
          return { ok: true };
        } catch {
          return {
            ok: false,
            message: 'Could not reach the server. Check your connection and try again.',
          };
        }
      }}
    />
  );
}
