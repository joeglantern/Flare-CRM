/**
 * Inbox (Inbox): conversation list, thread, and the contact rail.
 *
 * The 24 hour WhatsApp window is the rule that shapes this screen. Inside it, free text sends.
 * Outside it the composer is replaced by the template picker, because Meta rejects free text and
 * showing a disabled box with no explanation is how people end up thinking the app is broken.
 *
 * Mark as read is optimistic: POST /conversations/:id/read is idempotent.
 * GAP-04: the conversations query has `mine`, `assigneeId` and `unassigned` but no team scope, so
 * the Team chip resolves to the manager's roster client side and there is no bulk bar.
 * GAP-05: there is no template list endpoint, so templates come from the channel config.
 */
import type { ConversationDto, MessageDto } from '@crm/shared';
import { useNavigate } from '@tanstack/react-router';
import {
  ArchiveRestore,
  Building2,
  Check,
  CircleCheck,
  Filter,
  Paperclip,
  Phone,
  Send,
  UserPlus,
  UserRound,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Button, IconButton } from '@/components/ui/Button';
import { Input, Textarea } from '@/components/ui/Input';
import { Spinner } from '@/components/ui/Loading';
import { Skeleton } from '@/components/ui/Loading';
import { Dialog } from '@/components/ui/Overlay';
import { Select } from '@/components/ui/Select';
import { Segmented } from '@/components/ui/Toggle';
import { toast } from '@/components/ui/toast';
import { DateTime } from '@/components/data/formatters';
import { PhoneNumber } from '@/components/data/PhoneNumber';
import { MessageTicks, ReplyWindowChip } from '@/components/data/status';
import { EmptyState, ErrorState, ForbiddenState, OfflineState } from '@/components/data/states';
import { DetailList, Panel } from '@/components/entity/EntityHeader';
import { ContactPicker, OwnerPicker } from '@/components/entity/pickers';
import { PageHeader } from '@/app/shell/TopBar';
import { usePageMeta } from '@/app/shell/page-meta';
import { errorMessage } from '@/lib/api/errors';
import { useDebounced, useNow } from '@/lib/hooks';
import { linkTo } from '@/lib/links';
import { useSearchParam } from '@/lib/list-state';
import { useSocketEvent } from '@/lib/socket/client';
import { cn } from '@/lib/utils';
import { useContact } from '@/features/contacts/api';
import { useAssignableUsers } from '@/features/users/api';
import { usePermissions } from '@/providers/permissions';
import { useSocketState } from '@/providers/socket';
import {
  templatesOf,
  useChannels,
  useConversation,
  useConversationMutations,
  useConversations,
  useMessages,
  windowState,
  type ConversationFilters,
  type TemplateDef,
} from './api';

