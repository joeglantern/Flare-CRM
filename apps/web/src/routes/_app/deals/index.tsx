import { createFileRoute } from '@tanstack/react-router';
import { FeatureGate } from '@/components/access/FeatureGate';
import { DealsScreen } from '@/features/deals/DealsScreen';

export const Route = createFileRoute('/_app/deals/')({
  component: function GatedRoute() {
    return (
      <FeatureGate feature="deals" what="Deals">
        <DealsScreen />
      </FeatureGate>
    );
  },
});
