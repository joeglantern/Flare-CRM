/**
 * Sign in (Auth · Sign in). Email and password, with the two-factor step handled by the
 * auth client redirecting to /two-factor.
 *
 * A failed sign-in never says which half was wrong, because that tells an attacker whether the
 * email exists. The one exception is a locked or deactivated account, where the user genuinely
 * cannot fix it themselves and needs to be told to ask an admin.
 */
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Input, PasswordInput } from '@/components/ui/Input';
import { Checkbox } from '@/components/ui/Toggle';
import { focusFirstError } from '@/lib/forms';
import { AuthLayout } from './AuthLayout';

export interface SignInResult {
  ok: boolean;
  message?: string;
}

export function SignInScreen({
  reason,
  onSubmit,
  onForgot,
}: {
  reason?: 'idle' | 'signed-out';
  onSubmit: (values: {
    email: string;
    password: string;
    rememberMe: boolean;
  }) => Promise<SignInResult>;
  onForgot: () => void;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = () => {
    const next: Record<string, string> = {};
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim()))
      next.email = 'Enter a valid email address.';
    if (password === '') next.password = 'Enter your password.';
    if (Object.keys(next).length > 0) {
      setErrors(next);
      focusFirstError(next);
      return;
    }
    setErrors({});
    setFormError(null);
    setBusy(true);
    void onSubmit({ email: email.trim(), password, rememberMe })
      .then((r) => {
        if (!r.ok) setFormError(r.message ?? 'That email and password do not match.');
      })
      .finally(() => {
        setBusy(false);
      });
  };

  return (
    <AuthLayout
      title="Sign in"
      description={
        reason === 'idle'
          ? 'You were signed out after a spell of inactivity. Sign in to pick up where you left off.'
          : reason === 'signed-out'
            ? 'You have been signed out.'
            : 'Welcome back.'
      }
      footer={
        <>
          Trouble signing in?{' '}
          <button
            type="button"
            onClick={onForgot}
            className="underline underline-offset-2 hover:text-fg"
          >
            Reset your password
          </button>
          .
        </>
      }
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
          label="Email"
          type="email"
          autoComplete="username"
          value={email}
          error={errors.email}
          onChange={(e) => {
            setEmail(e.target.value);
          }}
        />

        <PasswordInput
          name="password"
          label="Password"
          autoComplete="current-password"
          value={password}
          error={errors.password}
          onChange={(e) => {
            setPassword(e.target.value);
          }}
        />

        <Checkbox
          checked={rememberMe}
          onChange={setRememberMe}
          label="Keep me signed in"
          description="Only on a device you trust."
        />

        {formError !== null && (
          <p
            role="alert"
            className="rounded-sm bg-[var(--danger-subtle)] px-3 py-2 text-sm text-danger"
          >
            {formError}
          </p>
        )}

        <Button type="submit" variant="primary" loading={busy} className="w-full">
          Sign in
        </Button>
      </form>
    </AuthLayout>
  );
}
