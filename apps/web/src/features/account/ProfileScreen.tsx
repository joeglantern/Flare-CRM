/**
 * Your account (Settings · Profile). Name, timezone, avatar, two-factor and appearance.
 *
 * Two-factor is the reason this screen exists in its own right: enrolling and disabling both need
 * the password, and disabling is the one action here that weakens the account, so it is confirmed
 * rather than toggled.
 * The theme is stored per browser, not on the server, and the screen says so.
 */
import { ShieldCheck, ShieldOff, Trash2, Upload } from 'lucide-react';
import { useState } from 'react';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Button, IconButton } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Input, PasswordInput } from '@/components/ui/Input';
import { Dialog } from '@/components/ui/Overlay';
import { Select } from '@/components/ui/Select';
import { Segmented } from '@/components/ui/Toggle';
import { toast } from '@/components/ui/toast';
import { DateTime } from '@/components/data/formatters';
import { DetailList, Panel } from '@/components/entity/EntityHeader';
import { PageHeader } from '@/app/shell/TopBar';
import { usePageMeta } from '@/app/shell/page-meta';
import { authClient } from '@/lib/auth/client';
import { useInvalidateMe, useMe } from '@/lib/auth/me';
import { errorMessage } from '@/lib/api/errors';
import { focusFirstError } from '@/lib/forms';
import { useTheme } from '@/lib/theme';
import { useUpdateMe } from '@/features/users/api';

const TIMEZONES = [
  'Africa/Nairobi',
  'Africa/Kampala',
  'Africa/Dar_es_Salaam',
  'Africa/Lagos',
  'Africa/Johannesburg',
  'Europe/London',
  'UTC',
];

