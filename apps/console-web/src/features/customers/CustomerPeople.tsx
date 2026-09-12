/**
 * Who to ring at this customer, and what has happened with them.
 *
 * The contact on the customer record is the one we bill and the one carried inside every signed
 * document. These are everybody else, because knowing a business is not the same as knowing the one
 * person at it whose email we happened to write down first.
 *
 * Notes are dated entries rather than the standing paragraph on the record. A support account can
 * add one without being able to change anything else about the customer, which is the reason that
 * permission exists on its own.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pin, PinOff, Plus, Star, Trash2, UserPen } from 'lucide-react';
import { useState } from 'react';
import {
  Badge,
  Button,
  Checkbox,
  ConfirmDialog,
  Dialog,
  IconButton,
  Input,
  Textarea,
  toast,
} from '@crm/ui';
import { Pager, Table, type Column } from '@/components/Bits';
import { EmptyState, Section, StateSlot } from '@/components/Page';
import { http } from '@/lib/api';
import { dateTime } from '@/lib/format';
import { usePermissions } from '@/lib/permissions';
import { qk } from '@/lib/query';
import type { CustomerContact, CustomerNote } from '@/lib/types';

const NOTES_PER_PAGE = 10;

export function CustomerPeople({ customerId }: { customerId: string }) {
  return (
    <>
      <People customerId={customerId} />
      <Notes customerId={customerId} />
    </>
  );
}

function People({ customerId }: { customerId: string }) {
  const queryClient = useQueryClient();
  const { can } = usePermissions();
  const mayWrite = can('customer:write');
  const [editing, setEditing] = useState<CustomerContact | 'new' | null>(null);
  const [removing, setRemoving] = useState<CustomerContact | null>(null);

  const contacts = useQuery({
    queryKey: qk.contacts(customerId),
    queryFn: () => http.get<CustomerContact[]>(`/api/v1/customers/${customerId}/contacts`),
  });

  const remove = useMutation({
    mutationFn: (contact: CustomerContact) =>
      http.del(`/api/v1/customers/${customerId}/contacts/${contact.id}`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: qk.contacts(customerId) });
      toast({ tone: 'success', title: 'Removed' });
    },
    onError: (error: Error) => {
      toast({ tone: 'danger', title: 'Could not remove them', description: error.message });
    },
  });

  const columns: Column<CustomerContact>[] = [
    {
      key: 'name',
      header: 'Person',
      cell: (contact) => (
        <span className="flex flex-col">
          <span className="flex items-center gap-2 font-medium">
            {contact.name}
            {contact.isPrimary && (
              <Badge tone="flare" icon={Star}>
                Main contact
              </Badge>
            )}
          </span>
          {contact.role !== '' && <span className="text-sm text-muted">{contact.role}</span>}
        </span>
      ),
    },
    {
      key: 'email',
      header: 'Email',
      cell: (contact) =>
        contact.email === '' ? (
          <span className="text-muted">—</span>
        ) : (
          <a href={`mailto:${contact.email}`}>{contact.email}</a>
        ),
    },
    {
      key: 'phone',
      header: 'Phone',
      cell: (contact) =>
        contact.phone === null || contact.phone === '' ? (
          <span className="text-muted">—</span>
        ) : (
          <a href={`tel:${contact.phone}`}>{contact.phone}</a>
        ),
    },
    {
      key: 'actions',
      header: '',
      align: 'end',
      cell: (contact) => (
        <span className="flex justify-end gap-1">
          <IconButton
            icon={UserPen}
            variant="ghost"
            label={`Edit ${contact.name}`}
            onClick={() => {
              setEditing(contact);
            }}
          />
          <IconButton
            icon={Trash2}
            variant="ghost"
            label={`Remove ${contact.name}`}
            onClick={() => {
              setRemoving(contact);
            }}
          />
        </span>
      ),
    },
  ];

  return (
    <Section
      title="People"
      description="Everybody worth ringing at this business. The one marked as the main contact is who we call first."
      actions={
        mayWrite ? (
          <Button
            icon={Plus}
            onClick={() => {
              setEditing('new');
            }}
          >
            Add someone
          </Button>
        ) : undefined
      }
    >
      <StateSlot
        isPending={contacts.isPending}
        error={contacts.error}
        isEmpty={contacts.data?.length === 0}
        empty={
          <EmptyState
            title="Nobody else recorded"
            description="Only the contact on their record, which is who we bill."
          />
        }
        onRetry={() => {
          void contacts.refetch();
        }}
      >
        <div className="rounded-md border border-border bg-surface">
          <Table
            caption="People at this customer"
            columns={mayWrite ? columns : columns.filter((c) => c.key !== 'actions')}
            rows={contacts.data ?? []}
            rowKey={(contact) => contact.id}
          />
        </div>
      </StateSlot>

      {editing !== null && (
        <ContactForm
          customerId={customerId}
          contact={editing}
          onClose={() => {
            setEditing(null);
          }}
        />
      )}

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(v) => {
          if (!v) setRemoving(null);
        }}
        title={`Remove ${removing?.name ?? 'this person'}?`}
        description="They stop being listed here. Nothing else about this customer changes, and nothing on their own server is touched."
        confirmLabel="Remove"
        loading={remove.isPending}
        onConfirm={() => {
          if (removing !== null) remove.mutate(removing);
          setRemoving(null);
        }}
      />
    </Section>
  );
}

/** Mounted only while it is open, so it always starts from what the server last said. */
function ContactForm({
  customerId,
  contact,
  onClose,
}: {
  customerId: string;
  contact: CustomerContact | 'new';
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const isNew = contact === 'new';
  const [name, setName] = useState(isNew ? '' : contact.name);
  const [role, setRole] = useState(isNew ? '' : contact.role);
  const [email, setEmail] = useState(isNew ? '' : contact.email);
  const [phone, setPhone] = useState(isNew ? '' : (contact.phone ?? ''));
  const [isPrimary, setIsPrimary] = useState(isNew ? false : contact.isPrimary);
  const [error, setError] = useState<string | undefined>(undefined);

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: name.trim(),
        role: role.trim(),
        email: email.trim(),
        phone: phone.trim() === '' ? null : phone.trim(),
        isPrimary,
      };
      return isNew
        ? http.post<CustomerContact>(`/api/v1/customers/${customerId}/contacts`, body)
        : http.patch<CustomerContact>(
            `/api/v1/customers/${customerId}/contacts/${contact.id}`,
            body,
          );
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: qk.contacts(customerId) });
      toast({ tone: 'success', title: isNew ? 'Added' : 'Saved' });
      onClose();
    },
    onError: (err: Error) => {
      setError(err.message);
    },
  });

  return (
    <Dialog
      open
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
      title={isNew ? 'Add someone' : `Edit ${name}`}
      description="For us, so whoever picks up the phone knows who they are talking to."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={save.isPending}
            disabled={name.trim() === ''}
            onClick={() => {
              setError(undefined);
              save.mutate();
            }}
          >
            {isNew ? 'Add' : 'Save'}
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
          label="What they do"
          description="In their words, not a fixed list."
          value={role}
          onChange={(e) => {
            setRole(e.target.value);
          }}
        />
        <Input
          label="Email"
          type="email"
          error={error}
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
          }}
        />
        <Input
          label="Phone"
          value={phone}
          onChange={(e) => {
            setPhone(e.target.value);
          }}
        />
        <Checkbox
          checked={isPrimary}
          label="This is the main contact"
          description="Only one person can be, so choosing this moves it from whoever has it now."
          onChange={setIsPrimary}
        />
      </div>
    </Dialog>
  );
}

