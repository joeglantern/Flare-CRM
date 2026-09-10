/**
 * The people who can use this console. Everyone here can do everything here, which is why there are
 * meant to be two of them and why adding one is a deliberate act with an audit row behind it.
 *
 * An owner is invited, never given a password by someone else: they receive a link and choose their
 * own, then have to set up an authenticator before the console will let them do anything.
 *
 * The four row actions exist because two owners with one authenticator between them is a real way to
 * lose the console entirely. Each one says what it costs before it happens: the enrolment screen
 * tells a locked-out owner that the other one can reset this for them, so it has to be true here.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  KeyRound,
  LogOut,
  Mail,
  MoreHorizontal,
  ShieldCheck,
  ShieldAlert,
  UserCheck,
  UserPlus,
  UserX,
} from 'lucide-react';
import { useRef, useState } from 'react';
import {
  Badge,
  Button,
  ConfirmDialog,
  Dialog,
  DropdownMenu,
  IconButton,
  Input,
  toast,
  type MenuItemDef,
} from '@crm/ui';
import { Table, type Column } from '@/components/Bits';
import { PageHeader, StateSlot } from '@/components/Page';
import { http } from '@/lib/api';
import { ago } from '@/lib/format';
import { meQuery } from '@/lib/auth';
import { qk } from '@/lib/query';
import type { Owner } from '@/lib/types';

/** The path segment each action posts to, which is also how the dialogs are keyed. */
type OwnerAction =
  'deactivate' | 'reactivate' | 'two-factor/reset' | 'revoke-sessions' | 'password-reset';

interface Confirmation {
  title: (owner: Owner) => string;
  description: (owner: Owner) => string;
  consequences: string[];
  confirmLabel: string;
  tone: 'danger' | 'primary';
  success: (owner: Owner) => { title: string; description?: string };
  failure: string;
}

const CONFIRMATIONS: Record<OwnerAction, Confirmation> = {
  deactivate: {
    title: (owner) => `Deactivate ${owner.name}?`,
    description: (owner) =>
      `${owner.name} is signed out everywhere and cannot sign in again until another owner reactivates them. Nothing they did is removed.`,
    consequences: [
      'Their sessions stop working immediately',
      'The emailed sign-in link and their password stop working',
      'Their audit rows stay exactly as they are',
    ],
    confirmLabel: 'Deactivate',
    tone: 'danger',
    success: () => ({ title: 'That account can no longer sign in' }),
    failure: 'Could not deactivate that owner',
  },
  reactivate: {
    title: (owner) => `Let ${owner.name} back in?`,
    description: (owner) =>
      `${owner.name} can sign in again with the password and authenticator they already had. If they no longer have that authenticator, reset their two-factor as well.`,
    consequences: [
      'They regain every permission in this console, on every customer',
      'They still need their authenticator; reactivating does not replace it',
    ],
    confirmLabel: 'Reactivate',
    tone: 'primary',
    success: (owner) => ({ title: `${owner.name} can sign in again` }),
    failure: 'Could not reactivate that owner',
  },
  'two-factor/reset': {
    title: () => 'Reset two-factor for this owner?',
    description: (owner) =>
      `${owner.name} will be asked to set up an authenticator again the next time they sign in.`,
    consequences: [
      'Their current authenticator and backup codes stop working',
      'They are signed out everywhere immediately',
      'Anyone holding their password can enrol a new authenticator, so only do this when you are sure who you are talking to',
    ],
    confirmLabel: 'Reset two-factor',
    tone: 'danger',
    success: (owner) => ({
      title: 'Two-factor reset',
      description: `${owner.name} can enrol again at their next sign-in.`,
    }),
    failure: 'Could not reset two-factor',
  },
  'password-reset': {
    title: (owner) => `Send ${owner.name} a password link?`,
    description: (owner) =>
      `${owner.name} gets an email with a link to choose a new password. Nobody here, including you, ever sees or sets it.`,
    consequences: [
      'The link works once and expires in fifteen minutes',
      'Using it signs them out everywhere, including any session they still have open',
      'Their authenticator is untouched: they will still be asked for a code afterwards',
    ],
    confirmLabel: 'Send the link',
    tone: 'primary',
    success: (owner) => ({
      title: 'Link sent',
      description: `${owner.name} has fifteen minutes to use it.`,
    }),
    failure: 'Could not send that link',
  },
  'revoke-sessions': {
    title: (owner) => `Sign ${owner.name} out everywhere?`,
    description: (owner) =>
      `Every browser ${owner.name} is signed in on is signed out now. They can sign back in straight away with the password and authenticator they already have.`,
    consequences: [
      'Every session on every device ends immediately',
      'Nothing else changes: their password, authenticator and access are untouched',
    ],
    confirmLabel: 'Sign them out',
    tone: 'danger',
    success: (owner) => ({ title: `${owner.name} was signed out everywhere` }),
    failure: 'Could not end those sessions',
  },
};