export function InboxScreen({ conversationId }: { conversationId?: string }) {
  usePageMeta([{ label: 'Inbox' }]);
  const perms = usePermissions();
  const navigate = useNavigate();
  const { online } = useSocketState();
  const channels = useChannels(perms.has('chat:read'));
  const [scope, setScope] = useSearchParam('scope');
  const [channelId, setChannelId] = useSearchParam('channel');
  const [statusParam, setStatusParam] = useSearchParam('status');
  const [assigneeParam, setAssigneeParam] = useSearchParam('assignee');
  const [q, setQ] = useState('');
  const [startOpen, setStartOpen] = useState(false);
  const debounced = useDebounced(q, 250);

  const filters = useMemo<ConversationFilters>(() => {
    const f: ConversationFilters = { status: statusParam ?? 'open' };
    if (scope === 'mine') f.mine = 'true';
    if (scope === 'unassigned') f.unassigned = 'true';
    if (channelId !== undefined) f.channelId = channelId;
    if (assigneeParam !== undefined) f.assigneeId = assigneeParam;
    if (debounced.trim() !== '') f.q = debounced.trim();
    return f;
  }, [scope, channelId, statusParam, assigneeParam, debounced]);

  const canRead = perms.has('chat:read');
  const list = useConversations(filters, canRead);
  const conversations = useMemo(() => list.data?.pages.flatMap((p) => p.data) ?? [], [list.data]);

  // A new inbound message can land in any conversation, so the list and the open thread both refresh.
  useSocketEvent('message:new', () => {
    void list.refetch();
  });
  useSocketEvent('conversation:updated', () => {
    void list.refetch();
  });

  if (!canRead) return <ForbiddenState permission="chat:read" what="the inbox" />;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="px-6 pt-6">
        <PageHeader
          title="Inbox"
          description="WhatsApp and SMS conversations, in one queue."
          actions={
            perms.has('chat:send') ? (
              <Button
                variant="primary"
                icon={Send}
                onClick={() => {
                  setStartOpen(true);
                }}
              >
                New conversation
              </Button>
            ) : undefined
          }
        />
      </div>

      <div className="grid min-h-0 flex-1 gap-0 px-6 pb-6 lg:grid-cols-[320px_minmax(0,1fr)] xl:grid-cols-[320px_minmax(0,1fr)_300px]">
        <ConversationList
          conversations={conversations}
          selectedId={conversationId}
          state={{
            pending: list.isPending,
            error: list.isError ? errorMessage(list.error) : null,
            online,
          }}
          scope={scope ?? 'all'}
          onScopeChange={(v) => {
            setScope(v === 'all' ? undefined : v);
          }}
          status={statusParam ?? 'open'}
          onStatusChange={(v) => {
            setStatusParam(v === 'open' ? undefined : v);
          }}
          channelId={channelId}
          onChannelChange={setChannelId}
          assigneeId={assigneeParam}
          onAssigneeChange={setAssigneeParam}
          channels={(channels.data ?? []).map((c) => ({ value: c.id, label: c.name }))}
          query={q}
          onQueryChange={setQ}
          hasMore={list.hasNextPage}
          loadingMore={list.isFetchingNextPage}
          onLoadMore={() => {
            void list.fetchNextPage();
          }}
          onRetry={() => {
            void list.refetch();
          }}
          onSelect={(id) => {
            void navigate(linkTo.conversation(id));
          }}
          className={cn('min-h-0', conversationId !== undefined && 'hidden lg:flex')}
        />

        {conversationId === undefined ? (
          <div className="hidden min-h-0 items-center justify-center border-l border-border lg:flex">
            <EmptyState
              object="chat-bubble"
              title="Pick a conversation"
              description="Choose one on the left, or start a new thread with a contact."
            />
          </div>
        ) : (
          <ConversationThread
            conversationId={conversationId}
            onBack={() => {
              void navigate({ to: '/inbox' });
            }}
          />
        )}
      </div>

      <StartConversationDialog open={startOpen} onOpenChange={setStartOpen} />
    </div>
  );
}

/* ── list ───────────────────────────────────────────────────────────────────────────────── */

