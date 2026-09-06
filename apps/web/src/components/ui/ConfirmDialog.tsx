/**
 * ConfirmDialog and its typed-confirmation variant (Component Inventory · App shell).
 * `consequences` is what makes the role-change, deactivate and erase dialogs honest.
 */
import { TriangleAlert } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useResetWhen } from '@/lib/hooks';
import { Button } from './Button';
import { Input } from './Input';
import { Dialog } from './Overlay';

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  /** e.g. "DELETE" — the confirm button stays disabled until it is typed exactly. */
  typedConfirmation?: string;
  consequences?: string[];
  tone?: 'danger' | 'primary';
  loading?: boolean;
  onConfirm: () => void | Promise<void>;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel = 'Cancel',
  typedConfirmation,
  consequences,
  tone = 'danger',
  loading = false,
  onConfirm,
}: ConfirmDialogProps) {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  useResetWhen(open, () => {
    if (!open) return;
    setTyped('');
    setBusy(false);
  });

  const ready = typedConfirmation === undefined || typed === typedConfirmation;
  const pending = loading || busy;

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
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
            {cancelLabel}
          </Button>
          <Button
            variant={tone === 'danger' ? 'danger' : 'primary'}
            disabled={!ready}
            loading={pending}
            onClick={() => {
              void (async () => {
                setBusy(true);
                try {
                  await onConfirm();
                } finally {
                  setBusy(false);
                }
              })();
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 text-base">
        <p className="text-muted">{description}</p>
        {consequences !== undefined && consequences.length > 0 && (
          <ul className="flex flex-col gap-1.5 rounded-md bg-[var(--warning-subtle)] p-3">
            {consequences.map((c) => (
              <li key={c} className="flex items-start gap-2 text-sm">
                <TriangleAlert size={13} className="mt-0.5 shrink-0 text-warning" aria-hidden />
                <span>{c}</span>
              </li>
            ))}
          </ul>
        )}
        {typedConfirmation !== undefined && (
          <Input
            autoFocus
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
        )}
      </div>
    </Dialog>
  );
}
