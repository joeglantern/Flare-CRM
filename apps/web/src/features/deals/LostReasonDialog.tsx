/**
 * Asks for the lost reason before a deal moves into a lost stage.
 *
 * The reason travels in the same POST /deals/:id/stage request that moves the deal. There is no
 * endpoint that adds a reason afterwards, so this has to be asked before the move, not after.
 */
import { useState } from 'react';
import { useResetWhen } from '@/lib/hooks';
import { Button } from '@/components/ui/Button';
import { Textarea } from '@/components/ui/Input';
import { Dialog } from '@/components/ui/Overlay';

export function LostReasonDialog({
  open,
  onOpenChange,
  loading,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  loading: boolean;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');

  useResetWhen(open, () => {
    if (open) setReason('');
  });

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Why was it lost?"
      description="Written with the stage change. It cannot be added later."
      width={440}
      dismissable={!loading}
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
            loading={loading}
            onClick={() => {
              onConfirm(reason.trim());
            }}
          >
            Mark lost
          </Button>
        </>
      }
    >
      <Textarea
        autoFocus
        name="lostReason"
        label="Reason"
        rows={3}
        maxLength={300}
        value={reason}
        onChange={(e) => {
          setReason(e.target.value);
        }}
        description="Optional, but it is what makes the loss report useful."
      />
    </Dialog>
  );
}