export function OwnersScreen() {
  const queryClient = useQueryClient();
  const [inviting, setInviting] = useState(false);
  const [pending, setPending] = useState<{ owner: Owner; action: OwnerAction } | null>(null);

  const me = useQuery(meQuery);
  const owners = useQuery({
    queryKey: qk.owners(),
    queryFn: async () => (await http.list<Owner>('/api/v1/owners')).data,
  });

  const run = useMutation({
    mutationFn: ({ owner, action }: { owner: Owner; action: OwnerAction }) =>
      http.post(`/api/v1/owners/${owner.id}/${action}`),
    onSuccess: async (_data, variables) => {
      await queryClient.invalidateQueries({ queryKey: qk.owners() });
      toast({ tone: 'success', ...CONFIRMATIONS[variables.action].success(variables.owner) });
    },
    onError: (error: Error, variables) => {
      toast({
        tone: 'danger',
        title: CONFIRMATIONS[variables.action].failure,
        description: error.message,
      });
    },
  });

  const columns: Column<Owner>[] = [
    {
      key: 'name',
      header: 'Owner',
      cell: (owner) => (
        <span className="flex flex-col">
          <span className="font-medium">
            {owner.name}
            {owner.id === me.data?.id && <span className="ml-2 text-sm text-muted">you</span>}
          </span>
          <span className="text-sm text-muted">{owner.email}</span>
        </span>
      ),
    },
    {
      key: 'twoFactor',
      header: 'Two-factor',
      cell: (owner) =>
        owner.twoFactorEnabled ? (
          <Badge tone="success" icon={ShieldCheck}>
            On
          </Badge>
        ) : (
          <Badge tone="warning" icon={ShieldAlert}>
            Not set up
          </Badge>
        ),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (owner) =>
        owner.isActive ? (
          <span className="text-base">Active</span>
        ) : (
          <Badge tone="neutral">Deactivated</Badge>
        ),
    },
    {
      key: 'seen',
      header: 'Last seen',
      cell: (owner) => <span className="text-sm text-muted">{ago(owner.lastSeenAt)}</span>,
    },
    {
      key: 'actions',
      header: '',
      align: 'end',
      cell: (owner) => (
        <RowActions
          owner={owner}
          isMe={owner.id === me.data?.id}
          onPick={(action) => {
            setPending({ owner, action });
          }}
        />
      ),
    },
  ];

  const confirmation = pending === null ? null : CONFIRMATIONS[pending.action];

  return (
    <>
      <PageHeader
        title="Owners"
        description="Everyone here can change every customer's plan. Keep the list short."
        actions={
          <Button
            variant="primary"
            icon={UserPlus}
            onClick={() => {
              setInviting(true);
            }}
          >
            Invite owner
          </Button>
        }
      />

      <StateSlot
        isPending={owners.isPending}
        error={owners.error}
        onRetry={() => {
          void owners.refetch();
        }}
      >
        <div className="rounded-md border border-border bg-surface">
          <Table
            caption="Console owners"
            columns={columns}
            rows={owners.data ?? []}
            rowKey={(o) => o.id}
          />
        </div>
      </StateSlot>

      <InviteDialog open={inviting} onOpenChange={setInviting} />

      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(v) => {
          if (!v) setPending(null);
        }}
        title={pending === null || confirmation === null ? '' : confirmation.title(pending.owner)}
        description={
          pending === null || confirmation === null ? '' : confirmation.description(pending.owner)
        }
        consequences={confirmation?.consequences ?? []}
        confirmLabel={confirmation?.confirmLabel ?? 'Confirm'}
        tone={confirmation?.tone ?? 'danger'}
        loading={run.isPending}
        onConfirm={() => {
          if (pending !== null) run.mutate(pending);
          setPending(null);
        }}
      />
    </>
  );
}

