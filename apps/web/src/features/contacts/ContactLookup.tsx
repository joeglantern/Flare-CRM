/**
 * Where the phone system's own popup sends an agent (Custom Popup URL
 * `/contacts/lookup?number={{.CallerNumber}}`).
 *
 * The popup used to land on a contacts search, which made the agent click through to someone the
 * CRM already knew, and for a while did not find them at all. This goes straight to the caller's
 * page when exactly one contact has the number. Anything else, nobody or more than one, ends on
 * the search, where a number nobody has is offered as a new contact already filled in.
 */
import { useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';
import { Skeleton } from '@/components/ui/Loading';
import { usePageMeta } from '@/app/shell/page-meta';
import { linkTo } from '@/lib/links';
import { useSearchParam } from '@/lib/list-state';
import { useContacts } from './api';

export function ContactLookupScreen() {
  usePageMeta([{ label: 'Contacts', href: '/contacts' }, { label: 'Caller' }]);
  const navigate = useNavigate();
  const [raw] = useSearchParam('number');
  const number = raw?.trim() ?? '';
  const query = useContacts({ q: number, pageSize: 2 }, number !== '');

  useEffect(() => {
    if (number === '') {
      void navigate({ to: '/contacts', replace: true });
      return;
    }
    if (query.isPending) return;
    const rows = query.data?.data ?? [];
    const only = rows.length === 1 ? rows[0] : undefined;
    if (only !== undefined) void navigate({ ...linkTo.contact(only.id), replace: true });
    else void navigate({ to: '/contacts', search: { q: number } as never, replace: true });
  }, [number, query.isPending, query.data, navigate]);

  return (
    <div className="flex flex-col gap-4 p-6" aria-busy="true">
      <p className="text-base text-muted">Finding {number === '' ? 'the caller' : number}</p>
      <Skeleton height={56} shape="block" />
      <Skeleton height={200} shape="block" />
    </div>
  );
}
