/**
 * Setting a password: the screen an invited owner lands on, and the one for anyone who has
 * forgotten theirs.
 *
 * A console owner never receives a password from someone else. They are sent a link and choose their
 * own, then set up an authenticator before the console lets them do anything. Without these screens
 * the invitation on the Owners page would email a link to nowhere.
 *
 * The forgotten-password form reports success whichever address is typed: saying "no such account"
 * would let anyone test which addresses can reach this console.
 */
import { CircleCheck, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { Button, Input, PasswordInput } from '@crm/ui';
import { AuthLayout } from './AuthLayout';

/** The rule the server enforces, checked here so the message arrives before the request does. */
function passwordProblem(password: string): string | null {
  if (password.length < 12) return 'Use at least 12 characters.';
  if (!/[a-z]/.test(password)) return 'Include a lower case letter.';
  if (!/[A-Z]/.test(password)) return 'Include an upper case letter.';
  if (!/\d/.test(password)) return 'Include a number.';
  return null;
}

export function ForgotPasswordScreen({
  onSubmit,
  onBack,
}: {
  onSubmit: (email: string) => Promise<{ ok: boolean; message?: string }>;
  onBack: () => void;
}) {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const backToSignIn = (
    <button type="button" onClick={onBack} className="underline underline-offset-2 hover:text-text">
      Back to sign in
    </button>
  );

  if (sent) {
    return (
      <AuthLayout
        title="Check your email"
        description={
          <>
            If a console account uses <span className="font-medium text-text">{email}</span>, a link
            to set a new password is on its way. It expires in an hour.
          </>
        }
        footer={backToSignIn}
      >
        <p className="flex items-start gap-2 rounded-sm border border-border bg-surface px-3 py-2.5 text-base">
          <CircleCheck size={15} className="mt-0.5 shrink-0 text-success" aria-hidden />
          <span className="text-muted">
            Nothing arrived? Check the spam folder, then try again. We do not say whether an address
            has an account here.
          </span>
        </p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Reset your password"
      description="Type your email and we will send a link to set a new one."
      footer={backToSignIn}
    >
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) {
            setError('Enter a valid email address.');
            return;
          }
          setError(null);
          setBusy(true);
          void onSubmit(email.trim())
            .then((r) => {
              if (r.ok || r.message === undefined) setSent(true);
              else setError(r.message);
            })
            .finally(() => {
              setBusy(false);
            });
        }}
      >
        <Input
          autoFocus
          name="email"
          label="Email"
          type="email"
          autoComplete="username"
          value={email}
          {...(error !== null ? { error } : {})}
          onChange={(e) => {
            setEmail(e.target.value);
          }}
        />
        <Button type="submit" variant="primary" loading={busy} className="w-full">
          Send the link
        </Button>
      </form>
    </AuthLayout>
  );
}

export function SetPasswordScreen({
  mode,
  onSubmit,
  onBack,
}: {
  mode: 'reset' | 'set';
  onSubmit: (password: string) => Promise<{ ok: boolean; message?: string }>;
  onBack: () => void;
}) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const problem = password === '' ? null : passwordProblem(password);

  return (
    <AuthLayout
      title={mode === 'set' ? 'Set your password' : 'Choose a new password'}
      description={
        mode === 'set'
          ? 'Pick something you have not used anywhere else. An authenticator app comes next.'
          : 'Once this is saved you will be signed out everywhere else.'
      }
      footer={
        <button
          type="button"
          onClick={onBack}
          className="underline underline-offset-2 hover:text-text"
        >
          Back to sign in
        </button>
      }
    >
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          const next: Record<string, string> = {};
          const p = passwordProblem(password);
          if (p !== null) next.password = p;
          if (confirm !== password) next.confirm = 'The two passwords do not match.';
          if (Object.keys(next).length > 0) {
            setErrors(next);
            return;
          }
          setErrors({});
          setFormError(null);
          setBusy(true);
          void onSubmit(password)
            .then((r) => {
              if (!r.ok) {
                setFormError(r.message ?? 'That link is no longer valid. Ask for a new one.');
              }
            })
            .finally(() => {
              setBusy(false);
            });
        }}
      >
        <PasswordInput
          autoFocus
          name="password"
          label="New password"
          autoComplete="new-password"
          value={password}
          error={errors.password}
          description={problem ?? 'At least 12 characters, with upper and lower case and a number.'}
          onChange={(e) => {
            setPassword(e.target.value);
          }}
        />
        <PasswordInput
          name="confirm"
          label="Type it again"
          autoComplete="new-password"
          value={confirm}
          error={errors.confirm}
          onChange={(e) => {
            setConfirm(e.target.value);
          }}
        />
        {formError !== null && (
          <p role="alert" className="flex items-start gap-2 text-base text-danger">
            <TriangleAlert size={15} className="mt-0.5 shrink-0" aria-hidden />
            {formError}
          </p>
        )}
        <Button type="submit" variant="primary" loading={busy} className="w-full">
          {mode === 'set' ? 'Set password and continue' : 'Save new password'}
        </Button>
      </form>
    </AuthLayout>
  );
}

export function LinkExpiredScreen({ onRequestNew }: { onRequestNew: () => void }) {
  return (
    <AuthLayout
      title="That link has expired"
      description="Links last an hour and work once. Ask for another and use the newest email."
    >
      <Button variant="primary" className="w-full" onClick={onRequestNew}>
        Send me a new link
      </Button>
    </AuthLayout>
  );
}
