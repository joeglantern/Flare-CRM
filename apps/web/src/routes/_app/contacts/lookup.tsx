/**
 * Where the phone system's own popup sends an agent (Custom Popup URL
 * `/contacts/lookup?number={{.CallerNumber}}`).
 *
 * The decision is made here, in the loader, before anything renders. It used to be made in an
 * effect on the page: the page redirected, saw the address no longer carried a number while that
 * redirect was still in flight, and fired its "no number" fallback over the top of it. Every lookup,
 * for a saved caller or not, ended on the bare contacts list. A loader runs once per number and
 * cannot be overtaken by its own redirect.
 */
import type { ContactSummaryDto } from '@crm/shared';
import { createFileRoute, redirect } from '@tanstack/react-router';
import { CallerLookupScreen } from '@/features/contacts/ContactLookup';
import { cleanNumber, lookupOutcome } from '@/features/contacts/caller-lookup';
import { http } from '@/lib/api/client';
import { qk } from '@/lib/query';

export const Route = createFileRoute('/_app/contacts/lookup')({
  validateSearch: (search: Record<string, unknown>) => ({ number: cleanNumber(search.number) }),
  loaderDeps: ({ search }) => ({ number: search.number }),
  loader: async ({ context, deps }) => {
    const { number } = deps;
    let rows: ContactSummaryDto[] = [];
    if (number !== '') {
      const filters = { q: number, pageSize: 5 };
      try {
        const list = await context.queryClient.query({
          queryKey: qk.list('contacts', filters),
          queryFn: () => http.list<ContactSummaryDto>('/api/v1/contacts', filters),
          staleTime: 0,
        });
        rows = list.data;
      } catch {
        // The caller page still shows the number and offers to save it; a failed search must not
        // leave the agent on an error screen in the middle of a call.
      }
    }
    const outcome = lookupOutcome(number, rows);
    if (outcome.kind === 'none') throw redirect({ to: '/contacts', replace: true });
    if (outcome.kind === 'contact') {
      throw redirect({
        to: '/contacts/$contactId',
        params: { contactId: outcome.contactId },
        replace: true,
      });
    }
    return outcome;
  },
  component: function CallerLookupRoute() {
    const outcome = Route.useLoaderData();
    return <CallerLookupScreen number={outcome.number} candidates={outcome.candidates} />;
  },
});
