/**
 * NoteComposer and NoteList (Component Inventory · Entity components).
 * Plain text with @contact and #deal mentions that linkify on save; cursor paginated.
 */
import type { AttachmentDto, NoteDto } from '@crm/shared';
import { Paperclip, Pencil, Pin, StickyNote, Trash2, X } from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';
import { Avatar } from '@/components/ui/Avatar';
import { Button, IconButton } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Textarea } from '@/components/ui/Input';
import { Skeleton } from '@/components/ui/Loading';
import { toast } from '@/components/ui/toast';
import { DateTime } from '@/components/data/formatters';
import { EmptyState } from '@/components/data/states';
import { useNoteMutations, useNotes, type TimelineParent } from '@/features/activity/api';
import { errorMessage } from '@/lib/api/errors';
import { formatBytes, useUploadAttachment } from '@/lib/api/attachments';
import { useMe } from '@/lib/auth/me';
import { cn } from '@/lib/utils';

export interface NotesPanelProps {
  parent: TimelineParent | 'call';
  id: string;
  canCreate: boolean;
  className?: string;
}

export function NotesPanel({ parent, id, canCreate, className }: NotesPanelProps) {
  const list = useNotes(parent, id);
  const { create } = useNoteMutations(parent, id);
  const [body, setBody] = useState('');
  // Files are uploaded as they are picked, so saving the note is one quick request and a slow
  // upload never looks like a slow save. Until the note is saved these are unbound and harmless.
  const [pending, setPending] = useState<AttachmentDto[]>([]);
  const upload = useUploadAttachment();
  const fileInput = useRef<HTMLInputElement>(null);
  const notes = list.data?.pages.flatMap((p) => p.data) ?? [];

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      {canCreate && (
        <div className="flex flex-col gap-2">
          <Textarea
            value={body}
            onChange={(e) => {
              setBody(e.target.value);
            }}
            rows={2}
            maxLength={20000}
            placeholder="Add a note. Use @ to mention a contact and # to mention a deal."
            aria-label="New note"
          />
          {pending.length > 0 && (
            <ul className="flex flex-wrap gap-2">
              {pending.map((a) => (
                <li
                  key={a.id}
                  className="flex items-center gap-1.5 rounded-sm border border-border bg-bg px-2 py-1 text-sm"
                >
                  <Paperclip size={12} className="shrink-0 text-muted" aria-hidden />
                  <span className="max-w-[18ch] truncate">{a.fileName}</span>
                  <span className="text-faint">{formatBytes(a.sizeBytes)}</span>
                  <IconButton
                    icon={X}
                    size={26}
                    variant="ghost"
                    label={`Remove ${a.fileName}`}
                    onClick={() => {
                      setPending((prev) => prev.filter((p) => p.id !== a.id));
                    }}
                  />
                </li>
              ))}
            </ul>
          )}

          <div className="flex items-center justify-between gap-2">
            <input
              ref={fileInput}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                const files = [...(e.target.files ?? [])];
                e.target.value = '';
                for (const file of files) {
                  upload.mutate(file, {
                    onSuccess: (a) => {
                      setPending((prev) => [...prev, a]);
                    },
                    onError: (err) => {
                      toast({
                        tone: 'danger',
                        title: 'Could not attach that file',
                        description: errorMessage(err),
                      });
                    },
                  });
                }
              }}
            />
            <Button
              variant="ghost"
              size="sm"
              icon={Paperclip}
              loading={upload.isPending}
              onClick={() => fileInput.current?.click()}
            >
              Attach
            </Button>
            <Button
              variant="primary"
              size="sm"
              className="self-end"
              disabled={body.trim() === '' && pending.length === 0}
              loading={create.isPending}
              onClick={() => {
                create.mutate(
                  {
                    body: body.trim() === '' ? '(attachment)' : body.trim(),
                    [`${parent}Id`]: id,
                    ...(pending.length > 0 ? { attachmentIds: pending.map((a) => a.id) } : {}),
                  },
                  {
                    onSuccess: () => {
                      setBody('');
                      setPending([]);
                    },
                    onError: (e) => {
                      toast({
                        tone: 'danger',
                        title: 'Could not save the note',
                        description: errorMessage(e),
                      });
                    },
                  },
                );
              }}
            >
              Save note
            </Button>
          </div>
        </div>
      )}

      {list.isPending && <Skeleton count={3} height={48} shape="block" className="mb-2" />}

      {!list.isPending && notes.length === 0 && (
        <EmptyState
          compact
          object="pencil"
          title="No notes yet"
          description="Notes are the fastest way to leave context for whoever picks this up next."
        />
      )}

      <ul className="flex flex-col gap-3">
        {notes.map((n) => (
          <NoteRow key={n.id} note={n} parent={parent} parentId={id} />
        ))}
      </ul>

      {list.hasNextPage && (
        <Button
          variant="secondary"
          size="sm"
          className="self-center"
          loading={list.isFetchingNextPage}
          onClick={() => {
            void list.fetchNextPage();
          }}
        >
          Load older
        </Button>
      )}
    </div>
  );
}

