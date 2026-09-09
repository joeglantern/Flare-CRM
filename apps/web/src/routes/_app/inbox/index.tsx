import { createFileRoute } from '@tanstack/react-router';
import { FeatureGate } from '@/components/access/FeatureGate';
import { InboxScreen } from '@/features/inbox/InboxScreen';

export const Route = createFileRoute('/_app/inbox/')({
  component: function GatedRoute() {
    return (
      <FeatureGate feature="messaging" what="The inbox">
        <InboxScreen />
      </FeatureGate>
    );
  },
});
