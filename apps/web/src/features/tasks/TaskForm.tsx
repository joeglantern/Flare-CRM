/**
 * Task create and edit dialog (Tasks · Create / Edit).
 * Validation from the shared schema; a 422 lands on the field the server named.
 */
import { createTaskBody, updateTaskBody, type TaskDto } from '@crm/shared';
import { useMemo, useState } from 'react';
import { useResetWhen } from '@/lib/hooks';
import { Button } from '@/components/ui/Button';
import { Input, Textarea } from '@/components/ui/Input';
import { Dialog } from '@/components/ui/Overlay';
import { Select } from '@/components/ui/Select';
import { toast } from '@/components/ui/toast';
import { ContactPicker, OwnerPicker } from '@/components/entity/pickers';
import { errorMessage, isApiError } from '@/lib/api/errors';
import { useMe } from '@/lib/auth/me';
import { usePermissions } from '@/providers/permissions';
import { useCreateTask, useUpdateTask } from './api';

export interface TaskDefaults {
  contactId?: string | null;
  dealId?: string | null;
  companyId?: string | null;
  dueAt?: string;
  title?: string;
  type?: string;
  /** Links the task back to the call it came out of. Create only; the server owns it after that. */
  sourceCallId?: string;
}

interface TaskFormState {
  title: string;
  type: string;
  priority: string;
  dueAt: string;
  assigneeId: string | null;
  contactId: string | null;
  dealId: string | null;
  description: string;
  remindMinutes: number | null;
}

