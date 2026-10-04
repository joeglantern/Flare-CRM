/**
 * Settings, Telephony: a rehearsal of the call popup.
 *
 * Checking the popup used to need a real call from a real phone. This asks the server to send this
 * person the popup that a call from the given number would produce, through the same contact
 * lookup and the same socket, so what appears is what a real call would show. Nothing is recorded:
 * no call, no notification, nothing on the live board.
 */
import type { PopupPreviewBody } from '@crm/shared';
import { useMutation } from '@tanstack/react-query';
import { PhoneIncoming } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { toast } from '@/components/ui/toast';
import { Panel } from '@/components/entity/EntityHeader';
import { http } from '@/lib/api/client';
import { errorMessage } from '@/lib/api/errors';

type Stage = 'ringing' | 'answered';

export function PopupPreviewPanel() {
  const [number, setNumber] = useState('');
  const [current, setCurrent] = useState<{ pbxCallId: string; stage: Stage } | null>(null);

  const send = useMutation({
    mutationFn: (body: PopupPreviewBody) =>
      http.post<{ pbxCallId: string }>('/api/v1/cti/popup-preview', body),
    onSuccess: (data, body) => {
      setCurrent(body.stage === 'ended' ? null : { pbxCallId: data.pbxCallId, stage: body.stage });
    },
    onError: (err) => {
      toast({ tone: 'danger', title: 'Could not preview', description: errorMessage(err) });
    },
  });

  const trimmed = number.trim();

  return (
    <Panel
      title="Preview the call popup"
      note="Only you see it. Nothing is logged, and no phone rings."
    >
      <div className="flex flex-col gap-3">
        <Input
          label="Caller number"
          mono
          placeholder="0712 345 678"
          description="A saved contact's number shows their details. Any other number shows the unknown caller popup."
          value={number}
          disabled={current !== null}
          onChange={(e) => {
            setNumber(e.target.value);
          }}
        />
        <div className="flex flex-wrap gap-2">
          {current === null ? (
            <Button
              variant="primary"
              icon={PhoneIncoming}
              disabled={trimmed.length < 3}
              loading={send.isPending}
              onClick={() => {
                send.mutate({ stage: 'ringing', number: trimmed });
              }}
            >
              Show the popup
            </Button>
          ) : (
            <>
              {current.stage === 'ringing' && (
                <Button
                  variant="secondary"
                  loading={send.isPending}
                  onClick={() => {
                    send.mutate({ stage: 'answered', pbxCallId: current.pbxCallId });
                  }}
                >
                  Pretend it was answered
                </Button>
              )}
              <Button
                variant="secondary"
                loading={send.isPending}
                onClick={() => {
                  send.mutate({ stage: 'ended', pbxCallId: current.pbxCallId });
                }}
              >
                End the preview
              </Button>
            </>
          )}
        </div>
      </div>
    </Panel>
  );
}
