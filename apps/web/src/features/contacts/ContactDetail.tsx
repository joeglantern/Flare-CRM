/**
 * Contact 360 (Contacts · Detail): header with click-to-dial, tabs for timeline, deals,
 * tasks, notes, calls, conversations and files, custom fields and the related company.
 *
 * There is no per-contact files endpoint, so the Files tab gathers what actually carries a file
 * for a contact today: attachments on their conversations and on notes written about them
 * (formerly GAP-14, before a note could carry a file at all).
 */
import type { ContactDto } from '@crm/shared';
import { Link, useNavigate } from '@tanstack/react-router';
import {
  ArchiveRestore,
  Ban,
  Building2,
  Copy,
  Kanban,
  MessageCircle,
  Paperclip,
  Pencil,
  Plus,
  SquareCheck,
  Trash2,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Skeleton } from '@/components/ui/Loading';
import { Tabs } from '@/components/ui/Menu';
import { toast } from '@/components/ui/toast';
import { DateTime, Duration, Money } from '@/components/data/formatters';
import { PhoneNumber } from '@/components/data/PhoneNumber';
import {
  CallDirection,
  CallStatusBadge,
  DealStatusBadge,
  DoNotCallBadge,
  DueLabel,
  ReplyWindowChip,
} from '@/components/data/status';
import { EmptyState, ErrorState, ForbiddenState, NotFoundState } from '@/components/data/states';
import { CustomFieldsPanel } from '@/components/entity/CustomFields';
import { DetailList, EntityHeader, Panel } from '@/components/entity/EntityHeader';
import { NotesPanel } from '@/components/entity/Notes';
import { TagList } from '@/components/entity/TagInput';
import { Timeline, typesForFilter } from '@/components/entity/Timeline';
import { usePageMeta } from '@/app/shell/page-meta';
import { useNotes, useTimeline } from '@/features/activity/api';
import { useCalls } from '@/features/calls/api';
import {
  useChannels,
  useConversationMutations,
  useConversations,
  useMessages,
} from '@/features/inbox/api';
import { useDeals } from '@/features/deals/api';
import { useCustomFields } from '@/features/settings/api';
import { useTasks } from '@/features/tasks/api';
import { TaskFormDialog } from '@/features/tasks/TaskForm';
import { DealFormDrawer } from '@/features/deals/DealForm';
import { linkTo } from '@/lib/links';
import { errorMessage, isApiError } from '@/lib/api/errors';
import { useDebounced } from '@/lib/hooks';
import { useSearchParam } from '@/lib/list-state';
import { useWatchEntity } from '@/lib/socket/client';
import { usePermissions } from '@/providers/permissions';
import { useContact, useContactMutations } from './api';
import { ContactFormDrawer } from './ContactForm';
import { DuplicatesPanel } from './Duplicates';