export function ProfileScreen() {
  usePageMeta([{ label: 'Your account' }]);
  const me = useMe();
  const updateMe = useUpdateMe();
  const invalidateMe = useInvalidateMe();
  const [name, setName] = useState(me.name);
  const [phone, setPhone] = useState(me.phone ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [uploading, setUploading] = useState(false);
  const [enrolOpen, setEnrolOpen] = useState(false);
  const [disableOpen, setDisableOpen] = useState(false);

  const dirty = name !== me.name || phone !== (me.phone ?? '');

  const save = () => {
    if (name.trim() === '') {
      const next = { name: 'Your name cannot be empty.' };
      setErrors(next);
      focusFirstError(next);
      return;
    }
    setErrors({});
    updateMe.mutate(
      { name: name.trim(), phone: phone.trim() === '' ? null : phone.trim() },
      {
        onSuccess: () => {
          toast({ tone: 'success', title: 'Profile saved' });
          void invalidateMe();
        },
        onError: (e) => {
          toast({ tone: 'danger', title: 'Could not save', description: errorMessage(e) });
        },
      },
    );
  };

  const setTimezone = (tz: string) => {
    updateMe.mutate(
      { timezone: tz },
      {
        onSuccess: () => {
          toast({
            tone: 'success',
            title: 'Timezone saved',
            description: `Every date now shows in ${tz}.`,
          });
          void invalidateMe();
        },
        onError: (e) => {
          toast({
            tone: 'danger',
            title: 'Could not save the timezone',
            description: errorMessage(e),
          });
        },
      },
    );
  };

  const uploadAvatar = (file: File) => {
    setUploading(true);
    const form = new FormData();
    form.append('file', file);
    void fetch('/api/v1/users/me/avatar', { method: 'POST', body: form, credentials: 'include' })
      .then(async (res) => {
        if (!res.ok) throw new Error(`Upload failed (${String(res.status)})`);
        await invalidateMe();
        toast({ tone: 'success', title: 'Photo updated' });
      })
      .catch((e: unknown) => {
        toast({
          tone: 'danger',
          title: 'Could not upload the photo',
          description: errorMessage(e),
        });
      })
      .finally(() => {
        setUploading(false);
      });
  };

  const removeAvatar = () => {
    void fetch('/api/v1/users/me/avatar', { method: 'DELETE', credentials: 'include' })
      .then(async () => {
        await invalidateMe();
        toast({ tone: 'success', title: 'Photo removed' });
      })
      .catch((e: unknown) => {
        toast({
          tone: 'danger',
          title: 'Could not remove the photo',
          description: errorMessage(e),
        });
      });
  };

  return (
    <div className="flex flex-col gap-4 p-6">
      <PageHeader
        title="Your account"
        description="Your details, your sign-in security and how the app looks."
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-4">
          <Panel title="Profile">
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-4">
                <Avatar name={me.name} seed={me.id} src={me.avatarUrl} size={56} />
                <div className="flex flex-wrap items-center gap-2">
                  <label className="inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-sm border border-border bg-surface px-2.5 text-sm hover:border-border-strong hover:bg-hover">
                    <Upload size={13} aria-hidden />
                    {uploading ? 'Uploading…' : 'Change photo'}
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      className="sr-only"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f !== undefined) uploadAvatar(f);
                        e.target.value = '';
                      }}
                    />
                  </label>
                  {me.avatarUrl !== null && (
                    <IconButton
                      icon={Trash2}
                      label="Remove photo"
                      size={28}
                      variant="ghost"
                      onClick={removeAvatar}
                    />
                  )}
                </div>
              </div>

              <Input
                name="name"
                label="Name"
                value={name}
                error={errors.name}
                onChange={(e) => {
                  setName(e.target.value);
                }}
              />

              <Input
                name="phone"
                label="Mobile"
                mono
                value={phone}
                error={errors.phone}
                description="Used for account recovery. It is not your PBX extension."
                onChange={(e) => {
                  setPhone(e.target.value);
                }}
              />

              <div>
                <Button
                  variant="primary"
                  disabled={!dirty}
                  loading={updateMe.isPending}
                  onClick={save}
                >
                  Save changes
                </Button>
              </div>
            </div>
          </Panel>

          <Panel
            title="Two-factor authentication"
            note="Protects your account even if your password leaks."
          >
            <div className="flex flex-wrap items-center gap-3">
              <Badge tone={me.twoFactorEnabled ? 'success' : 'warning'}>
                {me.twoFactorEnabled ? 'On' : 'Off'}
              </Badge>
              <span className="min-w-0 flex-1 text-base text-muted">
                {me.twoFactorEnabled
                  ? 'You are asked for a code from your authenticator app at every sign-in.'
                  : 'Turn this on to be asked for a code from an authenticator app at sign-in.'}
              </span>
              {me.twoFactorEnabled ? (
                <Button
                  variant="secondary"
                  icon={ShieldOff}
                  onClick={() => {
                    setDisableOpen(true);
                  }}
                >
                  Turn off
                </Button>
              ) : (
                <Button
                  variant="primary"
                  icon={ShieldCheck}
                  onClick={() => {
                    setEnrolOpen(true);
                  }}
                >
                  Turn on
                </Button>
              )}
            </div>
          </Panel>

          <AppearancePanel />
        </div>

        <aside className="flex min-w-0 flex-col gap-4">
          <Panel title="Account">
            <DetailList
              items={[
                { label: 'Email', value: <span className="break-all">{me.email}</span> },
                { label: 'Role', value: <Badge tone="neutral">{me.role}</Badge> },
                {
                  label: 'Extension',
                  value:
                    me.extension === null ? (
                      <span className="text-faint">None. Ask an admin to set one.</span>
                    ) : (
                      <span className="mono">{me.extension}</span>
                    ),
                },
                { label: 'Team', value: me.team?.name ?? <span className="text-faint">None</span> },
                { label: 'Joined', value: <DateTime value={me.createdAt} showTime={false} /> },
              ]}
            />
          </Panel>

          <Panel title="Timezone" note="Every date and time in the CRM is shown in this zone.">
            <Select
              value={me.timezone}
              onChange={setTimezone}
              label="Your timezone"
              searchable
              options={TIMEZONES.map((tz) => ({ value: tz, label: tz.replace('_', ' ') }))}
            />
          </Panel>
        </aside>
      </div>

      <TwoFactorEnrolDialog
        open={enrolOpen}
        onOpenChange={setEnrolOpen}
        onDone={() => {
          void invalidateMe();
        }}
      />

      <TwoFactorDisableDialog
        open={disableOpen}
        onOpenChange={setDisableOpen}
        onDone={() => {
          void invalidateMe();
        }}
      />
    </div>
  );
}

function AppearancePanel() {
  const preference = useTheme((s) => s.preference);
  const resolved = useTheme((s) => s.resolved);
  const setPreference = useTheme((s) => s.setPreference);
  return (
    <Panel title="Appearance" note="Stored in this browser only, so each device can differ.">
      <div className="flex flex-col gap-3">
        <Segmented
          value={preference}
          onChange={(v) => {
            setPreference(v);
          }}
          ariaLabel="Theme"
          options={[
            { value: 'dark', label: 'Dark' },
            { value: 'light', label: 'Light' },
            { value: 'system', label: 'System' },
          ]}
        />
        <p className="text-sm text-muted">
          {preference === 'system'
            ? `Following your device, which is currently ${resolved}.`
            : preference === 'dark'
              ? 'True black, for a call floor with the lights down.'
              : 'Paper white, for a bright room.'}
        </p>
      </div>
    </Panel>
  );
}

