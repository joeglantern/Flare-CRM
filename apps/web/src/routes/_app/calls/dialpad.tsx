import { createFileRoute } from '@tanstack/react-router';
import { FeatureGate } from '@/components/access/FeatureGate';
import { DialpadScreen } from '@/features/telephony/Dialpad';

export const Route = createFileRoute('/_app/calls/dialpad')({
  component: function GatedRoute() {
    return (
      <FeatureGate feature="telephony" what="The dialpad">
        <DialpadScreen />
      </FeatureGate>
    );
  },
});
