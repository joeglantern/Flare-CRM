/**
 * DispositionForm (Component Inventory · Telephony), used in the popup and on call detail.
 * Disposition chips, a note and the suggest-follow-up checkbox. Skip leaves the disposition null
 * — a disposition is never invented — and the call then shows in the "needs a disposition" count.
 */
import { Check } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Checkbox } from '@/components/ui/Toggle';
import { Textarea } from '@/components/ui/Input';
import { toast } from '@/components/ui/toast';
import { errorMessage } from '@/lib/api/errors';
import { useCreateTask } from '@/features/tasks/api';
import { cn } from '@/lib/utils';
import { useDispositions, useSetDisposition } from './api';

export function DispositionForm({
  callId,
  contactId,
  suggestFollowUp = false,
  summary,
  initial,
  onDone,
  compact = true,
}: {
  callId: string;
  contactId?: string | null;
  suggestFollowUp?: boolean;
  summary?: string;
  initial?: { dispositionId: string | null; note: string };
  onDone?: () => void;
  compact?: boolean;
}) {
  const dispositions = useDispositions();
  const save = useSetDisposition();
  const createTask = useCreateTask();
  const [dispositionId, setDispositionId] = useState<string | null>(initial?.dispositionId ?? null);
  const [note, setNote] = useState(initial?.note ?? '');
  const [followUp, setFollowUp] = useState(suggestFollowUp);

  const active = (dispositions.data ?? []).filter((d) => d.isActive);

  const submit = () => {
    save.mutate(
      { callId, dispositionId, note: note.trim() === '' ? null : note.trim() },
      {
        onSuccess: () => {
          if (followUp) {
            const due = new Date();
            due.setDate(due.getDate() + 1);
            due.setHours(9, 0, 0, 0);
            createTask.mutate({
              title: 'Follow-up call',
              type: 'call',
              dueAt: due.toISOString(),
              ...(contactId != null ? { contactId } : {}),
            });
          }
          toast({ tone: 'success', title: 'Call logged' });
          onDone?.();
        },
        onError: (e) => {
          toast({
            tone: 'danger',
            title: 'Could not save the disposition',
            description: errorMessage(e),
          });
        },
      },
    );
  };

  return (
    <div className="flex flex-col gap-2.5">
      {summary !== undefined && <p className="text-sm text-muted">{summary}</p>}
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Disposition">
        {active.map((d) => {
          const on = d.id === dispositionId;
          return (
            <button
              key={d.id}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => {
                setDispositionId(on ? null : d.id);
              }}
              className={cn(
                'h-7 rounded-full border px-2.5 text-sm whitespace-nowrap',
                on
                  ? 'border-flare bg-[var(--flare-subtle)] font-medium text-flare-on'
                  : 'border-strong text-text hover:bg-hover',
              )}
            >
              {d.name}
            </button>
          );
        })}
        {active.length === 0 && !dispositions.isPending && (
          <span className="text-sm text-muted">No dispositions configured.</span>
        )}
      </div>

      <Textarea
        value={note}
        onChange={(e) => {
          setNote(e.target.value);
        }}
        rows={compact ? 2 : 3}
        maxLength={2000}
        placeholder="What happened on this call?"
        aria-label="Call note"
      />

      {contactId != null && (
        <Checkbox
          checked={followUp}
          onChange={setFollowUp}
          label="Create a follow-up task"
          description="Tomorrow 09:00, assigned to me"
        />
      )}

      <div className="flex items-center gap-2">
        {onDone !== undefined && (
          <Button variant="ghost" onClick={onDone}>
            Skip
          </Button>
        )}
        <Button
          variant="primary"
          icon={Check}
          className="ml-auto"
          loading={save.isPending}
          onClick={submit}
        >
          Save
        </Button>
      </div>
    </div>
  );
}