export function ContactDetailScreen({ contactId }: { contactId: string }) {
  const perms = usePermissions();
  const navigate = useNavigate();
  const query = useContact(contactId);
  const contact = query.data;
  const [tab, setTab] = useSearchParam('tab');
  const [editing, setEditing] = useState(false);
  const [dialog, setDialog] = useState<'delete' | 'erase' | null>(null);
  const { remove, restore, erase } = useContactMutations();

  useWatchEntity('contact', contactId);
  usePageMeta([
    { label: 'Contacts', href: '/contacts' },
    { label: contact?.displayName ?? 'Contact' },
  ]);

  if (query.isError) {
    if (isApiError(query.error) && query.error.status === 404) {
      return <NotFoundState what="contact" backTo={{ label: 'All contacts', href: '/contacts' }} />;
    }
    if (isApiError(query.error) && query.error.isForbidden) {
      return (
        <ForbiddenState
          permission="contact:read"
          what="this contact"
          backTo={{ label: 'All contacts', href: '/contacts' }}
        />
      );
    }
    return (
      <div className="p-6">
        <ErrorState
          message={errorMessage(query.error)}
          requestId={isApiError(query.error) ? query.error.requestId : null}
          onRetry={() => {
            void query.refetch();
          }}
        />
      </div>
    );
  }

  if (query.isPending || contact === undefined) {
    return (
      <div className="flex flex-col gap-4 p-6">
        <div className="flex items-center gap-4">
          <Skeleton shape="circle" height={40} />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton height={20} width="220px" />
            <Skeleton height={12} width="320px" />
          </div>
        </div>
        <Skeleton height={200} shape="block" />
      </div>
    );
  }

  const canEdit = perms.can('contact:update', { ownerId: contact.ownerId });
  const canDelete = perms.can('contact:delete', { ownerId: contact.ownerId });
  const primary = contact.phones.find((p) => p.isPrimary) ?? contact.phones[0];
  const deleted = contact.deletedAt !== null;

  const tabs = [
    { id: 'timeline', label: 'Timeline' },
    { id: 'deals', label: 'Deals' },
    { id: 'tasks', label: 'Tasks' },
    { id: 'notes', label: 'Notes' },
    { id: 'calls', label: 'Calls' },
    { id: 'conversations', label: 'Conversations' },
    { id: 'files', label: 'Files' },
  ];
  const active = tab ?? 'timeline';

  return (
    <div className="flex flex-col gap-4 p-6">
      {deleted && (
        <div className="flex flex-wrap items-center gap-3 rounded-md bg-[var(--warning-subtle)] px-3.5 py-2.5 text-base">
          <Trash2 size={14} className="shrink-0 text-warning" aria-hidden />
          <span className="min-w-0 flex-1">
            This contact is deleted. It will be purged by the retention job; restore it to bring it
            back.
          </span>
          {canDelete && (
            <Button
              size="sm"
              variant="secondary"
              icon={ArchiveRestore}
              loading={restore.isPending}
              onClick={() => {
                restore.mutate(contact.id, {
                  onSuccess: () => {
                    toast({ tone: 'success', title: 'Contact restored' });
                  },
                });
              }}
            >
              Restore
            </Button>
          )}
        </div>
      )}

      <EntityHeader
        title={contact.displayName}
        avatar={contact.avatarUrl}
        avatarSeed={contact.id}
        subtitle={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {contact.company !== null ? (
              <Link
                to="/companies/$companyId"
                params={{ companyId: contact.company.id }}
                className="inline-flex items-center gap-1.5"
              >
                <Building2 size={13} aria-hidden />
                {contact.company.name}
              </Link>
            ) : (
              <span className="text-faint">No company</span>
            )}
            {contact.jobTitle !== null && <span>· {contact.jobTitle}</span>}
            {contact.owner !== null && (
              <span className="inline-flex items-center gap-1.5">
                · <Avatar name={contact.owner.name} seed={contact.owner.id} size={18} />{' '}
                {contact.owner.name}
              </span>
            )}
          </span>
        }
        badges={
          <>
            {contact.doNotCall && <DoNotCallBadge />}
            <TagList tags={contact.tags} max={4} />
          </>
        }
        phone={
          primary !== undefined
            ? {
                e164: primary.e164,
                display: primary.display,
                type: primary.type,
                primary: primary.isPrimary,
                contactId: contact.id,
                phoneId: primary.id,
                contactName: contact.displayName,
                contactCompany: contact.company?.name ?? null,
                doNotCall: contact.doNotCall,
              }
            : undefined
        }
        actions={
          canEdit
            ? [
                {
                  id: 'edit',
                  label: 'Edit',
                  icon: Pencil,
                  onClick: () => {
                    setEditing(true);
                  },
                },
              ]
            : []
        }
        overflowActions={[
          ...(perms.has('contact:merge')
            ? [
                {
                  id: 'duplicates',
                  label: 'Find duplicates',
                  icon: Copy,
                  onSelect: () => {
                    setTab('duplicates');
                  },
                },
              ]
            : []),
          ...(canDelete && !deleted
            ? [
                {
                  id: 'delete',
                  label: 'Delete contact',
                  icon: Trash2,
                  danger: true,
                  onSelect: () => {
                    setDialog('delete');
                  },
                },
              ]
            : []),
          ...(perms.isAdmin
            ? [
                {
                  id: 'erase',
                  label: 'Erase permanently',
                  icon: Ban,
                  danger: true,
                  onSelect: () => {
                    setDialog('erase');
                  },
                },
              ]
            : []),
        ]}
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="flex min-w-0 flex-col gap-3">
          <Tabs
            tabs={
              active === 'duplicates' ? [...tabs, { id: 'duplicates', label: 'Duplicates' }] : tabs
            }
            value={active}
            onChange={(id) => {
              setTab(id === 'timeline' ? undefined : id);
            }}
            ariaLabel="Contact sections"
          />

          {active === 'timeline' && <TimelineTab contactId={contact.id} />}
          {active === 'deals' && <DealsTab contact={contact} />}
          {active === 'tasks' && <TasksTab contact={contact} />}
          {active === 'notes' && (
            <NotesPanel parent="contact" id={contact.id} canCreate={perms.has('note:create')} />
          )}
          {active === 'calls' && <CallsTab contactId={contact.id} />}
          {active === 'conversations' && <ConversationsTab contact={contact} />}
          {active === 'files' && <FilesTab contact={contact} />}
          {active === 'duplicates' && <DuplicatesPanel contact={contact} />}
        </div>

        <aside className="flex min-w-0 flex-col gap-3">
          <Panel title="Details">
            <DetailList
              items={[
                {
                  label: 'Phones',
                  value:
                    contact.phones.length === 0 ? (
                      <span className="text-faint">None</span>
                    ) : (
                      <div className="flex flex-col gap-2">
                        {contact.phones.map((p) => (
                          <PhoneNumber
                            key={p.id}
                            e164={p.e164}
                            display={p.display}
                            type={p.type}
                            primary={p.isPrimary}
                            layout="stacked"
                            contactId={contact.id}
                            phoneId={p.id}
                            contactName={contact.displayName}
                            doNotCall={contact.doNotCall}
                            actions
                          />
                        ))}
                      </div>
                    ),
                },
                {
                  label: 'Emails',
                  value:
                    contact.emails.length === 0 ? (
                      <span className="text-faint">None</span>
                    ) : (
                      <div className="flex flex-col">
                        {contact.emails.map((e) => (
                          <a key={e.id} href={`mailto:${e.email}`} className="truncate">
                            {e.email}
                          </a>
                        ))}
                      </div>
                    ),
                },
                { label: 'Source', value: <span className="capitalize">{contact.source}</span> },
                { label: 'Created', value: <DateTime value={contact.createdAt} mode="absolute" /> },
                { label: 'Updated', value: <DateTime value={contact.updatedAt} /> },
              ]}
            />
          </Panel>

          <CustomFieldsPanelForContact contact={contact} />

          {contact.company !== null && (
            <Panel title="Company">
              <Link
                to="/companies/$companyId"
                params={{ companyId: contact.company.id }}
                className="flex items-center gap-2 text-base text-text no-underline hover:no-underline"
              >
                <span className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-bg text-muted">
                  <Building2 size={15} aria-hidden />
                </span>
                <span className="min-w-0 truncate font-medium">{contact.company.name}</span>
              </Link>
            </Panel>
          )}
        </aside>
      </div>

      <ContactFormDrawer open={editing} onOpenChange={setEditing} contact={contact} />

      <ConfirmDialog
        open={dialog === 'delete'}
        onOpenChange={(v) => {
          if (!v) setDialog(null);
        }}
        title={`Delete ${contact.displayName}?`}
        description="The contact is soft deleted and can be restored until the retention job purges it."
        confirmLabel="Delete"
        consequences={[
          'Deals, tasks and notes keep their history',
          'Calls stay in the call log but lose the contact link',
        ]}
        loading={remove.isPending}
        onConfirm={() => {
          remove.mutate(contact.id, {
            onSuccess: () => {
              setDialog(null);
              toast({ tone: 'success', title: 'Contact deleted' });
            },
          });
        }}
      />

      <ConfirmDialog
        open={dialog === 'erase'}
        onOpenChange={(v) => {
          if (!v) setDialog(null);
        }}
        title={`Permanently erase ${contact.displayName}?`}
        description="Removes the contact, phones, emails, notes and files. Calls and audit entries stay but lose the link. This cannot be undone."
        confirmLabel="Erase permanently"
        typedConfirmation="ERASE"
        consequences={[
          'Only an administrator can do this',
          'The record and its attachments are destroyed, not hidden',
          'The audit entry naming you is kept',
        ]}
        loading={erase.isPending}
        onConfirm={() => {
          erase.mutate(contact.id, {
            onSuccess: () => {
              setDialog(null);
              toast({ tone: 'success', title: 'Contact erased' });
              void navigate({ to: '/contacts' });
            },
          });
        }}
      />
    </div>
  );
}

