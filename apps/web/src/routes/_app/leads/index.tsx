import { createFileRoute } from '@tanstack/react-router';
import { FeatureGate } from '@/components/access/FeatureGate';
import { LeadsListScreen } from '@/features/leads/LeadsList';

export const Route = createFileRoute('/_app/leads/')({
  component: function GatedRoute() {
    return (
      <FeatureGate feature="leads" what="Leads">
        <LeadsListScreen />
      </FeatureGate>
    );
  },
});
