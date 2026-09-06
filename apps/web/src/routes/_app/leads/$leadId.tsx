import { createFileRoute } from '@tanstack/react-router';
import { LeadDetailScreen } from '@/features/leads/LeadDetail';

export const Route = createFileRoute('/_app/leads/$leadId')({
  component: function LeadRoute() {
    const { leadId } = Route.useParams();
    return <LeadDetailScreen leadId={leadId} />;
  },
});