export function TaskFormDialog({
  open,
  onOpenChange,
  task,
  defaults,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  task?: TaskDto;
  defaults?: TaskDefaults;
  onSaved?: (t: TaskDto) => void;
}) {
  const me = useMe();
  const perms = usePermissions();
  const create = useCreateTask();
  const update = useUpdateTask();
  const editing = task !== undefined;

  const initial = useMemo<TaskFormState>(
    () => ({
      title: task?.title ?? defaults?.title ?? '',
      type: task?.type ?? defaults?.type ?? 'call',
      priority: task?.priority ?? 'normal',
      dueAt: (task?.dueAt ?? defaults?.dueAt ?? defaultDue()).slice(0, 16),
      assigneeId: task?.assigneeId ?? me.id,
      contactId: task?.contact?.id ?? defaults?.contactId ?? null,
      dealId: task?.deal?.id ?? defaults?.dealId ?? null,
      description: task?.description ?? '',
      remindMinutes:
        task?.remindAt !== null && task?.dueAt != null
          ? minutesBefore(task.dueAt, task.remindAt)
          : null,
    }),
    [task, defaults, me.id],
  );

  const [form, setForm] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useResetWhen(open ? initial : null, () => {
    if (!open) return;
    setForm(initial);
    setErrors({});
  });

  const pending = create.isPending || update.isPending;

  const submit = () => {
    const body: Record<string, unknown> = {
      title: form.title.trim(),
      type: form.type,
      priority: form.priority,
      dueAt: form.dueAt === '' ? null : new Date(form.dueAt).toISOString(),
      assigneeId: form.assigneeId,
      contactId: form.contactId,
      dealId: form.dealId,
      description: form.description.trim() === '' ? null : form.description.trim(),
      remindAt: remindAtFrom(form.dueAt, form.remindMinutes),
    };
    if (defaults?.companyId != null && !editing) body.companyId = defaults.companyId;
    if (defaults?.sourceCallId != null && !editing) body.sourceCallId = defaults.sourceCallId;

    const parsed = (editing ? updateTaskBody : createTaskBody).safeParse(body);
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const i of parsed.error.issues) next[i.path.join('.')] = i.message;
      setErrors(next);
      return;
    }
    setErrors({});

    const onError = (e: unknown) => {
      if (isApiError(e) && e.fieldIssues.length > 0) {
        const next: Record<string, string> = {};
        for (const i of e.fieldIssues) next[i.path] = i.message;
        setErrors(next);
        return;
      }
      toast({ tone: 'danger', title: 'Could not save the task', description: errorMessage(e) });
    };

    const onSuccess = (t: TaskDto) => {
      toast({
        tone: 'success',
        title: editing ? 'Task saved' : 'Task created',
        description: t.title,
      });
      onOpenChange(false);
      onSaved?.(t);
    };

    if (editing) update.mutate({ id: task.id, body: parsed.data }, { onSuccess, onError });
    else create.mutate(parsed.data, { onSuccess, onError });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={editing ? 'Edit task' : 'New task'}
      width={520}
      dismissable={!pending}
      footer={
        <>
          <Button
            variant="ghost"
            disabled={pending}
            onClick={() => {
              onOpenChange(false);
            }}
          >
            Cancel
          </Button>
          <Button variant="primary" loading={pending} onClick={submit}>
            {editing ? 'Save changes' : 'Create task'}
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
        <Input
          autoFocus
          name="title"
          label="Title"
          required
          value={form.title}
          error={errors.title}
          onChange={(e) => {
            setForm((f) => ({ ...f, title: e.target.value }));
          }}
        />
        <div className="grid gap-3 sm:grid-cols-3">
          <Select
            label="Type"
            value={form.type}
            onChange={(v) => {
              setForm((f) => ({ ...f, type: v }));
            }}
            options={[
              { value: 'call', label: 'Call' },
              { value: 'follow_up', label: 'Follow up' },
              { value: 'meeting', label: 'Meeting' },
              { value: 'email', label: 'Email' },
              { value: 'other', label: 'Other' },
            ]}
          />
          <Select
            label="Priority"
            value={form.priority}
            onChange={(v) => {
              setForm((f) => ({ ...f, priority: v }));
            }}
            options={[
              { value: 'high', label: 'High' },
              { value: 'normal', label: 'Normal' },
              { value: 'low', label: 'Low' },
            ]}
          />
          <Input
            name="dueAt"
            type="datetime-local"
            label="Due"
            value={form.dueAt}
            error={errors.dueAt}
            onChange={(e) => {
              setForm((f) => ({ ...f, dueAt: e.target.value }));
            }}
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <OwnerPicker
            label="Assignee"
            value={form.assigneeId}
            allowClear={false}
            disabled={!perms.has('task:assign')}
            error={errors.assigneeId}
            onChange={(v) => {
              setForm((f) => ({ ...f, assigneeId: v ?? me.id }));
            }}
          />
          <ContactPicker
            value={form.contactId}
            error={errors.contactId}
            onChange={(v) => {
              setForm((f) => ({ ...f, contactId: v }));
            }}
          />
        </div>
        <Select
          label="Reminder"
          value={form.remindMinutes === null ? 'none' : String(form.remindMinutes)}
          onChange={(v) => {
            setForm((f) => ({ ...f, remindMinutes: v === 'none' ? null : Number(v) }));
          }}
          options={[
            { value: 'none', label: 'No reminder' },
            { value: '10', label: '10 minutes before' },
            { value: '30', label: '30 minutes before' },
            { value: '60', label: '1 hour before' },
            { value: '1440', label: '1 day before' },
          ]}
        />
        <Textarea
          label="Description"
          value={form.description}
          rows={3}
          maxLength={5000}
          error={errors.description}
          onChange={(e) => {
            setForm((f) => ({ ...f, description: e.target.value }));
          }}
        />
      </form>
    </Dialog>
  );
}

/** The API stores an absolute reminder time; the UI offers the familiar "N before" choices. */
function remindAtFrom(dueLocal: string, minutes: number | null): string | null {
  if (minutes === null || dueLocal === '') return null;
  return new Date(new Date(dueLocal).getTime() - minutes * 60_000).toISOString();
}

function minutesBefore(dueAt: string, remindAt: string): number {
  return Math.round((new Date(dueAt).getTime() - new Date(remindAt).getTime()) / 60_000);
}

function defaultDue(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  return d.toISOString();
}
