/**
 * The second factor, in two shapes behind one route: verify a code during sign-in, or enrol because
 * this account has not done it yet. Every console account has to, so enrolment is not optional and
 * there is nothing else to do until it is finished.
 */
import { useNavigate } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Button, Checkbox, Input, PasswordInput } from '@crm/ui';
import { authClient } from '@/lib/auth';
import { qk } from '@/lib/query';
import { twoFactorRoute } from '@/app/router';
import { AuthLayout } from './AuthLayout';

export function TwoFactorRoute() {
  const { setup } = twoFactorRoute.useSearch();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const done = async () => {
    // Refetch rather than invalidate: nothing is watching `me` on this screen, and an invalidated
    // but unwatched query keeps its old value. The console would then read "two-factor not set up"
    // and send this owner straight back here, which is what it did before this line changed.
    await queryClient.refetchQueries({ queryKey: qk.me(), type: 'all' });
    await navigate({ to: '/' });
  };

  const signOutToStart = () => {
    void authClient.signOut().then(() => navigate({ to: '/sign-in' }));
  };

  return setup === true ? (
    <EnrolScreen onFinished={done} onSignOut={signOutToStart} />
  ) : (
    <VerifyScreen onFinished={done} onSignOut={signOutToStart} />
  );
}

function VerifyScreen({
  onFinished,
  onSignOut,
}: {
  onFinished: () => Promise<void>;
  onSignOut: () => void;
}) {
  const [code, setCode] = useState('');
  const [trustDevice, setTrustDevice] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const clean = code.replace(/\s/g, '');
  // A backup code is longer than six digits, which is how one field serves both.
  const isBackup = clean.length > 6;

  const submit = () => {
    setError(null);
    setBusy(true);
    void (
      isBackup
        ? authClient.twoFactor.verifyBackupCode({ code: clean })
        : authClient.twoFactor.verifyTotp({ code: clean, trustDevice })
    )
      .then(async (res) => {
        if (res.error) {
          setError(
            res.error.message ??
              'That code was not accepted. Check the clock on your phone and try again.',
          );
          return;
        }
        await onFinished();
      })
      .finally(() => {
        setBusy(false);
      });
  };

  return (
    <AuthLayout
      title="Enter your code"
      description="Six digits from your authenticator app. A backup code works here too."
      footer={
        <button
          type="button"
          onClick={onSignOut}
          className="underline underline-offset-2 hover:text-text"
        >
          Sign in as someone else
        </button>
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
          name="code"
          label={isBackup ? 'Backup code' : 'Authentication code'}
          mono
          inputMode={isBackup ? 'text' : 'numeric'}
          autoComplete="one-time-code"
          maxLength={24}
          value={code}
          {...(error !== null ? { error } : {})}
          onChange={(e) => {
            setCode(e.target.value);
          }}
        />
        <Checkbox
          checked={trustDevice}
          onChange={setTrustDevice}
          label="Trust this device for 30 days"
          description="Only on a machine that is yours alone."
        />
        <Button
          type="submit"
          variant="primary"
          loading={busy}
          disabled={clean.length < 6}
          className="w-full"
        >
          Verify
        </Button>
      </form>
    </AuthLayout>
  );
}

function EnrolScreen({
  onFinished,
  onSignOut,
}: {
  onFinished: () => Promise<void>;
  onSignOut: () => void;
}) {
  const [stage, setStage] = useState<'password' | 'scan'>('password');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [uri, setUri] = useState<string | null>(null);
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Keyed by the URI it was drawn from, so a stale image is never shown against a new secret.
  const [qr, setQr] = useState<{ uri: string; svg: string } | null>(null);

  useEffect(() => {
    if (uri === null) return;
    let cancelled = false;
    // Dark on white whatever the theme: a scanner needs that contrast, and an inverted code does
    // not read.
    void QRCode.toString(uri, {
      type: 'svg',
      margin: 1,
      errorCorrectionLevel: 'M',
      color: { dark: '#000000', light: '#ffffff' },
    }).then((svg) => {
      if (!cancelled) setQr({ uri, svg });
    });
    return () => {
      cancelled = true;
    };
  }, [uri]);

  const qrSvg = qr !== null && qr.uri === uri ? qr.svg : null;

  /** Shown grouped in fours for anyone typing it in by hand. */
  const secret = (() => {
    if (uri === null) return null;
    try {
      const value = new URL(uri).searchParams.get('secret');
      return value === null ? null : (value.match(/.{1,4}/g)?.join(' ') ?? value);
    } catch {
      return null;
    }
  })();

  const begin = () => {
    setError(null);
    setBusy(true);
    void authClient.twoFactor
      .enable({ password })
      .then((res) => {
        if (res.error) {
          setError(res.error.message ?? 'That password was not accepted.');
          return;
        }
        if (!('totpURI' in res.data)) {
          setError('This account is not set up for an authenticator app.');
          return;
        }
        setUri(res.data.totpURI);
        setBackupCodes(res.data.backupCodes);
        setStage('scan');
      })
      .finally(() => {
        setBusy(false);
      });
  };

  const confirm = () => {
    setError(null);
    setBusy(true);
    void authClient.twoFactor
      .verifyTotp({ code: code.replace(/\s/g, '') })
      .then(async (res) => {
        if (res.error) {
          setError(
            res.error.message ?? 'That code did not match. Try the next one your app shows.',
          );
          return;
        }
        await onFinished();
      })
      .finally(() => {
        setBusy(false);
      });
  };

  return (
    <AuthLayout
      wide
      title="Set up two-factor"
      description="Every console account needs one. It takes about a minute, and it is the only thing this account can do until it is done."
      footer={
        <button
          type="button"
          onClick={onSignOut}
          className="underline underline-offset-2 hover:text-text"
        >
          Sign out
        </button>
      }
    >
      {stage === 'password' ? (
        <form
          noValidate
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            begin();
          }}
        >
          <PasswordInput
            autoFocus
            name="password"
            label="Confirm your password"
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
            disabled={password === ''}
            className="w-full"
          >
            Continue
          </Button>
        </form>
      ) : (
        <form
          noValidate
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            confirm();
          }}
        >
          <div>
            <h2 className="text-base font-medium">1. Scan this with your authenticator app</h2>
            <p className="mt-1 text-sm text-muted">
              Google Authenticator, 1Password, Authy and Microsoft Authenticator all work.
            </p>
            {qrSvg !== null && (
              <div
                aria-label="Set-up QR code"
                className="mt-3 w-40 rounded-sm border border-border bg-white p-2 [&>svg]:block [&>svg]:h-full [&>svg]:w-full"
                dangerouslySetInnerHTML={{ __html: qrSvg }}
              />
            )}
            {secret !== null && (
              <details className="mt-3">
                <summary className="cursor-pointer text-sm text-muted underline underline-offset-2">
                  Cannot scan it?
                </summary>
                <p className="mt-2 text-sm text-muted">
                  In your app choose to enter a key by hand, then type this. Time based, six digits,
                  thirty seconds.
                </p>
                <code className="mono mt-2 block rounded-sm border border-border bg-surface p-2 text-xs break-all select-all">
                  {secret}
                </code>
              </details>
            )}
          </div>

          {backupCodes.length > 0 && (
            <div className="rounded-sm border border-border bg-surface p-3">
              <h2 className="text-base font-medium">2. Save your backup codes</h2>
              <p className="mt-1 text-sm text-muted">
                Each works once. There is no administrator above you here: without these, a lost
                phone means the other owner has to reset your account.
              </p>
              <ul className="mono mt-2 grid grid-cols-2 gap-1 text-sm">
                {backupCodes.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
              <Checkbox
                className="mt-3"
                checked={saved}
                onChange={setSaved}
                label="I have saved these somewhere safe"
              />
            </div>
          )}

          <Input
            name="code"
            label="3. Type the code your app shows"
            mono
            inputMode="numeric"
            maxLength={6}
            value={code}
            {...(error !== null ? { error } : {})}
            onChange={(e) => {
              setCode(e.target.value.replace(/\D/g, ''));
            }}
          />

          <Button
            type="submit"
            variant="primary"
            loading={busy}
            disabled={code.length < 6 || (backupCodes.length > 0 && !saved)}
            className="w-full"
          >
            Turn on two-factor
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