function ConversationList({
  conversations,
  selectedId,
  state,
  scope,
  onScopeChange,
  status,
  onStatusChange,
  channelId,
  onChannelChange,
  assigneeId,
  onAssigneeChange,
  channels,
  query,
  onQueryChange,
  hasMore,
  loadingMore,
  onLoadMore,
  onRetry,
  onSelect,
  className,
}: {
  conversations: ConversationDto[];
  selectedId: string | undefined;
  state: { pending: boolean; error: string | null; online: boolean };
  scope: string;
  onScopeChange: (v: string) => void;
  status: string;
  onStatusChange: (v: string) => void;
  channelId: string | undefined;
  onChannelChange: (v: string | undefined) => void;
  assigneeId: string | undefined;
  onAssigneeChange: (v: string | undefined) => void;
  channels: { value: string; label: string }[];
  query: string;
  onQueryChange: (v: string) => void;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  onRetry: () => void;
  onSelect: (id: string) => void;
  className?: string;
}) {
  const perms = usePermissions();
  const users = useAssignableUsers();

  return (
    <aside
      className={cn('flex flex-col gap-2 overflow-hidden pr-3', className)}
      aria-label="Conversations"
    >
      <Input
        value={query}
        onChange={(e) => {
          onQueryChange(e.target.value);
        }}
        placeholder="Search conversations"
        aria-label="Search conversations"
      />

      <Segmented
        value={scope}
        onChange={onScopeChange}
        ariaLabel="Conversation scope"
        options={[
          { value: 'all', label: 'All' },
          { value: 'mine', label: 'Mine' },
          { value: 'unassigned', label: 'Unassigned' },
        ]}
      />

      <div className="flex items-center gap-2">
        <Select
          value={status}
          onChange={onStatusChange}
          size="sm"
          ariaLabel="Status"
          options={[
            { value: 'open', label: 'Open' },
            { value: 'pending', label: 'Pending' },
            { value: 'closed', label: 'Closed' },
          ]}
        />
        {channels.length > 1 && (
          <Select
            value={channelId ?? ''}
            onChange={(v) => {
              onChannelChange(v === '' ? undefined : v);
            }}
            size="sm"
            ariaLabel="Channel"
            options={[{ value: '', label: 'All channels' }, ...channels]}
          />
        )}
        {perms.has('chat:assign') && (
          <Select
            value={assigneeId ?? ''}
            onChange={(v) => {
              onAssigneeChange(v === '' ? undefined : v);
            }}
            size="sm"
            searchable
            ariaLabel="Assignee"
            options={[
              { value: '', label: 'Anyone' },
              ...(users.data ?? []).map((u) => ({ value: u.id, label: u.name })),
            ]}
          />
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {state.pending ? (
          <div className="flex flex-col gap-2 py-2">
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} height={56} shape="block" />
            ))}
          </div>
        ) : state.error !== null ? (
          <ErrorState message={state.error} onRetry={onRetry} />
        ) : !state.online && conversations.length === 0 ? (
          <OfflineState onRetry={onRetry} />
        ) : conversations.length === 0 ? (
          <EmptyState
            object="inbox-tray"
            title={query === '' ? 'Nothing in this queue' : 'No conversations match'}
            description={
              query === ''
                ? 'New WhatsApp and SMS messages land here as they arrive.'
                : 'Search matches the contact name and the number.'
            }
          />
        ) : (
          <>
            <ul className="flex flex-col">
              {conversations.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    aria-current={c.id === selectedId ? 'true' : undefined}
                    onClick={() => {
                      onSelect(c.id);
                    }}
                    className={cn(
                      'flex w-full items-start gap-2.5 rounded-sm px-2 py-2 text-left',
                      c.id === selectedId ? 'bg-[var(--flare-subtle)]' : 'hover:bg-hover',
                    )}
                  >
                    <Avatar
                      name={c.contact?.displayName ?? c.externalDisplay}
                      seed={c.contactId ?? c.id}
                      size={32}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline gap-2">
                        <span className="min-w-0 flex-1 truncate font-medium">
                          {c.contact?.displayName ?? c.externalDisplay}
                        </span>
                        <span className="shrink-0 text-xs text-faint">
                          <DateTime value={c.lastMessageAt} mode="relative" bare />
                        </span>
                      </span>
                      <span className="flex items-center gap-1.5">
                        <span className="min-w-0 flex-1 truncate text-sm text-muted">
                          {c.lastMessagePreview ?? 'No messages yet'}
                        </span>
                        {c.unreadCount > 0 && (
                          <span className="mono shrink-0 rounded-full bg-flare px-1.5 text-xs text-on-flare">
                            {c.unreadCount}
                          </span>
                        )}
                      </span>
                      <span className="mt-0.5 flex items-center gap-1.5">
                        <span className="text-xs text-faint">{c.channel.name}</span>
                        {c.assignee === null ? (
                          <span className="text-xs text-faint">· Unassigned</span>
                        ) : (
                          <span className="text-xs text-faint">· {c.assignee.name}</span>
                        )}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {hasMore && (
              <div className="p-2">
                <Button
                  variant="secondary"
                  size="sm"
                  loading={loadingMore}
                  onClick={onLoadMore}
                  className="w-full"
                >
                  Load older
                </Button>
              </div>
            )}
          </>
        )}
      </div>

      {perms.has('chat:assign') && (
        <p className="px-2 pb-1 text-xs text-faint">
          GAP-04: GET /conversations takes one assignee, not a team, so filter by person.
        </p>
      )}
    </aside>
  );
}

/* ── thread ─────────────────────────────────────────────────────────────────────────────── */

