import { createFileRoute } from '@tanstack/react-router';
import { ContactLookupScreen } from '@/features/contacts/ContactLookup';

export const Route = createFileRoute('/_app/contacts/lookup')({ component: ContactLookupScreen });
