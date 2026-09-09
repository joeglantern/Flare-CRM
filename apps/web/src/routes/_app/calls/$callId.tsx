import { createFileRoute } from '@tanstack/react-router';
import { FeatureGate } from '@/components/access/FeatureGate';
import { CallDetailScreen } from '@/features/calls/CallDetail';

export const Route = createFileRoute('/_app/calls/$callId')({
  component: function CallRoute() {
    const { callId } = Route.useParams();
    return (
      <FeatureGate feature="telephony" what="Call detail">
        <CallDetailScreen callId={callId} />
      </FeatureGate>
    );
  },
});
