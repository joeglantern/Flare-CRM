/**
 * The caller page: what the phone system's popup opens for a number that is not one saved contact.
 *
 * A saved caller never reaches this page, the route sends them straight to their contact. Here the
 * number is either nobody's, in which case it is shown with its past calls and one button to save
 * it, or it is on more than one contact, in which case they are listed to choose from.
 */
import type { ContactSummaryDto } from '@crm/shared';
import { Link, useNavigate } from '@tanstack/react-router';
import { Search, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { DateTime, Duration } from '@/components/data/formatters';
import { CallDirection, CallStatusBadge } from '@/components/data/status';
import { Panel } from '@/components/entity/EntityHeader';
import { PageHeader } from '@/app/shell/TopBar';
import { usePageMeta } from '@/app/shell/page-meta';
import { useCalls } from '@/features/calls/api';
import { formatPhone } from '@/lib/format';
import { linkTo } from '@/lib/links';
import { usePermissions } from '@/providers/permissions';
import { ContactFormDrawer } from './ContactForm';

export function CallerLookupScreen({
  number,
  candidates,
}: {
  number: string;
  candidates: ContactSummaryDto[];
}) {
  usePageMeta([{ label: 'Contacts', href: '/contacts' }, { label: 'Caller' }]);
  const perms = usePermissions();
  const navigate = useNavigate();
  const [adding, setAdding] = useState(false);
  const calls = useCalls(
    { number, pageSize: 5, sort: '-startedAt' },
    perms.has('call:read') && candidates.length === 0,
  );
  const history = calls.data?.data ?? [];
  const shared = candidates.length > 1;

  return (
    <div className="flex flex-col gap-4 p-6">
      <PageHeader
        title={<span className="mono">{formatPhone(number)}</span>}
        description={
          shared
            ? 'More than one contact has this number. Pick the caller.'
            : 'This number is not in your contacts yet.'
        }
        actions={
          <>
            <Button
              variant="secondary"
              icon={Search}
              onClick={() => {
                void navigate({ to: '/contacts', search: { q: number } as never });
              }}
            >
              Search contacts
            </Button>
            {!shared && perms.has('contact:create') && (
              <Button
                variant="primary"
                icon={UserPlus}
                onClick={() => {
                  setAdding(true);
                }}
              >
                Add as contact
              </Button>
            )}
          </>
        }
      />

      {shared && (
        <Panel title="Contacts with this number" padded={false}>
          <ul>
            {candidates.map((c) => (
              <li key={c.id} className="border-b border-border last:border-b-0">
                <Link
                  {...linkTo.contact(c.id)}
                  className="flex items-center gap-2.5 px-3.5 py-2.5 text-text no-underline hover:bg-hover hover:no-underline"
                >
                  <Avatar name={c.displayName} seed={c.id} src={c.avatarUrl} size={24} />
                  <span className="min-w-0 flex-1 truncate font-medium">{c.displayName}</span>
                  <span className="truncate text-sm text-muted">{c.company?.name ?? ''}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {!shared && (
        <Panel
          title="Calls with this number"
          padded={false}
          note="Saving the number gives these calls the contact's name."
        >
          {history.length === 0 ? (
            <p className="px-3.5 py-3 text-sm text-muted">
              {calls.isPending && perms.has('call:read') ? 'Loading…' : 'No calls logged yet.'}
            </p>
          ) : (
            <ul>
              {history.map((c) => (
                <li key={c.id} className="border-b border-border last:border-b-0">
                  <Link
                    {...linkTo.call(c.id)}
                    className="flex items-center gap-3 px-3.5 py-2.5 text-text no-underline hover:bg-hover hover:no-underline"
                  >
                    <CallDirection direction={c.direction} />
                    <CallStatusBadge status={c.status} />
                    <span className="min-w-0 flex-1 truncate text-sm text-muted">
                      {c.user?.name ?? c.extension ?? ''}
                    </span>
                    <span className="text-sm text-muted">
                      <Duration seconds={c.talkDurationSec} />
                    </span>
                    <span className="text-sm text-muted">
                      <DateTime value={c.startedAt} />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      )}

      <ContactFormDrawer
        open={adding}
        onOpenChange={setAdding}
        prefillPhone={number}
        onSaved={(c) => {
          setAdding(false);
          void navigate({ ...linkTo.contact(c.id), replace: true });
        }}
      />
    </div>
  );
}
