import { createFileRoute } from '@tanstack/react-router';
import { FeatureGate } from '@/components/access/FeatureGate';
import { LeadDetailScreen } from '@/features/leads/LeadDetail';

export const Route = createFileRoute('/_app/leads/$leadId')({
  component: function LeadRoute() {
    const { leadId } = Route.useParams();
    return (
      <FeatureGate feature="leads" what="Leads">
        <LeadDetailScreen leadId={leadId} />
      </FeatureGate>
    );
  },
});