function CustomFieldsPanelForContact({ contact }: { contact: ContactDto }) {
  const definitions = useCustomFields('contact');
  if ((definitions.data ?? []).length === 0) return null;
  return <CustomFieldsPanel definitions={definitions.data ?? []} values={contact.customFields} />;
}

function TimelineTab({ contactId }: { contactId: string }) {
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const debounced = useDebounced(query, 300);
  const timeline = useTimeline('contact', contactId, {
    ...(typesForFilter(filter) !== undefined ? { types: typesForFilter(filter) } : {}),
    ...(debounced.trim().length >= 2 ? { q: debounced.trim() } : {}),
  });
  const items = timeline.data?.pages.flatMap((p) => p.data) ?? [];
  return (
    <Timeline
      items={items}
      state={
        timeline.isPending
          ? 'loading'
          : timeline.isError
            ? 'error'
            : items.length === 0
              ? 'empty'
              : 'ready'
      }
      filter={filter}
      onFilterChange={setFilter}
      query={query}
      onQueryChange={setQuery}
      hasMore={timeline.hasNextPage}
      loadingMore={timeline.isFetchingNextPage}
      onLoadMore={() => {
        void timeline.fetchNextPage();
      }}
      onRetry={() => {
        void timeline.refetch();
      }}
      emptyTitle={
        filter === 'all' && debounced === ''
          ? 'Nothing on this timeline yet'
          : 'Nothing matches that filter'
      }
    />
  );
}

