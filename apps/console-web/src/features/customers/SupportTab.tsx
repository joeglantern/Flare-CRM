/**
 * Unlocking somebody who is stuck inside a customer's own CRM.
 *
 * This is the one screen in the console that reaches into a system we do not own, so it is built to
 * be hard to use by accident and impossible to use quietly. Nothing here reads that customer's
 * business data: the list carries only who can sign in, and the other two actions unlock a person.
 * Every one of them writes a row in the customer's own audit log naming us, which the screen says
 * out loud rather than leaving in a document nobody reads.
 *
 * Listing is a deliberate click rather than something that happens when the tab is opened, because
 * the list itself is a command sent to their stack and is audited there too.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, LogOut, ShieldCheck, ShieldOff, Users } from 'lucide-react';
import { useState } from 'react';
import type { SupportUser } from '@crm/shared';
import { Badge, Banner, Button, toast } from '@crm/ui';
import { Table, type Column } from '@/components/Bits';
import { EmptyState, Section, StateSlot } from '@/components/Page';
import { http } from '@/lib/api';
import { errorMessage, isApiError } from '@/lib/errors';
import { ago } from '@/lib/format';
import { qk } from '@/lib/query';
import type { SupportListing, SupportOutcome } from '@/lib/types';
import { SupportActionDialog } from './SupportActionDialog';

/** Shown wherever an action is offered but cannot be taken, so the reason is never a mystery. */
const OFFLINE = 'Their stack is not connected, and these commands are not queued.';

/** The two actions that change something. Listing is not one of them. */
type SupportAction = 'reset-two-factor' | 'revoke-sessions';

interface ActionCopy {
  title: (user: SupportUser, customerName: string) => string;
  description: (user: SupportUser, customerName: string) => string;
  consequences: (user: SupportUser) => string[];
  confirmLabel: string;
  success: (user: SupportUser) => string;
  failure: string;
}

const ACTIONS: Record<SupportAction, ActionCopy> = {
  'reset-two-factor': {
    title: (user) => `Reset two-factor for ${user.name}?`,
    description: (user, customerName) =>
      `${user.name} (${user.email}) at ${customerName} will be asked to set up an authenticator again the next time they sign in. Only do this once you are certain you are talking to them and not to somebody claiming to be them.`,
    consequences: (user) => [
      'Their current authenticator and backup codes stop working',
      'They are signed out of every device immediately',
      `Anyone who already has ${user.name}'s password can enrol a new authenticator afterwards`,
      "It is recorded in that customer's own audit log, naming us and quoting your reason",
    ],
    confirmLabel: 'Reset their two-factor',
    success: (user) => `${user.name} can enrol again at their next sign-in`,
    failure: 'Could not reset that person’s two-factor',
  },
  'revoke-sessions': {
    title: (user) => `Sign ${user.name} out everywhere?`,
    description: (user, customerName) =>
      `Every browser and device ${user.name} (${user.email}) at ${customerName} is signed in on is signed out now. They can sign straight back in with the password and authenticator they already have.`,
    consequences: () => [
      'Every session on every device ends immediately, including work in progress',
      'Nothing else changes: their password, authenticator and access are untouched',
      "It is recorded in that customer's own audit log, naming us and quoting your reason",
    ],
    confirmLabel: 'Sign them out',
    success: (user) => `${user.name} was signed out everywhere`,
    failure: 'Could not end those sessions',
  },
};

