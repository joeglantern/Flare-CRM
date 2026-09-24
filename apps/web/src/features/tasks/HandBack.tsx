/**
 * Handing a task back, and the task's own history of who gave it to whom.
 *
 * A hand-back always carries a reason: the person it returns to has to decide what to do with the
 * task next, and "not mine" on its own does not help them do that.
 */
import { declineTaskBody, type TaskDto, type TaskEventDto } from '@crm/shared';
import { Undo2 } from 'lucide-react';
import { useState } from 'react';
import { useResetWhen } from '@/lib/hooks';
import { Button } from '@/components/ui/Button';
import { Textarea } from '@/components/ui/Input';
import { Skeleton } from '@/components/ui/Loading';
import { Dialog } from '@/components/ui/Overlay';
import { toast } from '@/components/ui/toast';
import { DateTime } from '@/components/data/formatters';
import { errorMessage, isApiError } from '@/lib/api/errors';
import { useHandBackTask, useTaskHistory } from './api';

export function HandBackDialog({
  open,
  onOpenChange,
  task,
  to,
  onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  task: TaskDto;
  to: { id: string; name: string };
  onDone?: (t: TaskDto) => void;
}) {
  const handBack = useHandBackTask();
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);

  useResetWhen(open ? task.id : null, () => {
    if (!open) return;
    setNote('');
    setError(undefined);
  });

  const submit = () => {
    const parsed = declineTaskBody.safeParse({ note });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Say why you are handing it back');
      return;
    }
    setError(undefined);
    handBack.mutate(
      { id: task.id, body: parsed.data },
      {
        onSuccess: (t) => {
          toast({ tone: 'success', title: `Handed back to ${to.name}`, description: t.title });
          onOpenChange(false);
          onDone?.(t);
        },
        onError: (e) => {
          if (isApiError(e) && e.fieldIssues.length > 0) {
            setError(e.fieldIssues[0]?.message);
            return;
          }
          toast({
            tone: 'danger',
            title: 'Could not hand the task back',
            description: errorMessage(e),
          });
        },
      },
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Hand this task back"
      description={`It goes back to ${to.name}, who gave it to you, and they are told why.`}
      width={480}
      dismissable={!handBack.isPending}
      footer={
        <>
          <Button
            variant="ghost"
            disabled={handBack.isPending}
            onClick={() => {
              onOpenChange(false);
            }}
          >
            Keep it
          </Button>
          <Button variant="primary" icon={Undo2} loading={handBack.isPending} onClick={submit}>
            Hand back
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        noValidate
      >
        <p className="text-base">
          <span className="text-muted">Task: </span>
          <span className="font-medium">{task.title}</span>
        </p>
        <Textarea
          autoFocus
          label="Why are you handing it back?"
          description="For example: it belongs to another desk, or you will be away when it is due."
          required
          rows={4}
          maxLength={2000}
          value={note}
          error={error}
          onChange={(e) => {
            setNote(e.target.value);
          }}
        />
      </form>
    </Dialog>
  );
}

/** The latest hand-back, shown to the person the task came back to. */
export function HandedBackNotice({ task }: { task: TaskDto }) {
  if (task.handedBack === null) return null;
  return (
    <div className="rounded-sm border border-border bg-[var(--warning-subtle)] px-3 py-2 text-base">
      <p className="flex items-center gap-1.5 font-medium">
        <Undo2 size={14} className="text-warning" aria-hidden />
        {task.handedBack.by.name} handed this back
        <span className="font-normal text-muted">
          · <DateTime value={task.handedBack.at} mode="relative" />
        </span>
      </p>
      <p className="mt-1 whitespace-pre-wrap break-words">{task.handedBack.note}</p>
    </div>
  );
}

function describe(e: TaskEventDto): string {
  const actor = e.actor?.name ?? 'Someone';
  if (e.kind === 'handed_back') return `${actor} handed it back to ${e.to?.name ?? 'someone'}`;
  if (e.to === null) return `${actor} unassigned it`;
  if (e.actor !== null && e.actor.id === e.to.id) return `${actor} took it`;
  return `${actor} gave it to ${e.to.name}`;
}

export function TaskHistory({ taskId }: { taskId: string }) {
  const history = useTaskHistory(taskId);
  if (history.isPending) return <Skeleton height={40} shape="block" />;
  if (history.isError || history.data.length === 0) return null;
  return (
    <section aria-label="Task history" className="flex flex-col gap-1.5">
      <h3 className="text-sm font-medium text-muted">History</h3>
      <ol className="flex flex-col gap-1.5 border-l border-border pl-3">
        {history.data.map((e) => (
          <li key={e.id} className="text-base">
            <span>{describe(e)}</span>
            <span className="text-sm text-faint">
              {' '}
              · <DateTime value={e.at} mode="relative" />
            </span>
            {e.note !== null && (
              <p className="mt-0.5 whitespace-pre-wrap break-words text-muted">
                &ldquo;{e.note}&rdquo;
              </p>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