function DealsTab({ contact }: { contact: ContactDto }) {
  const perms = usePermissions();
  const deals = useDeals({ contactId: contact.id, pageSize: 50 }, perms.has('deal:read'));
  const [creating, setCreating] = useState(false);
  if (!perms.has('deal:read'))
    return <ForbiddenState compact permission="deal:read" what="deals" />;
  const rows = deals.data?.data ?? [];
  return (
    <Panel
      title="Deals"
      actions={
        perms.has('deal:create') && (
          <Button
            size="sm"
            variant="secondary"
            icon={Plus}
            onClick={() => {
              setCreating(true);
            }}
          >
            New deal
          </Button>
        )
      }

      padded={false}
    >
      {deals.isPending && (
        <div className="p-3">
          <Skeleton count={3} height={40} shape="block" className="mb-2" />
        </div>
      )}
      {!deals.isPending && rows.length === 0 && (
        <EmptyState
          compact
          object="kanban"
          title="No deals yet"
          description="Open a deal when there is something specific to win."
          {...(perms.has('deal:create')
            ? {
                primaryAction: {
                  label: 'New deal',
                  onClick: () => {
                    setCreating(true);
                  },
                },
              }
            : {})}
        />
      )}
      <ul>
        {rows.map((d) => (
          <li key={d.id} className="border-b border-border last:border-b-0">
            <Link
              to="/deals/$dealId"
              params={{ dealId: d.id }}
              className="flex items-center gap-3 px-3.5 py-2.5 text-base text-text no-underline hover:bg-hover hover:no-underline"
            >
              <Kanban size={14} className="shrink-0 text-muted" aria-hidden />
              <span className="min-w-0 flex-1 truncate font-medium">{d.title}</span>
              <span className="shrink-0 text-muted">{d.stage.name}</span>
              <DealStatusBadge status={d.status} />
              <Money amount={d.value} className="w-28 shrink-0 text-right" />
            </Link>
          </li>
        ))}
      </ul>
      <DealFormDrawer
        open={creating}
        onOpenChange={setCreating}
        defaults={{ contactId: contact.id, companyId: contact.companyId }}
      />
    </Panel>
  );
}

