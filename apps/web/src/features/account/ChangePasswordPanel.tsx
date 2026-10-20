/**
 * Your account: change your own password.
 *
 * Asks for the current one, so a session left open on a shared desk cannot be used to lock its
 * owner out, and signs every other device out once the new one is set. The rules are the server's
 * (12 to 128 characters); this form only says them first.
 */
import { KeyRound } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { PasswordInput } from '@/components/ui/Input';
import { toast } from '@/components/ui/toast';
import { Panel } from '@/components/entity/EntityHeader';
import { authClient } from '@/lib/auth/client';

const MIN = 12;
const MAX = 128;

export function ChangePasswordPanel() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);

  const submit = async () => {
    const found: Record<string, string> = {};
    if (current === '') found.current = 'Enter your current password';
    if (next.length < MIN) found.next = `At least ${String(MIN)} characters`;
    else if (next.length > MAX) found.next = `At most ${String(MAX)} characters`;
    else if (next === current) found.next = 'Choose a password you are not using now';
    if (repeat !== next) found.repeat = 'Does not match the new password';
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    setPending(true);
    const res = await authClient.changePassword({
      currentPassword: current,
      newPassword: next,
      revokeOtherSessions: true,
    });
    setPending(false);
    if (res.error) {
      const wrong = /invalid|incorrect/i.test(res.error.message ?? '');
      if (wrong) setErrors({ current: 'That is not your current password' });
      else
        toast({
          tone: 'danger',
          title: 'Password not changed',
          description: res.error.message ?? 'Try again in a moment.',
        });
      return;
    }
    setCurrent('');
    setNext('');
    setRepeat('');
    toast({
      tone: 'success',
      title: 'Password changed',
      description: 'Every other device you were signed in on has been signed out.',
    });
  };

  return (
    <Panel title="Password" note="Use one you do not use anywhere else.">
      <form
        className="flex flex-col gap-3"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <PasswordInput
          label="Current password"
          autoComplete="current-password"
          value={current}
          error={errors.current}
          onChange={(e) => {
            setCurrent(e.target.value);
          }}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <PasswordInput
            label="New password"
            autoComplete="new-password"
            description={`${String(MIN)} characters or more.`}
            value={next}
            error={errors.next}
            onChange={(e) => {
              setNext(e.target.value);
            }}
          />
          <PasswordInput
            label="New password again"
            autoComplete="new-password"
            value={repeat}
            error={errors.repeat}
            onChange={(e) => {
              setRepeat(e.target.value);
            }}
          />
        </div>
        <div>
          <Button variant="primary" type="submit" icon={KeyRound} loading={pending}>
            Change password
          </Button>
        </div>
      </form>
    </Panel>
  );
}