function ConversationThread({
  conversationId,
  onBack,
}: {
  conversationId: string;
  onBack: () => void;
}) {
  const perms = usePermissions();
  const conv = useConversation(conversationId);
  const messages = useMessages(conversationId);
  const channels = useChannels();
  const { markRead, assign, setStatus } = useConversationMutations(conversationId);
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignTo, setAssignTo] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const conversation = conv.data;
  const items = useMemo(
    () => [...(messages.data?.pages.flatMap((p) => p.data) ?? [])].reverse(),
    [messages.data],
  );

  useSocketEvent('message:new', (payload: { conversationId?: string }) => {
    if (payload.conversationId === conversationId) {
      void messages.refetch();
      void conv.refetch();
    }
  });

  // Reading the thread is what marks it read. Idempotent, so it is fired once per open.
  const unread = conversation?.unreadCount ?? 0;
  const markReadFn = markRead.mutate;
  useEffect(() => {
    if (unread > 0) markReadFn(conversationId);
  }, [conversationId, unread, markReadFn]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [items.length]);

  if (conv.isError) {
    return (
      <div className="border-l border-border p-6">
        <ErrorState
          message={errorMessage(conv.error)}
          onRetry={() => {
            void conv.refetch();
          }}
        />
      </div>
    );
  }

  if (conv.isPending || conversation === undefined) {
    return (
      <div className="flex flex-col gap-3 border-l border-border p-4">
        <Skeleton height={48} shape="block" />
        <Skeleton height={280} shape="block" />
      </div>
    );
  }

  const channel = (channels.data ?? []).find((c) => c.id === conversation.channel.id);
  const win = windowState(conversation.lastInboundAt);
  const canSend = perms.has('chat:send');
  const closed = conversation.status === 'closed';

  return (
    <>
      <section className="flex min-h-0 flex-col border-l border-border" aria-label="Conversation">
        <header className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
          <Button variant="ghost" size="sm" className="lg:hidden" onClick={onBack}>
            Back
          </Button>
          <Avatar
            name={conversation.contact?.displayName ?? conversation.externalDisplay}
            seed={conversation.contactId ?? conversation.id}
            size={32}
          />
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium">
              {conversation.contact?.displayName ?? conversation.externalDisplay}
            </div>
            <div className="mono truncate text-xs text-faint">
              {conversation.externalDisplay} · {conversation.channel.name}
            </div>
          </div>

          <ReplyWindowChip lastInboundAt={conversation.lastInboundAt} />

          {perms.has('chat:assign') && (
            <Button
              variant="secondary"
              size="sm"
              icon={UserPlus}
              onClick={() => {
                setAssignTo(conversation.assigneeId);
                setAssignOpen(true);
              }}
            >
              {conversation.assignee?.name ?? 'Assign'}
            </Button>
          )}

          {perms.has('chat:close') && (
            <Button
              variant="secondary"
              size="sm"
              icon={closed ? ArchiveRestore : CircleCheck}
              loading={setStatus.isPending}
              onClick={() => {
                setStatus.mutate(
                  { id: conversation.id, action: closed ? 'reopen' : 'close' },
                  {
                    onSuccess: () => {
                      toast({
                        tone: 'success',
                        title: closed ? 'Conversation reopened' : 'Conversation closed',
                      });
                    },
                    onError: (e) => {
                      toast({
                        tone: 'danger',
                        title: 'Could not change the status',
                        description: errorMessage(e),
                      });
                    },
                  },
                );
              }}
            >
              {closed ? 'Reopen' : 'Close'}
            </Button>
          )}
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {messages.hasNextPage && (
            <div className="mb-3 flex justify-center">
              <Button
                variant="secondary"
                size="sm"
                loading={messages.isFetchingNextPage}
                onClick={() => {
                  void messages.fetchNextPage();
                }}
              >
                Load earlier messages
              </Button>
            </div>
          )}

          {messages.isPending ? (
            <div className="flex flex-col gap-3">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} height={48} shape="block" />
              ))}
            </div>
          ) : items.length === 0 ? (
            <EmptyState
              object="chat-bubble"
              title="No messages yet"
              description="Send the first message to open the conversation."
            />
          ) : (
            <ol className="flex flex-col gap-2">
              {items.map((m) => (
                <MessageBubble key={m.id} message={m} />
              ))}
            </ol>
          )}
          <div ref={bottomRef} />
        </div>

        <Composer
          conversationId={conversation.id}
          windowOpen={win.open}
          closesAt={win.closesAt}
          templates={templatesOf(channel)}
          disabled={!canSend || closed}
          disabledReason={
            !canSend
              ? 'You do not have permission to send messages.'
              : closed
                ? 'This conversation is closed.'
                : null
          }
        />
      </section>

      <ContactRail conversation={conversation} />

      <Dialog
        open={assignOpen}
        onOpenChange={setAssignOpen}
        title="Assign conversation"
        description="POST /conversations/:id/assign"
        width={420}
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setAssignOpen(false);
              }}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={assign.isPending}
              onClick={() => {
                assign.mutate(
                  { id: conversation.id, assigneeId: assignTo },
                  {
                    onSuccess: () => {
                      toast({ tone: 'success', title: 'Conversation assigned' });
                      setAssignOpen(false);
                    },
                    onError: (e) => {
                      toast({
                        tone: 'danger',
                        title: 'Could not assign',
                        description: errorMessage(e),
                      });
                    },
                  },
                );
              }}
            >
              Assign
            </Button>
          </>
        }
      >
        <OwnerPicker value={assignTo} onChange={setAssignTo} label="Assignee" />
      </Dialog>
    </>
  );
}