function TasksTab({ contact }: { contact: ContactDto }) {
  const perms = usePermissions();
  const tasks = useTasks({ contactId: contact.id, pageSize: 50 }, perms.has('task:read'));
  const [creating, setCreating] = useState(false);
  if (!perms.has('task:read'))
    return <ForbiddenState compact permission="task:read" what="tasks" />;
  const rows = tasks.data?.data ?? [];
  return (
    <Panel
      title="Tasks"
      actions={
        perms.has('task:create') && (
          <Button
            size="sm"
            variant="secondary"
            icon={Plus}
            onClick={() => {
              setCreating(true);
            }}
          >
            New task
          </Button>
        )
      }

      padded={false}
    >
      {tasks.isPending && (
        <div className="p-3">
          <Skeleton count={3} height={36} shape="block" className="mb-2" />
        </div>
      )}
      {!tasks.isPending && rows.length === 0 && (
        <EmptyState
          compact
          object="checkmark"
          title="No tasks"
          description="Nothing scheduled for this contact."
        />
      )}
      <ul>
        {rows.map((t) => (
          <li
            key={t.id}
            className="flex items-center gap-3 border-b border-border px-3.5 py-2.5 text-base last:border-b-0"
          >
            <SquareCheck
              size={14}
              className={t.status === 'done' ? 'text-success' : 'text-muted'}
              aria-hidden
            />
            <span className="min-w-0 flex-1 truncate">{t.title}</span>
            <DueLabel dueAt={t.dueAt} status={t.status} />
            {t.assignee !== null && (
              <Avatar name={t.assignee.name} seed={t.assignee.id} size={18} />
            )}
          </li>
        ))}
      </ul>
      <TaskFormDialog
        open={creating}
        onOpenChange={setCreating}
        defaults={{ contactId: contact.id }}
      />
    </Panel>
  );
}

