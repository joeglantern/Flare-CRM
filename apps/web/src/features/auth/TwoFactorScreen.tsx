/**
 * Two-factor (Auth · Verify and Enrol). Two screens behind one route because the user
 * arrives at whichever one applies: verify a code, or enrol because their role now requires it.
 *
 * A backup code is longer than six digits, so the single field accepts either and decides which
 * endpoint to call. That is one field to explain instead of two.
 */
import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Button } from '@/components/ui/Button';
import { Input, PasswordInput } from '@/components/ui/Input';
import { Checkbox } from '@/components/ui/Toggle';
import { AuthLayout } from './AuthLayout';

export function TwoFactorVerifyScreen({
  onVerify,
  onSignOut,
}: {
  onVerify: (code: string, trustDevice: boolean) => Promise<{ ok: boolean; message?: string }>;
  onSignOut: () => void;
}) {
  const [code, setCode] = useState('');
  const [trustDevice, setTrustDevice] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const clean = code.replace(/\s/g, '');
  const isBackup = clean.length > 6;

  const submit = () => {
    setError(null);
    setBusy(true);
    void onVerify(clean, trustDevice)
      .then((r) => {
        if (!r.ok)
          setError(
            r.message ?? 'That code was not accepted. Check the clock on your phone and try again.',
          );
      })
      .finally(() => {
        setBusy(false);
      });
  };

  return (
    <AuthLayout
      title="Enter your code"
      description="Open your authenticator app and type the six digit code. A backup code works here too."
      footer={
        <button
          type="button"
          onClick={onSignOut}
          className="underline underline-offset-2 hover:text-fg"
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
          description={
            isBackup ? 'Each backup code works once.' : 'Six digits from your authenticator app.'
          }
          onChange={(e) => {
            setCode(e.target.value);
          }}
        />

        <Checkbox
          checked={trustDevice}
          onChange={setTrustDevice}
          label="Trust this device for 30 days"
          description="Only on a device that is yours alone."
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

export function TwoFactorEnrolScreen({
  onBegin,
  onConfirm,
  onSignOut,
}: {
  onBegin: (
    password: string,
  ) => Promise<{ ok: boolean; message?: string; totpURI?: string; backupCodes?: string[] }>;
  onConfirm: (code: string) => Promise<{ ok: boolean; message?: string }>;
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
  // Keyed by the URI it was drawn from, so a stale code is never shown against a new secret and
  // nothing has to be cleared when the URI changes.
  const [qr, setQr] = useState<{ uri: string; svg: string } | null>(null);

  // The otpauth URI is meant to be scanned, not read. Rendering it as text left people holding a
  // string with no idea what to do with it. The QR is drawn dark on white whatever the theme,
  // because a scanner needs that contrast and an inverted code does not read.
  useEffect(() => {
    if (uri === null) return;
    let cancelled = false;
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

  // Typed in by hand when a camera is not an option, so it is grouped in fours to be readable.
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
    void onBegin(password)
      .then((r) => {
        if (!r.ok) {
          setError(r.message ?? 'That password was not accepted.');
          return;
        }
        setUri(r.totpURI ?? null);
        setBackupCodes(r.backupCodes ?? []);
        setStage('scan');
      })
      .finally(() => {
        setBusy(false);
      });
  };

  const confirm = () => {
    setError(null);
    setBusy(true);
    void onConfirm(code.replace(/\s/g, ''))
      .then((r) => {
        if (!r.ok)
          setError(r.message ?? 'That code did not match. Try the next one your app shows.');
      })
      .finally(() => {
        setBusy(false);
      });
  };

  return (
    <AuthLayout
      wide
      title="Set up two-factor"
      description="Your role requires a second step at sign-in. It takes about a minute."
      footer={
        <button
          type="button"
          onClick={onSignOut}
          className="underline underline-offset-2 hover:text-fg"
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
                  Can&rsquo;t scan it?
                </summary>
                <p className="mt-2 text-sm text-muted">
                  In your app choose to enter a key by hand, then type this. It is time based, six
                  digits, thirty seconds.
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
                Each works once. Without them, losing your phone means losing access.
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