function MessageBubble({ message }: { message: MessageDto }) {
  const outbound = message.direction === 'outbound';
  return (
    <li className={cn('flex', outbound ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[min(560px,80%)] rounded-lg px-3 py-2',
          outbound ? 'bg-flare-subtle text-fg' : 'border border-border bg-surface',
        )}
      >
        {message.body !== null && (
          <p className="whitespace-pre-wrap break-words text-base">{message.body}</p>
        )}

        {message.attachments.length > 0 && (
          <ul className="mt-1.5 flex flex-col gap-1">
            {message.attachments.map((a) => (
              <li key={a.id}>
                <a
                  href={a.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="flex items-center gap-1.5 text-sm underline-offset-2 hover:underline"
                >
                  <Paperclip size={12} aria-hidden />
                  <span className="truncate">{a.fileName}</span>
                </a>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-1 flex items-center justify-end gap-1.5 text-xs text-faint">
          {message.sentBy !== null && outbound && (
            <span className="truncate">{message.sentBy.name}</span>
          )}
          <DateTime value={message.sentAt} mode="absolute" bare />
          {outbound && <MessageTicks status={message.status} errorMessage={message.errorMessage} />}
        </div>
      </div>
    </li>
  );
}

/* ── composer ───────────────────────────────────────────────────────────────────────────── */

function Composer({
  conversationId,
  windowOpen,
  closesAt,
  templates,
  disabled,
  disabledReason,
}: {
  conversationId: string;
  windowOpen: boolean;
  closesAt: string | null;
  templates: TemplateDef[];
  disabled: boolean;
  disabledReason: string | null;
}) {
  const { send, upload } = useConversationMutations(conversationId);
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [attachment, setAttachment] = useState<{ id: string; fileName: string } | null>(null);
  const [templateName, setTemplateName] = useState<string | null>(templates[0]?.name ?? null);
  const [params, setParams] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const now = useNow(windowOpen && closesAt !== null, 60_000);

  const template = templates.find((t) => t.name === templateName) ?? null;

  const reset = useCallback(() => {
    setBody('');
    setAttachment(null);
    setParams([]);
    setError(null);
  }, []);

  const submit = () => {
    setError(null);
    const payload: Record<string, unknown> = {};
    if (windowOpen) {
      if (body.trim() !== '') payload.body = body.trim();
      if (attachment !== null) payload.attachmentId = attachment.id;
      if (payload.body === undefined && payload.attachmentId === undefined) {
        setError('Type a message or attach a file.');
        return;
      }
    } else {
      if (template === null) {
        setError(
          'Choose an approved template. Free text is not allowed outside the 24 hour window.',
        );
        return;
      }
      payload.template = {
        name: template.name,
        language: template.language,
        params: params.slice(0, template.params),
      };
    }

    send.mutate(
      { id: conversationId, body: payload },
      {
        onSuccess: () => {
          reset();
        },
        onError: (e) => {
          // Meta returns the real reason (template not approved, window closed); show it verbatim.
          setError(errorMessage(e));
        },
      },
    );
  };

  if (disabled) {
    return (
      <div className="border-t border-border px-4 py-3 text-sm text-muted">
        {disabledReason ?? 'Sending is unavailable.'}
      </div>
    );
  }

  if (!windowOpen) {
    return (
      <div className="flex flex-col gap-2 border-t border-border px-4 py-3">
        <p className="text-sm text-muted">
          The 24 hour reply window has closed. Only an approved template can be sent until they
          message again.
        </p>

        {templates.length === 0 ? (
          <p className="rounded-sm border border-border bg-surface px-3 py-2 text-sm text-faint">
            GAP-05: no template list endpoint exists. Record the approved templates on the channel
            in settings before you can send outside the window.
          </p>
        ) : (
          <>
            <Select
              value={templateName}
              onChange={(v) => {
                setTemplateName(v);
                setParams([]);
              }}
              label="Template"
              options={templates.map((t) => ({
                value: t.name,
                label: `${t.name} (${t.language})`,
              }))}
            />
            {template?.body !== undefined && (
              <p className="rounded-sm border border-border bg-surface px-3 py-2 text-sm text-muted">
                {template.body}
              </p>
            )}
            {template !== null &&
              Array.from({ length: template.params }, (_, i) => (
                <Input
                  key={i}
                  label={`Placeholder ${String(i + 1)}`}
                  value={params[i] ?? ''}
                  onChange={(e) => {
                    setParams((p) => {
                      const next = [...p];
                      next[i] = e.target.value;
                      return next;
                    });
                  }}
                />
              ))}
          </>
        )}

        {error !== null && <p className="text-sm text-danger">{error}</p>}

        <div className="flex justify-end">
          <Button
            variant="primary"
            icon={Send}
            loading={send.isPending}
            disabled={templates.length === 0}
            onClick={submit}
          >
            Send template
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 border-t border-border px-4 py-3">
      {closesAt !== null && (
        <p className="text-xs text-faint">
          Window closes in {formatLeft(new Date(closesAt).getTime() - now)}.
        </p>
      )}

      <Textarea
        rows={2}
        value={body}
        maxLength={4096}
        placeholder="Type a message"
        aria-label="Message"
        onChange={(e) => {
          setBody(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            submit();
          }
        }}
      />

      {attachment !== null && (
        <div className="flex items-center gap-2 text-sm text-muted">
          <Paperclip size={12} aria-hidden />
          <span className="truncate">{attachment.fileName}</span>
          <button
            type="button"
            className="text-faint hover:text-fg"
            onClick={() => {
              setAttachment(null);
            }}
          >
            Remove
          </button>
        </div>
      )}

      {error !== null && <p className="text-sm text-danger">{error}</p>}

      <div className="flex items-center gap-2">
        <input
          ref={fileRef}
          type="file"
          className="sr-only"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file === undefined) return;
            upload.mutate(file, {
              onSuccess: (a) => {
                setAttachment({ id: a.id, fileName: a.fileName });
              },
              onError: (err) => {
                setError(errorMessage(err));
              },
            });
            e.target.value = '';
          }}
        />
        <IconButton
          icon={Paperclip}
          label="Attach a file"
          variant="ghost"
          onClick={() => {
            fileRef.current?.click();
          }}
        />
        {upload.isPending && <Spinner size={14} />}
        <span className="mono ml-auto text-xs text-faint">Ctrl + Enter to send</span>
        <Button variant="primary" icon={Send} loading={send.isPending} onClick={submit}>
          Send
        </Button>
      </div>
    </div>
  );
}

function formatLeft(ms: number): string {
  if (ms <= 0) return 'less than a minute';
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${String(minutes)} min`;
  const hours = Math.floor(minutes / 60);
  return `${String(hours)} h ${String(minutes % 60)} min`;
}

/* ── contact rail ───────────────────────────────────────────────────────────────────────── */

function ContactRail({ conversation }: { conversation: ConversationDto }) {
  const contact = useContact(conversation.contactId);
  const navigate = useNavigate();

  return (
    <aside className="hidden min-h-0 flex-col gap-3 overflow-y-auto border-l border-border pl-3 xl:flex">
      {conversation.contact === null ? (
        <Panel title="Unknown number">
          <div className="flex flex-col gap-3">
            <PhoneNumber e164={conversation.externalId} actions />
            <p className="text-sm text-muted">
              This number is not a contact yet. Creating one links the whole conversation history to
              it.
            </p>
            <Button
              variant="primary"
              size="sm"
              icon={UserPlus}
              onClick={() => {
                void navigate({
                  to: '/contacts',
                  search: { create: conversation.externalId } as never,
                });
              }}
            >
              Create contact
            </Button>
          </div>
        </Panel>
      ) : (
        <Panel
          title={conversation.contact.displayName}
          actions={
            <Button
              variant="ghost"
              size="sm"
              icon={UserRound}
              onClick={() => {
                void navigate(linkTo.contact(conversation.contact?.id ?? ''));
              }}
            >
              Open
            </Button>
          }
        >
          {contact.isPending ? (
            <Skeleton height={100} shape="block" />
          ) : contact.data === undefined ? (
            <p className="text-sm text-muted">Could not load the contact.</p>
          ) : (
            <DetailList
              items={[
                {
                  label: 'Phone',
                  value: (
                    <PhoneNumber
                      e164={contact.data.phones[0]?.e164 ?? null}
                      contactId={contact.data.id}
                      actions
                    />
                  ),
                },
                {
                  label: 'Company',
                  value:
                    contact.data.company === null ? (
                      <span className="text-faint">None</span>
                    ) : (
                      <span className="flex items-center gap-1.5">
                        <Building2 size={12} aria-hidden />
                        {contact.data.company.name}
                      </span>
                    ),
                },
                {
                  label: 'Owner',
                  value: contact.data.owner?.name ?? <span className="text-faint">Unassigned</span>,
                },
                {
                  label: 'Tags',
                  value:
                    contact.data.tags.length === 0 ? (
                      <span className="text-faint">None</span>
                    ) : (
                      <span className="flex flex-wrap gap-1">
                        {contact.data.tags.map((t) => (
                          <Badge key={t} tone="neutral">
                            {t}
                          </Badge>
                        ))}
                      </span>
                    ),
                },
              ]}
            />
          )}
        </Panel>
      )}

      <Panel title="Conversation">
        <DetailList
          items={[
            { label: 'Channel', value: conversation.channel.name },
            { label: 'Status', value: <span className="capitalize">{conversation.status}</span> },
            {
              label: 'Assignee',
              value: conversation.assignee?.name ?? <span className="text-faint">Unassigned</span>,
            },
            { label: 'Last inbound', value: <DateTime value={conversation.lastInboundAt} /> },
            { label: 'Started', value: <DateTime value={conversation.createdAt} /> },
          ]}
        />
      </Panel>
    </aside>
  );
}

/* ── start a conversation ───────────────────────────────────────────────────────────────── */

function StartConversationDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const navigate = useNavigate();
  const channels = useChannels();
  const { start } = useConversationMutations();
  const [contactId, setContactId] = useState<string | null>(null);
  const [channelId, setChannelId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const active = (channels.data ?? []).filter((c) => c.isActive);

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="New conversation"
      description="POST /conversations"
      width={460}
      footer={
        <>
          <Button
            variant="ghost"
            onClick={() => {
              onOpenChange(false);
            }}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={start.isPending}
            onClick={() => {
              if (contactId === null || channelId === null) {
                setError('Choose a contact and a channel.');
                return;
              }
              start.mutate(
                { channelId, contactId },
                {
                  onSuccess: (c) => {
                    onOpenChange(false);
                    void navigate(linkTo.conversation(c.id));
                  },
                  onError: (e) => {
                    setError(errorMessage(e));
                  },
                },
              );
            }}
          >
            Start
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <ContactPicker value={contactId} onChange={setContactId} required />
        <Select
          label="Channel"
          value={channelId}
          onChange={setChannelId}
          options={active.map((c) => ({ value: c.id, label: `${c.name} (${c.type})` }))}
          description={active.length === 0 ? 'No active channel is configured yet.' : undefined}
        />
        {error !== null && <p className="text-sm text-danger">{error}</p>}
      </div>
    </Dialog>
  );
}

export { Check, Filter, Phone };
