import { createFileRoute } from '@tanstack/react-router';
import { FeatureGate } from '@/components/access/FeatureGate';
import { MissedCallsScreen } from '@/features/calls/MissedCalls';

export const Route = createFileRoute('/_app/calls/missed')({
  component: function GatedRoute() {
    return (
      <FeatureGate feature="telephony" what="Missed calls">
        <MissedCallsScreen />
      </FeatureGate>
    );
  },
});
