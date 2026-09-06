import { createFileRoute } from '@tanstack/react-router';
import { ContactDetailScreen } from '@/features/contacts/ContactDetail';

export const Route = createFileRoute('/_app/contacts/$contactId')({
  component: function ContactRoute() {
    const { contactId } = Route.useParams();
    return <ContactDetailScreen contactId={contactId} />;
  },
});
