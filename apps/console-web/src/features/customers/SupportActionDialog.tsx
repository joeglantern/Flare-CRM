/**
 * The confirmation for a support action, which is ConfirmDialog plus the one thing it cannot carry:
 * a reason, in a person's own words.
 *
 * The reason is not for us. It is written into the customer's own audit log alongside the action, so
 * when their administrator finds a provider-initiated reset in their log six weeks later, the row
 * says "she rang about a lost phone" rather than only naming us and the hour. The action says what
 * happened; the reason is the only part that says it was their own colleague who asked. That is why
 * it is required here even though the server will accept it missing.
 *
 * Everything else matches ConfirmDialog deliberately, down to the consequence list, so this reads as
 * the same control with one more field rather than as a different kind of dialog.
 */
import { TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { Button, Dialog, Input, Textarea } from '@crm/ui';

/** The customer's own audit row is capped at this, so the field is too rather than failing later. */
const REASON_MAX = 300;

export interface SupportActionDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  description: string;
  consequences: string[];
  confirmLabel: string;
  /** Typed out before the action is allowed: the person's own address, not a word like DELETE. */
  typedConfirmation: string;
  loading: boolean;
  onConfirm: (reason: string) => void;
}

export function SupportActionDialog(props: SupportActionDialogProps) {
  if (!props.open) return null;
  // Mounted only while open, so the reason and the typed address never survive into the next person.
  return <SupportActionForm {...props} />;
}

function SupportActionForm({
  onOpenChange,
  title,
  description,
  consequences,
  confirmLabel,
  typedConfirmation,
  loading,
  onConfirm,
}: SupportActionDialogProps) {
  const [reason, setReason] = useState('');
  const [typed, setTyped] = useState('');

  const ready = reason.trim() !== '' && typed === typedConfirmation;

  return (
    <Dialog
      open
      onOpenChange={onOpenChange}
      title={title}
      dismissable={!loading}
      width={560}
      footer={
        <>
          <Button
            variant="ghost"
            disabled={loading}
            onClick={() => {
              onOpenChange(false);
            }}
          >
            Cancel
          </Button>
          <Button
            variant="danger"
            disabled={!ready}
            loading={loading}
            onClick={() => {
              onConfirm(reason.trim());
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 text-base">
        <p className="text-muted">{description}</p>

        {consequences.length > 0 && (
          <ul className="flex flex-col gap-1.5 rounded-md bg-[var(--warning-subtle)] p-3">
            {consequences.map((c) => (
              <li key={c} className="flex items-start gap-2 text-sm">
                <TriangleAlert size={13} className="mt-0.5 shrink-0 text-warning" aria-hidden />
                <span>{c}</span>
              </li>
            ))}
          </ul>
        )}

        <Textarea
          autoFocus
          label="Why are you doing this?"
          description="This goes into the customer's own audit log word for word, and is what tells them it was one of their own people who asked."
          rows={2}
          maxLength={REASON_MAX}
          placeholder="She rang about a lost phone and could not get past the code."
          value={reason}
          onChange={(e) => {
            setReason(e.target.value);
          }}
        />

        <Input
          mono
          value={typed}
          onChange={(e) => {
            setTyped(e.target.value);
          }}
          label={
            <>
              Type <strong className="mono font-medium text-text">{typedConfirmation}</strong> to
              confirm
            </>
          }
        />
      </div>
    </Dialog>
  );
}
