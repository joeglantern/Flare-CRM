import { createFileRoute } from '@tanstack/react-router';
import { FeatureGate } from '@/components/access/FeatureGate';
import { CallsListScreen } from '@/features/calls/CallsList';

export const Route = createFileRoute('/_app/calls/')({
  component: function GatedRoute() {
    return (
      <FeatureGate feature="telephony" what="Call history">
        <CallsListScreen />
      </FeatureGate>
    );
  },
});