function Notes({ customerId }: { customerId: string }) {
  const queryClient = useQueryClient();
  const { can } = usePermissions();
  const mayNote = can('customer:note');
  const mayWrite = can('customer:write');
  const [page, setPage] = useState(1);
  const [body, setBody] = useState('');
  const [removing, setRemoving] = useState<CustomerNote | null>(null);

  const notes = useQuery({
    queryKey: qk.notes(customerId, page),
    queryFn: () =>
      http.list<CustomerNote>(`/api/v1/customers/${customerId}/notes`, {
        page,
        pageSize: NOTES_PER_PAGE,
      }),
  });

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['notes', customerId] });
  };

  const add = useMutation({
    mutationFn: () =>
      http.post<CustomerNote>(`/api/v1/customers/${customerId}/notes`, { body: body.trim() }),
    onSuccess: async () => {
      setBody('');
      setPage(1);
      await refresh();
    },
    onError: (error: Error) => {
      toast({ tone: 'danger', title: 'Could not add that note', description: error.message });
    },
  });

  const pin = useMutation({
    mutationFn: (note: CustomerNote) =>
      http.patch(`/api/v1/customers/${customerId}/notes/${note.id}`, { pinned: !note.pinned }),
    onSuccess: refresh,
    onError: (error: Error) => {
      toast({ tone: 'danger', title: 'Could not change that', description: error.message });
    },
  });

  const remove = useMutation({
    mutationFn: (note: CustomerNote) =>
      http.del(`/api/v1/customers/${customerId}/notes/${note.id}`),
    onSuccess: refresh,
    onError: (error: Error) => {
      toast({ tone: 'danger', title: 'Could not remove that note', description: error.message });
    },
  });

  return (
    <Section title="Notes" description="What happened, and when. Pinned ones stay at the top.">
      {mayNote && (
        <div className="mb-4 flex flex-col gap-2">
          <Textarea
            label="Add a note"
            rows={2}
            maxLength={4000}
            placeholder="Rang about the July invoice. They will pay on Friday."
            value={body}
            onChange={(e) => {
              setBody(e.target.value);
            }}
          />
          <div className="flex justify-end">
            <Button
              variant="primary"
              loading={add.isPending}
              disabled={body.trim() === ''}
              onClick={() => {
                add.mutate();
              }}
            >
              Add note
            </Button>
          </div>
        </div>
      )}

      <StateSlot
        isPending={notes.isPending}
        error={notes.error}
        isEmpty={notes.data?.data.length === 0}
        empty={
          <EmptyState
            title="Nothing written down yet"
            description="Notes here are for us, and nobody at that business ever sees them."
          />
        }
        onRetry={() => {
          void notes.refetch();
        }}
      >
        <ul className="flex flex-col gap-2">
          {(notes.data?.data ?? []).map((note) => (
            <li key={note.id} className="rounded-sm border border-border bg-bg p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p className="min-w-0 text-base break-words whitespace-pre-wrap">{note.body}</p>
                <span className="flex shrink-0 items-center gap-1">
                  {note.pinned && <Badge tone="neutral">Pinned</Badge>}
                  {mayNote && (
                    <IconButton
                      icon={note.pinned ? PinOff : Pin}
                      variant="ghost"
                      label={note.pinned ? 'Unpin this note' : 'Pin this note'}
                      onClick={() => {
                        pin.mutate(note);
                      }}
                    />
                  )}
                  {mayWrite && (
                    <IconButton
                      icon={Trash2}
                      variant="ghost"
                      label="Remove this note"
                      onClick={() => {
                        setRemoving(note);
                      }}
                    />
                  )}
                </span>
              </div>
              <p className="mt-1 text-sm text-muted">
                {note.authorName ?? 'Somebody since removed'} · {dateTime(note.createdAt)}
              </p>
            </li>
          ))}
        </ul>
        <div className="mt-3">
          <Pager
            page={page}
            pageSize={NOTES_PER_PAGE}
            total={notes.data?.page.total ?? 0}
            onChange={setPage}
            noun="notes"
          />
        </div>
      </StateSlot>

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(v) => {
          if (!v) setRemoving(null);
        }}
        title="Remove this note?"
        description="It goes for good. The audit log keeps a record that it was removed and by whom."
        confirmLabel="Remove"
        tone="danger"
        loading={remove.isPending}
        onConfirm={() => {
          if (removing !== null) remove.mutate(removing);
          setRemoving(null);
        }}
      />
    </Section>
  );
}