/* ── two factor ─────────────────────────────────────────────────────────────────────────── */

function TwoFactorEnrolDialog({
  open,
  onOpenChange,
  onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onDone: () => void;
}) {
  const [stage, setStage] = useState<'password' | 'verify'>('password');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [uri, setUri] = useState<string | null>(null);
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const begin = () => {
    setBusy(true);
    setError(null);
    void authClient.twoFactor
      .enable({ password })
      .then((res) => {
        if (res.error) {
          setError(res.error.message ?? 'That password was not accepted.');
          return;
        }
        if (!('totpURI' in res.data)) {
          setError('This account is set up for email codes, which are configured by an admin.');
          return;
        }
        setUri(res.data.totpURI);
        setBackupCodes(res.data.backupCodes);
        setStage('verify');
      })
      .catch((e: unknown) => {
        setError(errorMessage(e));
      })
      .finally(() => {
        setBusy(false);
      });
  };

  const verify = () => {
    setBusy(true);
    setError(null);
    void authClient.twoFactor
      .verifyTotp({ code })
      .then((res) => {
        if (res.error) {
          setError(res.error.message ?? 'That code did not match. Check your app and try again.');
          return;
        }
        toast({ tone: 'success', title: 'Two-factor is on' });
        onDone();
        onOpenChange(false);
        setStage('password');
        setPassword('');
        setCode('');
      })
      .catch((e: unknown) => {
        setError(errorMessage(e));
      })
      .finally(() => {
        setBusy(false);
      });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Turn on two-factor"
      width={460}
      dismissable={!busy}
      footer={
        <>
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => {
              onOpenChange(false);
            }}
          >
            Cancel
          </Button>
          {stage === 'password' ? (
            <Button variant="primary" loading={busy} disabled={password === ''} onClick={begin}>
              Continue
            </Button>
          ) : (
            <Button variant="primary" loading={busy} disabled={code.length < 6} onClick={verify}>
              Turn on
            </Button>
          )}
        </>
      }
    >
      {stage === 'password' ? (
        <div className="flex flex-col gap-3">
          <p className="text-base text-muted">Confirm your password to start.</p>
          <PasswordInput
            autoFocus
            label="Password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
            }}
            {...(error !== null ? { error } : {})}
          />
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-base text-muted">
            Add this to your authenticator app, then type the six digit code it shows.
          </p>
          {uri !== null && (
            <code className="mono block break-all rounded-sm border border-border bg-bg p-2 text-xs">
              {uri}
            </code>
          )}
          <Input
            autoFocus
            label="Code"
            mono
            inputMode="numeric"
            maxLength={6}
            value={code}
            onChange={(e) => {
              setCode(e.target.value.replace(/\D/g, ''));
            }}
            {...(error !== null ? { error } : {})}
          />
          {backupCodes.length > 0 && (
            <div className="rounded-sm border border-border bg-surface p-3">
              <h4 className="mb-1.5 text-sm font-medium">Backup codes</h4>
              <p className="mb-2 text-sm text-muted">
                Save these now. Each works once, and they are the only way in if you lose your
                phone.
              </p>
              <ul className="mono grid grid-cols-2 gap-1 text-sm">
                {backupCodes.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Dialog>
  );
}

function TwoFactorDisableDialog({
  open,
  onOpenChange,
  onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onDone: () => void;
}) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Turn off two-factor?"
      description={
        <span className="flex flex-col gap-3">
          <span>Your account will be protected by the password alone.</span>
          <PasswordInput
            autoFocus
            label="Confirm your password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
            }}
            {...(error !== null ? { error } : {})}
          />
        </span>
      }
      confirmLabel="Turn off two-factor"
      tone="danger"
      consequences={[
        'Anyone with your password can sign in',
        'Your admin may require it again, and you will be asked to set it up on your next sign-in',
      ]}
      loading={busy}
      onConfirm={() => {
        setBusy(true);
        setError(null);
        void authClient.twoFactor
          .disable({ password })
          .then((res) => {
            if (res.error) {
              setError(res.error.message ?? 'That password was not accepted.');
              return;
            }
            toast({ tone: 'success', title: 'Two-factor is off' });
            onDone();
            onOpenChange(false);
            setPassword('');
          })
          .catch((e: unknown) => {
            setError(errorMessage(e));
          })
          .finally(() => {
            setBusy(false);
          });
      }}
    />
  );
}
