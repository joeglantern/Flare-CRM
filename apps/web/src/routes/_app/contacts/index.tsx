import { createFileRoute } from '@tanstack/react-router';
import { ContactsListScreen } from '@/features/contacts/ContactsList';

export const Route = createFileRoute('/_app/contacts/')({ component: ContactsListScreen });
