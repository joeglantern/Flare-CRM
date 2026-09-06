/**
 * NoteComposer and NoteList (Component Inventory · Entity components).
 * Plain text with @contact and #deal mentions that linkify on save; cursor paginated.
 */
import type { NoteDto } from '@crm/shared';
import { Pencil, Pin, StickyNote, Trash2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
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
          <Button
            variant="primary"
            size="sm"
            className="self-end"
            disabled={body.trim() === ''}
            loading={create.isPending}
            onClick={() => {
              create.mutate(
                { body: body.trim(), [`${parent}Id`]: id },
                {
                  onSuccess: () => {
                    setBody('');
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
