/**
 * The people who can use this console. Everyone here can do everything here, which is why there are
 * meant to be two of them and why adding one is a deliberate act with an audit row behind it.
 *
 * An owner is invited, never given a password by someone else: they receive a link and choose their
 * own, then have to set up an authenticator before the console will let them do anything.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck, ShieldAlert, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { Badge, Button, ConfirmDialog, Dialog, Input, toast } from '@crm/ui';
import { Table, type Column } from '@/components/Bits';
import { PageHeader, StateSlot } from '@/components/Page';
import { http } from '@/lib/api';
import { ago } from '@/lib/format';
import { meQuery } from '@/lib/auth';
import { qk } from '@/lib/query';
import type { Owner } from '@/lib/types';

export function OwnersScreen() {
  const queryClient = useQueryClient();
  const [inviting, setInviting] = useState(false);
  const [deactivating, setDeactivating] = useState<Owner | null>(null);

  const me = useQuery(meQuery);
  const owners = useQuery({
    queryKey: qk.owners(),
    queryFn: async () => (await http.list<Owner>('/api/v1/owners')).data,
  });

  const deactivate = useMutation({
    mutationFn: (owner: Owner) => http.post(`/api/v1/owners/${owner.id}/deactivate`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: qk.owners() });
      toast({ tone: 'success', title: 'That account can no longer sign in' });
    },
    onError: (error: Error) => {
      toast({
        tone: 'danger',
        title: 'Could not deactivate that owner',
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
        <span className="flex justify-end">
          <Button
            size="sm"
            variant="danger"
            disabled={!owner.isActive || owner.id === me.data?.id}
            title={owner.id === me.data?.id ? 'You cannot deactivate your own account' : undefined}
            onClick={() => {
              setDeactivating(owner);
            }}
          >
            Deactivate
          </Button>
        </span>
      ),
    },
  ];

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
        open={deactivating !== null}
        onOpenChange={(v) => {
          if (!v) setDeactivating(null);
        }}
        title={`Deactivate ${deactivating?.name ?? 'this owner'}?`}
        description="Their sessions stop working and they cannot sign in again until another owner reactivates them. Nothing they did is removed."
        confirmLabel="Deactivate"
        loading={deactivate.isPending}
        onConfirm={() => {
          if (deactivating !== null) deactivate.mutate(deactivating);
          setDeactivating(null);
        }}
      />
    </>
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