function CallsTab({ contactId }: { contactId: string }) {
  const perms = usePermissions();
  const calls = useCalls({ contactId, pageSize: 25 }, perms.has('call:read'));
  if (!perms.has('call:read'))
    return <ForbiddenState compact permission="call:read" what="calls" />;
  const rows = calls.data?.data ?? [];
  return (
    <Panel title="Calls" padded={false}>
      {calls.isPending && (
        <div className="p-3">
          <Skeleton count={4} height={36} shape="block" className="mb-2" />
        </div>
      )}
      {!calls.isPending && rows.length === 0 && (
        <EmptyState
          compact
          object="handset"
          title="No calls yet"
          description="Inbound and outbound calls appear here the moment the PBX logs them."
        />
      )}
      <ul>
        {rows.map((c) => (
          <li key={c.id} className="border-b border-border last:border-b-0">
            <Link
              to="/calls/$callId"
              params={{ callId: c.id }}
              className="flex items-center gap-3 px-3.5 py-2.5 text-base text-text no-underline hover:bg-hover hover:no-underline"
            >
              <CallDirection direction={c.direction} className="w-24 shrink-0" />
              <CallStatusBadge status={c.status} />
              <span className="min-w-0 flex-1 truncate text-muted">
                {c.disposition?.name ?? '—'}
              </span>
              <Duration seconds={c.talkDurationSec} className="shrink-0" />
              <span className="w-28 shrink-0 text-right text-muted">
                <DateTime value={c.startedAt} />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function ConversationsTab({ contact }: { contact: ContactDto }) {
  const perms = usePermissions();
  const conversations = useConversations({ contactId: contact.id }, perms.has('chat:read'));
  const channels = useChannels(perms.has('chat:send'));
  const { start } = useConversationMutations();
  const navigate = useNavigate();
  if (!perms.has('chat:read'))
    return <ForbiddenState compact permission="chat:read" what="conversations" />;
  const rows = conversations.data?.pages.flatMap((p) => p.data) ?? [];
  const channel = (channels.data ?? []).find((c) => c.isActive);
  const primaryPhone = contact.phones.find((p) => p.isPrimary) ?? contact.phones[0];

  return (
    <Panel
      title="Conversations"
      actions={
        perms.has('chat:send') &&
        channel !== undefined &&
        primaryPhone !== undefined && (
          <Button
            size="sm"
            variant="secondary"
            icon={MessageCircle}
            loading={start.isPending}
            onClick={() => {
              start.mutate(
                { channelId: channel.id, contactId: contact.id, phoneId: primaryPhone.id },
                {
                  onSuccess: (c) => {
                    void navigate(linkTo.conversation(c.id));
                  },
                  onError: (e) => {
                    toast({
                      tone: 'danger',
                      title: 'Could not start the conversation',
                      description: errorMessage(e),
                    });
                  },
                },
              );
            }}
          >
            Message on WhatsApp
          </Button>
        )
      }

      padded={false}
    >
      {conversations.isPending && (
        <div className="p-3">
          <Skeleton count={2} height={40} shape="block" className="mb-2" />
        </div>
      )}
      {!conversations.isPending && rows.length === 0 && (
        <EmptyState
          compact
          object="chat-bubble"
          title="No conversations"
          description="WhatsApp threads with this contact appear here."
        />
      )}
      <ul>
        {rows.map((c) => (
          <li key={c.id} className="border-b border-border last:border-b-0">
            <Link
              to="/inbox/$conversationId"
              params={{ conversationId: c.id }}
              className="flex items-center gap-3 px-3.5 py-2.5 text-base text-text no-underline hover:bg-hover hover:no-underline"
            >
              <MessageCircle size={14} className="shrink-0 text-success" aria-hidden />
              <span className="min-w-0 flex-1 truncate">
                {c.lastMessagePreview ?? 'No messages yet'}
              </span>
              <ReplyWindowChip lastInboundAt={c.lastInboundAt} size="sm" />
              {c.unreadCount > 0 && <Badge tone="flare">{c.unreadCount}</Badge>}
              <span className="w-24 shrink-0 text-right text-muted">
                <DateTime value={c.lastMessageAt ?? c.createdAt} />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

/** A file with wherever it actually came from, so the two sources read as one list, not two. */
interface ContactFile {
  id: string;
  fileName: string;
  sizeBytes: number;
  url: string;
  date: string;
  source: 'conversation' | 'note';
}

function FilesTab({ contact }: { contact: ContactDto }) {
  const perms = usePermissions();
  const canChat = perms.has('chat:read');
  const canNotes = perms.has('note:read');
  const conversations = useConversations({ contactId: contact.id }, canChat);
  const conversationIds = useMemo(
    () => (conversations.data?.pages.flatMap((p) => p.data) ?? []).map((c) => c.id),
    [conversations.data],
  );
  const notes = useNotes('contact', canNotes ? contact.id : null);
  const noteFiles: ContactFile[] = useMemo(
    () =>
      (notes.data?.pages.flatMap((p) => p.data) ?? []).flatMap((n) =>
        n.attachments.map((a) => ({ ...a, date: n.createdAt, source: 'note' as const })),
      ),
    [notes.data],
  );

  if (!canChat && !canNotes) {
    return <ForbiddenState compact permission="chat:read" what="files" />;
  }

  return (
    <Panel
      title="Files"
      note="Attachments on this contact's conversations and notes"
      padded={false}
    >
      {canChat && conversationIds.length > 0 ? (
        <ConversationAttachments
          conversationIds={conversationIds}
          extra={canNotes ? noteFiles : []}
        />
      ) : noteFiles.length === 0 ? (
        <EmptyState
          compact
          object="folder"
          title="No files yet"
          description="Files arrive as WhatsApp attachments or as files added to a note about this contact."
        />
      ) : (
        <FileList files={[...noteFiles].sort((a, b) => b.date.localeCompare(a.date))} />
      )}
    </Panel>
  );
}

function ConversationAttachments({
  conversationIds,
  extra,
}: {
  conversationIds: string[];
  extra: ContactFile[];
}) {
  // One conversation at a time keeps the hook count stable; in practice a contact has one thread.
  const messages = useMessages(conversationIds[0] ?? null);
  const fromMessages: ContactFile[] = (messages.data?.pages.flatMap((p) => p.data) ?? [])
    .filter((m) => m.attachments.length > 0)
    .flatMap((m) =>
      m.attachments.map((a) => ({ ...a, date: m.sentAt, source: 'conversation' as const })),
    );
  const files = [...fromMessages, ...extra].sort((a, b) => b.date.localeCompare(a.date));
  if (files.length === 0) {
    return (
      <EmptyState
        compact
        object="folder"
        title="No files yet"
        description="Nothing has been sent, received or attached to a note yet."
      />
    );
  }
  return <FileList files={files} />;
}

function FileList({ files }: { files: ContactFile[] }) {
  return (
    <ul>
      {files.map((f) => (
        <li
          key={f.id}
          className="flex items-center gap-3 border-b border-border px-3.5 py-2.5 text-base last:border-b-0"
        >
          <Paperclip size={14} className="shrink-0 text-muted" aria-hidden />
          <a
            href={f.url}
            target="_blank"
            rel="noreferrer noopener"
            className="min-w-0 flex-1 truncate"
          >
            {f.fileName}
          </a>
          <span className="w-16 shrink-0 text-right text-sm text-faint">
            {f.source === 'note' ? 'Note' : 'Chat'}
          </span>
          <span className="shrink-0 text-sm text-muted">{Math.round(f.sizeBytes / 1024)} KB</span>
          <span className="w-24 shrink-0 text-right text-muted">
            <DateTime value={f.date} />
          </span>
        </li>
      ))}
    </ul>
  );
}
