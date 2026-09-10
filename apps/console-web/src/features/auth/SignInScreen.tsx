/**
 * Sign in. There is no sign-up: an owner is created by another owner and receives a set-password
 * link. A failure stays vague on purpose, except a deactivated account, which the person cannot fix
 * by trying again.
 */
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { Button, Input, PasswordInput } from '@crm/ui';
import { authClient } from '@/lib/auth';
import { AuthLayout } from './AuthLayout';

export function SignInScreen() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = () => {
    setError(null);
    setBusy(true);
    void authClient.signIn
      .email({ email, password })
      .then(async (res) => {
        if (res.error) {
          const deactivated = res.error.code === 'BANNED_USER' || res.error.status === 403;
          setError(
            deactivated
              ? 'This account has been deactivated. Ask the other owner to reactivate it.'
              : 'That email and password do not match.',
          );
          return;
        }
        // With two-factor on the account the client redirects to /two-factor itself. Without it,
        // the console has nothing for this person to do but set it up, and /me says so.
        await navigate({ to: '/' });
      })
      .finally(() => {
        setBusy(false);
      });
  };

  return (
    <AuthLayout
      title="Sign in"
      description="The console controls every customer's plan, so it asks for a second factor every time."
    >
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Input
          autoFocus
          name="email"
          type="email"
          label="Email"
          autoComplete="username"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
          }}
        />
        <PasswordInput
          name="password"
          label="Password"
          autoComplete="current-password"
          value={password}
          {...(error !== null ? { error } : {})}
          onChange={(e) => {
            setPassword(e.target.value);
          }}
        />
        <Button
          type="submit"
          variant="primary"
          loading={busy}
          disabled={email === '' || password === ''}
          className="w-full"
        >
          Continue
        </Button>
      </form>
    </AuthLayout>
  );
}