/**
 * One menu rather than four buttons: the row is already four columns wide, and the actions here are
 * rare enough that hiding them behind a deliberate click is the right amount of friction.
 */
function RowActions({
  owner,
  isMe,
  onPick,
}: {
  owner: Owner;
  isMe: boolean;
  onPick: (action: OwnerAction) => void;
}) {
  const anchor = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);

  const items: MenuItemDef[] = [
    {
      id: 'revoke-sessions',
      label: 'Sign out everywhere',
      icon: LogOut,
      danger: true,
      onSelect: () => {
        onPick('revoke-sessions');
      },
    },
    {
      id: 'password-reset',
      label: 'Send a password link',
      icon: Mail,
      // A deactivated account can hold a link and still not get in, which reads as the link failing.
      disabled: !owner.isActive,
      title: owner.isActive
        ? undefined
        : 'Reactivate them first, or the link will not sign them in',
      onSelect: () => {
        onPick('password-reset');
      },
    },
    {
      id: 'two-factor',
      label: 'Reset two-factor',
      icon: KeyRound,
      danger: true,
      // Resetting an enrolment nobody has made yet does nothing, and reads as though it might.
      disabled: !owner.twoFactorEnabled,
      title: owner.twoFactorEnabled ? undefined : 'They have not set up an authenticator yet',
      onSelect: () => {
        onPick('two-factor/reset');
      },
    },
    owner.isActive
      ? {
          id: 'deactivate',
          label: 'Deactivate',
          icon: UserX,
          danger: true,
          disabled: isMe,
          title: isMe ? 'You cannot deactivate your own account' : undefined,
          onSelect: () => {
            onPick('deactivate');
          },
        }
      : {
          id: 'reactivate',
          label: 'Reactivate',
          icon: UserCheck,
          onSelect: () => {
            onPick('reactivate');
          },
        },
  ];

  return (
    <span className="flex justify-end">
      <IconButton
        ref={anchor}
        icon={MoreHorizontal}
        label={`Actions for ${owner.name}`}
        variant="ghost"
        onClick={() => {
          setOpen(true);
        }}
      />
      <DropdownMenu
        open={open}
        onOpenChange={setOpen}
        anchor={anchor}
        items={items}
        ariaLabel={`Actions for ${owner.name}`}
      />
    </span>
  );
}

function InviteDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);

  const invite = useMutation({
    mutationFn: () =>
      http.post<{ id: string }>('/api/v1/owners', { name: name.trim(), email: email.trim() }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: qk.owners() });
      toast({
        tone: 'success',
        title: 'Invitation sent',
        description:
          'They set their own password from the emailed link, then set up an authenticator.',
      });
      setName('');
      setEmail('');
      onOpenChange(false);
    },
    onError: (err: Error) => {
      setError(err.message);
    },
  });

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Invite an owner"
      description="They receive a link to set their own password. Nobody, including you, ever sees it."
      footer={
        <>
          <Button
            onClick={() => {
              onOpenChange(false);
            }}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={invite.isPending}
            disabled={name.trim() === '' || email.trim() === ''}
            onClick={() => {
              setError(undefined);
              invite.mutate();
            }}
          >
            Send invitation
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Input
          autoFocus
          label="Name"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
          }}
        />
        <Input
          label="Email"
          type="email"
          value={email}
          error={error}
          onChange={(e) => {
            setEmail(e.target.value);
          }}
        />
      </div>
    </Dialog>
  );
}
