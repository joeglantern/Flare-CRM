/**
 * Settings, Email: the mail server the CRM sends from. Admin only.
 *
 * Saving tries the server first and stores nothing it would not accept. The password is
 * write-only: it is never sent back, so on an existing setup a blank field keeps the one in use.
 * A save applies to the next email, with no restart.
 */
import {
  smtpConfigBody,
  type SmtpConfigBody,
  type SmtpSecurity,
  type SmtpStatusDto,
} from '@crm/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Mail, Pencil, RotateCcw, Send } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { toast } from '@/components/ui/toast';
import { DateTime } from '@/components/data/formatters';
import { Panel } from '@/components/entity/EntityHeader';
import { http } from '@/lib/api/client';
import { errorMessage, isApiError } from '@/lib/api/errors';

const KEY = ['integrations', 'smtp'] as const;
const PORT_FOR: Record<SmtpSecurity, number> = { tls: 465, starttls: 587, none: 25 };

interface Form {
  host: string;
  port: string;
  security: SmtpSecurity;
  username: string;
  password: string;
  from: string;
}

export function SmtpCard() {
  const qc = useQueryClient();
  const status = useQuery({
    queryKey: KEY,
    queryFn: () => http.get<SmtpStatusDto>('/api/v1/integrations/smtp'),
  });
  const [form, setForm] = useState<Form | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [resetOpen, setResetOpen] = useState(false);
  const s = status.data;

  const save = useMutation({
    mutationFn: (body: SmtpConfigBody) =>
      http.put<SmtpStatusDto>('/api/v1/integrations/smtp', body),
    onSuccess: (next) => {
      qc.setQueryData(KEY, next);
      setForm(null);
      setErrors({});
      toast({
        tone: 'success',
        title: 'Email settings saved',
        description: 'The mail server accepted them. Send a test email to be sure it arrives.',
      });
    },
    onError: (err) => {
      if (isApiError(err) && err.fieldIssues.length > 0) {
        setErrors(Object.fromEntries(err.fieldIssues.map((i) => [i.path, i.message])));
        return;
      }
      toast({ tone: 'danger', title: 'Not saved', description: errorMessage(err) });
    },
  });
  const test = useMutation({
    mutationFn: () => http.post<{ sentTo: string }>('/api/v1/integrations/smtp/test', {}),
    onSuccess: (r) => {
      toast({ tone: 'success', title: 'Test email sent', description: `Check ${r.sentTo}.` });
    },
    onError: (err) => {
      toast({ tone: 'danger', title: 'Test email not sent', description: errorMessage(err) });
    },
  });
  const reset = useMutation({
    mutationFn: () => http.del<SmtpStatusDto>('/api/v1/integrations/smtp'),
    onSuccess: (next) => {
      qc.setQueryData(KEY, next);
      setResetOpen(false);
      toast({ tone: 'success', title: 'Back on the server settings' });
    },
    onError: (err) => {
      setResetOpen(false);
      toast({ tone: 'danger', title: 'Not changed', description: errorMessage(err) });
    },
  });

  const submit = () => {
    if (form === null) return;
    const parsed = smtpConfigBody.safeParse({ ...form, port: Number(form.port) });
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [i.path.join('.'), i.message])));
      return;
    }
    setErrors({});
    save.mutate(parsed.data);
  };

  const field = (key: keyof Form) => ({
    name: key,
    value: form?.[key] ?? '',
    error: errors[key],
    onChange: (e: { target: { value: string } }) => {
      setForm((f) => (f === null ? f : { ...f, [key]: e.target.value }));
      setErrors(({ [key]: _fixed, ...rest }) => rest);
    },
  });

  return (
    <Panel
      title="Email server"
      note="how the CRM sends invitations, password links and notifications"
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {s === undefined ? (
            <span className="text-muted">Loading…</span>
          ) : (
            <>
              <Badge tone={s.source === 'admin' ? 'success' : 'neutral'}>
                {s.source === 'admin' ? 'Set here' : 'Set on the server'}
              </Badge>
              {s.host !== null && (
                <span className="mono text-muted">
                  {s.host}
                  {s.port !== null && `:${String(s.port)}`}
                </span>
              )}
              {s.from !== null && <span className="text-muted">from {s.from}</span>}
              {s.updatedAt !== null && (
                <span className="text-faint">
                  saved <DateTime value={s.updatedAt} mode="relative" />
                </span>
              )}
            </>
          )}
        </div>

        {form === null ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              icon={Pencil}
              disabled={s === undefined}
              onClick={() => {
                setErrors({});
                setForm({
                  host: s?.host ?? '',
                  port: String(s?.port ?? 587),
                  security: s?.security ?? 'starttls',
                  username: s?.username ?? '',
                  password: '',
                  from: s?.from ?? '',
                });
              }}
            >
              {s?.source === 'admin' ? 'Edit' : 'Use my own mail server'}
            </Button>
            <Button
              variant="ghost"
              icon={Send}
              loading={test.isPending}
              onClick={() => {
                test.mutate();
              }}
            >
              Send a test email
            </Button>
            {s?.source === 'admin' && (
              <Button
                variant="ghost"
                icon={RotateCcw}
                onClick={() => {
                  setResetOpen(true);
                }}
              >
                Go back to the server settings
              </Button>
            )}
          </div>
        ) : (
          <form
            className="flex flex-col gap-3"
            noValidate
            autoComplete="off"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <div className="grid gap-3 sm:grid-cols-[1fr_110px]">
              <Input label="Mail server" mono placeholder="smtp.example.com" {...field('host')} />
              <Input label="Port" mono inputMode="numeric" {...field('port')} />
            </div>
            <Select
              label="Encryption"
              value={form.security}
              onChange={(v) => {
                const security = v as SmtpSecurity;
                setForm((f) =>
                  f === null ? f : { ...f, security, port: String(PORT_FOR[security]) },
                );
              }}
              options={[
                { value: 'starttls', label: 'STARTTLS', description: 'Usually port 587' },
                { value: 'tls', label: 'SSL/TLS', description: 'Usually port 465' },
                {
                  value: 'none',
                  label: 'None',
                  description: 'Only for a relay on the same network',
                },
              ]}
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                label="Username"
                description="Leave blank if the server needs no login."
                {...field('username')}
              />
              <Input
                label="Password"
                type="password"
                autoComplete="new-password"
                placeholder={
                  s?.source === 'admin' && s.passwordSet ? 'Blank keeps the current one' : undefined
                }
                description="Stored encrypted. It is never shown again."
                {...field('password')}
              />
            </div>
            <Input
              label="Send as"
              placeholder="Rani Africa CRM <crm@example.com>"
              description="The name and address people see the emails come from."
              {...field('from')}
            />
            <div className="flex justify-end gap-2">
              <Button
                variant="ghost"
                disabled={save.isPending}
                onClick={() => {
                  setForm(null);
                  setErrors({});
                }}
              >
                Cancel
              </Button>
              <Button variant="primary" type="submit" icon={Mail} loading={save.isPending}>
                Check and save
              </Button>
            </div>
          </form>
        )}
      </div>
      <ConfirmDialog
        open={resetOpen}
        onOpenChange={setResetOpen}
        tone="primary"
        title="Go back to the server settings?"
        description="The mail server saved here is removed, and emails go out through the one set on the server."
        confirmLabel="Use the server settings"
        loading={reset.isPending}
        onConfirm={() => {
          reset.mutate();
        }}
      />
    </Panel>
  );
}
