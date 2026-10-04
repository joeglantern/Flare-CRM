/**
 * "Test call": a rehearsal of the call popup, for demos and for checking it without a phone.
 *
 * It asks for a number, then the server sends this person the popup a real call from that number
 * would produce, through the same contact lookup and the same socket. The test popup carries its
 * own Answer and End buttons, so the whole call can be walked through from wherever it was started.
 * Nothing is recorded and no phone rings.
 */
import { ExternalLink, PhoneIncoming } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Dialog } from '@/components/ui/Overlay';
import { toast } from '@/components/ui/toast';
import { useContacts } from '@/features/contacts/api';
import { errorMessage } from '@/lib/api/errors';
import { formatPhone } from '@/lib/format';
import { usePermissions } from '@/providers/permissions';
import { usePopupPreview } from './api';

export function TestCallButton({ variant = 'secondary' }: { variant?: 'primary' | 'secondary' }) {
  const perms = usePermissions();
  const [open, setOpen] = useState(false);
  const [number, setNumber] = useState('');
  const preview = usePopupPreview();
  // A few saved people to pick from, so a demo does not start with typing a number.
  const recent = useContacts(
    { pageSize: 6, sort: '-updatedAt' },
    open && perms.has('contact:read'),
  );
  const people = (recent.data?.data ?? []).filter((c) => c.primaryPhone !== null).slice(0, 5);
  const trimmed = number.trim();

  const start = () => {
    preview.mutate(
      { stage: 'ringing', number: trimmed },
      {
        onSuccess: () => {
          setOpen(false);
        },
        onError: (err) => {
          toast({ tone: 'danger', title: 'Could not start', description: errorMessage(err) });
        },
      },
    );
  };

  if (!perms.has('call:read')) return null;

  return (
    <>
      <Button
        variant={variant}
        icon={PhoneIncoming}
        onClick={() => {
          setOpen(true);
        }}
      >
        Test call
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="Test call"
        description="Shows you the popup an incoming call from this number would bring up. Only you see it, nothing is logged, and no phone rings."
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setOpen(false);
              }}
            >
              Cancel
            </Button>
            {/*
              What the phone system's own popup does when a call comes in: it opens this address
              in a new tab with the caller's number. Opening it from here rehearses that hand-off
              without a call, the same way the button beside it rehearses the popup.
            */}
            <Button
              variant="secondary"
              icon={ExternalLink}
              disabled={trimmed.length < 3}
              onClick={() => {
                window.open(
                  `/contacts/lookup?number=${encodeURIComponent(trimmed)}`,
                  '_blank',
                  'noopener',
                );
              }}
            >
              Open caller page
            </Button>
            <Button
              variant="primary"
              icon={PhoneIncoming}
              disabled={trimmed.length < 3}
              loading={preview.isPending}
              onClick={start}
            >
              Start test call
            </Button>
          </>
        }
      >
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (trimmed.length >= 3) start();
          }}
        >
          <Input
            autoFocus
            label="Caller number"
            mono
            placeholder="0712 345 678"
            description="A saved contact's number shows their details. Any other number shows the unknown caller popup. Open caller page does what the phone system's own popup does: it opens that caller in a new tab."
            value={number}
            onChange={(e) => {
              setNumber(e.target.value);
            }}
          />
          {people.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <span className="text-sm text-muted">Or call as</span>
              <div className="flex flex-wrap gap-1.5">
                {people.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className="h-7 rounded-full border border-strong px-2.5 text-sm hover:bg-hover"
                    onClick={() => {
                      setNumber(formatPhone(c.primaryPhone ?? ''));
                    }}
                  >
                    {c.displayName}
                  </button>
                ))}
              </div>
            </div>
          )}
        </form>
      </Dialog>
    </>
  );
}
