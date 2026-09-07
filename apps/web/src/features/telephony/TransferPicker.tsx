/**
 * TransferPicker (Component Inventory · Telephony): the extension picker with presence dots and
 * the blind / attended choice. Presence comes from `agent:presence`, patched into the roster.
 */
import type { ServerToClientEvents } from '@crm/shared';
import { PhoneForwarded } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { Avatar, PRESENCE_LABEL, type Presence } from '@/components/ui/Avatar';
import { Input } from '@/components/ui/Input';
import { Dialog } from '@/components/ui/Overlay';
import { RadioGroup } from '@/components/ui/Toggle';
import { toast } from '@/components/ui/toast';
import { errorMessage } from '@/lib/api/errors';
import { useUsers } from '@/features/users/api';
import { useSocketEvent } from '@/lib/socket/client';
import { cn } from '@/lib/utils';
import { useCallControl } from './api';
import { MAX_PAGE_SIZE } from '@crm/shared';

export function TransferPicker({
  callId,
  open,
  onOpenChange,
}: {
  callId: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const users = useUsers({ pageSize: MAX_PAGE_SIZE });
  const control = useCallControl(callId);
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<'blind' | 'attended'>('blind');
  const [presence, setPresence] = useState<Record<string, Presence>>({});

  useSocketEvent(
    'agent:presence',
    useCallback<ServerToClientEvents['agent:presence']>((p) => {
      setPresence((prev) => ({
        ...prev,
        [p.extension]:
          p.registered === false
            ? 'unregistered'
            : p.callState === 'busy'
              ? 'on_call'
              : p.callState === 'ringing'
                ? 'ringing'
                : 'available',
      }));
    }, []),
  );

  const extensions = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (users.data?.data ?? []).flatMap((u) => {
      const extension = u.extension;
      if (extension === null || !u.isActive) return [];
      if (q !== '' && !u.name.toLowerCase().includes(q) && !extension.includes(q)) return [];
      return [
        {
          id: u.id,
          name: u.name,
          extension,
          avatarUrl: u.avatarUrl,
          presence: presence[extension] ?? 'available',
        },
      ];
    });
  }, [users.data, query, presence]);

  const transfer = (extension: string) => {
    control.mutate(
      { action: 'transfer', number: extension, transferType: mode },
      {
        onSuccess: () => {
          toast({ tone: 'success', title: `Transferred to ${extension}` });
          onOpenChange(false);
        },
        onError: (e) => {
          toast({ tone: 'danger', title: 'Transfer failed', description: errorMessage(e) });
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Transfer call" width={440}>
      <div className="flex flex-col gap-3">
        <RadioGroup
          value={mode}
          onChange={setMode}
          orientation="horizontal"
          label="Transfer type"
          options={[
            { value: 'blind', label: 'Blind', description: 'Hand over immediately' },
            { value: 'attended', label: 'Attended', description: 'Speak first, then connect' },
          ]}
        />
        <Input
          autoFocus
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
          }}
          placeholder="Name or extension"
          aria-label="Search extensions"
        />
        <ul className="max-h-[280px] overflow-y-auto rounded-md border border-border">
          {extensions.map((u) => (
            <li key={u.id}>
              <button
                type="button"
                disabled={control.isPending}
                onClick={() => {
                  transfer(u.extension);
                }}
                className="flex w-full items-center gap-2.5 border-b border-border px-3 py-2 text-left text-base last:border-b-0 hover:bg-hover disabled:opacity-60"
              >
                <Avatar
                  name={u.name}
                  seed={u.id}
                  src={u.avatarUrl}
                  size={24}
                  presence={u.presence}
                />
                <span className="min-w-0 flex-1 truncate">{u.name}</span>
                <span
                  className={cn(
                    'text-sm',
                    u.presence === 'available' ? 'text-success' : 'text-muted',
                  )}
                >
                  {PRESENCE_LABEL[u.presence]}
                </span>
                <span className="mono shrink-0 text-sm text-muted">{u.extension}</span>
              </button>
            </li>
          ))}
          {extensions.length === 0 && (
            <li className="px-3 py-6 text-center text-base text-muted">No extensions match.</li>
          )}
        </ul>
        <p className="text-sm text-muted">
          <PhoneForwarded size={12} className="mr-1 inline" aria-hidden />
          The PBX rings the target; a blind transfer disconnects you immediately.
        </p>
      </div>
    </Dialog>
  );
}
