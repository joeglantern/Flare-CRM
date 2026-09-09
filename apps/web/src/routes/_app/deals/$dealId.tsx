import { createFileRoute } from '@tanstack/react-router';
import { FeatureGate } from '@/components/access/FeatureGate';
import { DealDetailScreen } from '@/features/deals/DealDetail';

export const Route = createFileRoute('/_app/deals/$dealId')({
  component: function DealRoute() {
    const { dealId } = Route.useParams();
    return (
      <FeatureGate feature="deals" what="Deals">
        <DealDetailScreen dealId={dealId} />
      </FeatureGate>
    );
  },
});