export function SupportTab({
  customerId,
  customerName,
  connected,
}: {
  customerId: string;
  customerName: string;
  connected: boolean;
}) {
  const queryClient = useQueryClient();
  const [asked, setAsked] = useState(false);
  const [pending, setPending] = useState<{ user: SupportUser; action: SupportAction } | null>(null);

  const users = useQuery({
    queryKey: qk.supportUsers(customerId),
    // A POST because it is a command sent to their stack, not a page of ours to read.
    queryFn: () => http.post<SupportListing>(`/api/v1/customers/${customerId}/support/list-users`),
    enabled: asked && connected,
    staleTime: 60_000,
  });

  const act = useMutation({
    mutationFn: ({
      user,
      action,
      reason,
    }: {
      user: SupportUser;
      action: SupportAction;
      reason: string;
    }) =>
      http.post<SupportOutcome>(`/api/v1/customers/${customerId}/support/${action}`, {
        email: user.email,
        reason,
      }),
    onSuccess: async (result, variables) => {
      await queryClient.invalidateQueries({ queryKey: qk.supportUsers(customerId) });
      toast({
        tone: 'success',
        title: ACTIONS[variables.action].success(variables.user),
        description: result.message,
      });
    },
    onError: (error: Error, variables) => {
      // A 409 here is their stack refusing in its own words, which is the useful part. Replacing it
      // with "Could not reset that person's two-factor" would throw away the only sentence that
      // explains why, so on a refusal the stack's own words are the headline.
      const refused = isApiError(error) && error.isConflict;
      toast({
        tone: 'danger',
        title: refused ? errorMessage(error) : ACTIONS[variables.action].failure,
        description: refused ? 'Their stack refused it. Nothing was changed.' : error.message,
        duration: 0,
      });
    },
  });

  const rows = users.data?.users ?? [];
  const copy = pending === null ? null : ACTIONS[pending.action];

  const columns: Column<SupportUser>[] = [
    {
      key: 'person',
      header: 'Person',
      cell: (user) => (
        <span className="flex flex-col">
          <span className="font-medium">{user.name}</span>
          <span className="mono text-sm text-muted">{user.email}</span>
        </span>
      ),
    },
    { key: 'role', header: 'Role', cell: (user) => <span className="text-base">{user.role}</span> },
    {
      key: 'twoFactor',
      header: 'Two-factor',
      cell: (user) =>
        user.twoFactorEnabled ? (
          <Badge tone="success" icon={ShieldCheck}>
            On
          </Badge>
        ) : (
          <span className="text-base text-muted">Off</span>
        ),
    },
    {
      key: 'active',
      header: 'Status',
      cell: (user) =>
        user.isActive ? (
          <span className="text-base">Active</span>
        ) : (
          <Badge tone="neutral">Deactivated</Badge>
        ),
    },
    {
      key: 'seen',
      header: 'Last seen',
      cell: (user) => <span className="text-sm text-muted">{ago(user.lastSeenAt)}</span>,
    },
    {
      key: 'actions',
      header: '',
      align: 'end',
      cell: (user) => (
        <span className="flex justify-end gap-2">
          <Button
            size="sm"
            icon={KeyRound}
            disabled={!user.twoFactorEnabled || !connected}
            title={
              !connected
                ? OFFLINE
                : user.twoFactorEnabled
                  ? undefined
                  : 'They have not set up an authenticator to reset'
            }
            onClick={() => {
              setPending({ user, action: 'reset-two-factor' });
            }}
          >
            Reset two-factor
          </Button>
          <Button
            size="sm"
            variant="danger"
            icon={LogOut}
            disabled={!connected}
            title={connected ? undefined : OFFLINE}
            onClick={() => {
              setPending({ user, action: 'revoke-sessions' });
            }}
          >
            Sign out
          </Button>
        </span>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-5">
      <Banner tone="warning" icon={ShieldOff}>
        This reaches into {customerName}&rsquo;s own system. Listing their people, resetting an
        authenticator and ending a session each write a row in {customerName}&rsquo;s own audit log
        that names us, says what we did, and quotes the reason you give for it. They can see all of
        it. Nothing here reads any of their business data.
      </Banner>

      {!connected && (
        <Banner tone="danger" icon={ShieldOff}>
          None of {customerName}&rsquo;s stacks are connected, so there is nothing to ask. These
          commands are not queued: whoever is locked out stays locked out until their stack is back.
        </Banner>
      )}

      <Section
        title="Their people"
        description="Who can sign in to that CRM. This list comes from their stack when you ask for it, and is not stored here."
        actions={
          <Button
            icon={Users}
            variant={asked ? 'secondary' : 'primary'}
            disabled={!connected}
            title={connected ? undefined : OFFLINE}
            loading={users.isFetching}
            onClick={() => {
              if (asked) void users.refetch();
              else setAsked(true);
            }}
          >
            {asked ? 'Ask again' : 'Ask their stack'}
          </Button>
        }
      >
        {!asked ? (
          <EmptyState
            icon={Users}
            title="Nothing has been asked yet"
            description="Asking sends one command to their stack and writes one row in their audit log."
          />
        ) : (
          <StateSlot
            isPending={users.isPending}
            error={users.error}
            isEmpty={rows.length === 0}
            empty={
              <EmptyState
                icon={Users}
                title="Their stack listed nobody"
                description="That usually means the CRM has no users yet rather than that something is wrong."
              />
            }
            onRetry={() => {
              void users.refetch();
            }}
          >
            <div className="-mx-4 -mb-4 border-t border-border">
              <Table
                caption={`People who can sign in to ${customerName}`}
                columns={columns}
                rows={rows}
                rowKey={(user) => user.id}
              />
            </div>
          </StateSlot>
        )}
      </Section>

      <SupportActionDialog
        open={pending !== null}
        onOpenChange={(v) => {
          if (!v) setPending(null);
        }}
        title={pending === null || copy === null ? '' : copy.title(pending.user, customerName)}
        description={
          pending === null || copy === null ? '' : copy.description(pending.user, customerName)
        }
        consequences={pending === null || copy === null ? [] : copy.consequences(pending.user)}
        // Their email rather than a word like DELETE: typing it is a last check that this is the
        // person on the phone, on a screen where the wrong row is somebody else's account.
        typedConfirmation={pending?.user.email ?? ''}
        confirmLabel={copy?.confirmLabel ?? 'Confirm'}
        loading={act.isPending}
        onConfirm={(reason) => {
          if (pending !== null) act.mutate({ ...pending, reason });
          setPending(null);
        }}
      />
    </div>
  );
}