function NoteRow({
  note,
  parent,
  parentId,
}: {
  note: NoteDto;
  parent: TimelineParent | 'call';
  parentId: string;
}) {
  const me = useMe();
  const { update, remove } = useNoteMutations(parent, parentId);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note.body);
  const [confirming, setConfirming] = useState(false);
  const mine = note.authorId === me.id || me.role === 'admin';

  return (
    <li className="rounded-md border border-border bg-surface p-3">
      <div className="flex items-start gap-2.5">
        <Avatar name={note.author.name} seed={note.authorId} size={24} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
            <span className="font-medium text-text">{note.author.name}</span>
            <span className="text-muted">
              <DateTime value={note.createdAt} bare />
              {note.updatedAt !== note.createdAt && ' · edited'}
            </span>
            {note.pinned && <Pin size={11} className="text-flare" aria-hidden />}
          </div>
          {note.attachments.length > 0 && <AttachmentList items={note.attachments} />}
          {editing ? (
            <div className="mt-2 flex flex-col gap-2">
              <Textarea
                value={draft}
                onChange={(e) => {
                  setDraft(e.target.value);
                }}
                rows={3}
                maxLength={20000}
              />
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="primary"
                  loading={update.isPending}
                  onClick={() => {
                    update.mutate(
                      { noteId: note.id, body: { body: draft.trim() } },
                      {
                        onSuccess: () => {
                          setEditing(false);
                        },
                      },
                    );
                  }}
                >
                  Save
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setDraft(note.body);
                    setEditing(false);
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <p className="mt-1 text-base break-words whitespace-pre-wrap">{linkify(note.body)}</p>
          )}
        </div>
        {mine && !editing && (
          <span className="flex shrink-0 gap-0.5">
            <IconButton
              icon={Pencil}
              label="Edit note"
              size={26}
              variant="ghost"
              onClick={() => {
                setEditing(true);
              }}
            />
            <IconButton
              icon={Trash2}
              label="Delete note"
              size={26}
              variant="danger"
              onClick={() => {
                setConfirming(true);
              }}
            />
          </span>
        )}
      </div>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Delete this note?"
        description="The note is removed from the timeline. This cannot be undone."
        confirmLabel="Delete note"
        loading={remove.isPending}
        onConfirm={() => {
          remove.mutate(note.id, {
            onSuccess: () => {
              setConfirming(false);
            },
          });
        }}
      />
    </li>
  );
}

/** @mentions and #deals are highlighted; they are plain text on the wire. */
function linkify(body: string): ReactNode {
  const parts = body.split(/(@[\w'’. -]{2,40}|#[\w'’. -]{2,40})/g);
  return parts.map((part, i) =>
    part.startsWith('@') || part.startsWith('#') ? (
      <span key={i} className="text-[color:var(--flare-link)]">
        {part}
      </span>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}

export { StickyNote };

/**
 * Images are shown, because recognising a screenshot at a glance is the point of attaching one.
 * Everything else is a labelled link: the API serves those with a download disposition, so a
 * document or archive can never render in place.
 */
function AttachmentList({ items }: { items: AttachmentDto[] }) {
  const images = items.filter((a) => a.mimeType.startsWith('image/'));
  const rest = items.filter((a) => !a.mimeType.startsWith('image/'));
  return (
    <div className="mt-2 flex flex-col gap-2">
      {images.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {images.map((a) => (
            <li key={a.id}>
              <a href={a.url} target="_blank" rel="noreferrer" title={a.fileName}>
                <img
                  src={a.url}
                  alt={a.fileName}
                  loading="lazy"
                  className="h-20 w-20 rounded-sm border border-border object-cover"
                />
              </a>
            </li>
          ))}
        </ul>
      )}
      {rest.length > 0 && (
        <ul className="flex flex-col gap-1">
          {rest.map((a) => (
            <li key={a.id}>
              <a
                href={a.url}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1.5 text-sm underline-offset-2 hover:underline"
              >
                <Paperclip size={12} className="shrink-0 text-muted" aria-hidden />
                <span className="min-w-0 truncate">{a.fileName}</span>
                <span className="shrink-0 text-faint">{formatBytes(a.sizeBytes)}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
