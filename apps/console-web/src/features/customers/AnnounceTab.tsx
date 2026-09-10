/**
 * A message straight onto the banner of everyone using that customer's CRM. Useful for "we are
 * migrating your server at 22:00" and nothing else, so it is one field, one level, and a record of
 * what was sent.
 *
 * It needs a live connection: there is no queue for announcements, because an outage notice arriving
 * two days late is worse than none.
 *
 * The history is read from the server rather than kept in this window, because the question an owner
 * actually has is "what have we already told them", and the answer to that does not reset when a tab
 * is closed or when the other owner is the one who sent it.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Megaphone } from 'lucide-react';
import { useState } from 'react';
import { Badge, Banner, Button, Segmented, Textarea, toast } from '@crm/ui';
import { EmptyState, Section, StateSlot } from '@/components/Page';
import { http } from '@/lib/api';
import { count, dateTime } from '@/lib/format';
import { qk } from '@/lib/query';
import type { Announcement } from '@/lib/types';

type Level = 'info' | 'warning' | 'error';

const LEVELS: Record<Level, { label: string; tone: 'neutral' | 'warning' | 'danger' }> = {
  info: { label: 'Information', tone: 'neutral' },
  warning: { label: 'Warning', tone: 'warning' },
  error: { label: 'Serious', tone: 'danger' },
};

export function AnnounceTab({ customerId, connected }: { customerId: string; connected: boolean }) {
  const queryClient = useQueryClient();
  const [message, setMessage] = useState('');
  const [level, setLevel] = useState<Level>('info');

  const history = useQuery({
    queryKey: qk.announcements(customerId),
    queryFn: async () =>
      (await http.list<Announcement>(`/api/v1/customers/${customerId}/announcements`)).data,
  });

  const send = useMutation({
    mutationFn: () =>
      http.post<{ delivered: number }>(`/api/v1/customers/${customerId}/announce`, {
        message: message.trim(),
        level,
      }),
    onSuccess: async (data) => {
      setMessage('');
      await queryClient.invalidateQueries({ queryKey: qk.announcements(customerId) });
      toast({
        tone: 'success',
        title: `Delivered to ${count(data.delivered, 'stack')}`,
      });
    },
    onError: (error: Error) => {
      toast({ tone: 'danger', title: 'Could not send that', description: error.message });
    },
  });

  return (
    <div className="flex flex-col gap-5">
      {!connected && (
        <Banner tone="warning" icon={Megaphone}>
          None of this customer&rsquo;s stacks are connected, so there is nothing to announce to.
          Announcements are not queued.
        </Banner>
      )}

      <Section
        title="Announce"
        description="Everyone signed in to that customer's CRM sees this as a banner until they dismiss it."
      >
        <div className="flex flex-col gap-4">
          <Textarea
            label="Message"
            rows={3}
            maxLength={500}
            placeholder="We are moving your server tonight at 22:00. Expect about ten minutes offline."
            value={message}
            onChange={(e) => {
              setMessage(e.target.value);
            }}
          />
          <div className="flex flex-wrap items-end justify-between gap-3">
            <Segmented<Level>
              ariaLabel="Level"
              value={level}
              onChange={setLevel}
              options={(Object.keys(LEVELS) as Level[]).map((value) => ({
                value,
                label: LEVELS[value].label,
              }))}
            />
            <Button
              variant="primary"
              icon={Megaphone}
              loading={send.isPending}
              disabled={message.trim() === '' || !connected}
              onClick={() => {
                send.mutate();
              }}
            >
              Send
            </Button>
          </div>
        </div>
      </Section>

      <Section
        title="Already sent"
        description="Every announcement this customer has been given, whoever sent it."
      >
        <StateSlot
          isPending={history.isPending}
          error={history.error}
          isEmpty={history.data?.length === 0}
          empty={
            <EmptyState
              icon={Megaphone}
              title="Nothing has been announced yet"
              description="This customer has never had a banner from us."
            />
          }
          onRetry={() => {
            void history.refetch();
          }}
        >
          <ul className="flex flex-col gap-2">
            {(history.data ?? []).map((item) => (
              <li key={item.id} className="rounded-sm border border-border bg-bg p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className="min-w-0 text-base break-words">{item.message}</p>
                  <Badge tone={LEVELS[item.level].tone}>{LEVELS[item.level].label}</Badge>
                </div>
                <p className="mt-1 text-sm text-muted">
                  {dateTime(item.sentAt)}
                  {item.sentByName !== null && ` · ${item.sentByName}`} ·{' '}
                  {/* Delivery is counted at the moment it was sent: a stack that was offline then
                      never received this one, and there is no queue that would fix it later. */}
                  {item.delivered === 0
                    ? 'reached no stack'
                    : `reached ${count(item.delivered, 'stack')}`}
                </p>
              </li>
            ))}
          </ul>
        </StateSlot>
      </Section>
    </div>
  );
}
