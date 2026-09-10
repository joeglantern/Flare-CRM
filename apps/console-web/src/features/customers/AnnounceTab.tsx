/**
 * A message straight onto the banner of everyone using that customer's CRM. Useful for "we are
 * migrating your server at 22:00" and nothing else, so it is one field, one level, and a record of
 * what was sent.
 *
 * It needs a live connection: there is no queue for announcements, because an outage notice arriving
 * two days late is worse than none.
 */
import { useMutation } from '@tanstack/react-query';
import { Megaphone } from 'lucide-react';
import { useState } from 'react';
import { Banner, Button, Segmented, Textarea, toast } from '@crm/ui';
import { Section } from '@/components/Page';
import { http } from '@/lib/api';
import { dateTime } from '@/lib/format';

type Level = 'info' | 'warning' | 'error';

export function AnnounceTab({ customerId, connected }: { customerId: string; connected: boolean }) {
  const [message, setMessage] = useState('');
  const [level, setLevel] = useState<Level>('info');
  const [sent, setSent] = useState<{ at: string; message: string; level: Level }[]>([]);

  const send = useMutation({
    mutationFn: () =>
      http.post<{ delivered: number }>(`/api/v1/customers/${customerId}/announce`, {
        message: message.trim(),
        level,
      }),
    onSuccess: (data) => {
      setSent((previous) => [
        { at: new Date().toISOString(), message: message.trim(), level },
        ...previous,
      ]);
      setMessage('');
      toast({
        tone: 'success',
        title: `Delivered to ${String(data.delivered)} stack${data.delivered === 1 ? '' : 's'}`,
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
              options={[
                { value: 'info', label: 'Information' },
                { value: 'warning', label: 'Warning' },
                { value: 'error', label: 'Serious' },
              ]}
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

      {sent.length > 0 && (
        <Section title="Sent from this window">
          <ul className="flex flex-col gap-2">
            {sent.map((item) => (
              <li key={item.at} className="rounded-sm border border-border bg-bg p-3">
                <p className="text-base">{item.message}</p>
                <p className="mt-1 text-sm text-muted">
                  {item.level} · {dateTime(item.at)}
                </p>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}
