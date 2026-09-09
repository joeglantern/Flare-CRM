import { createFileRoute } from '@tanstack/react-router';
import { FeatureGate } from '@/components/access/FeatureGate';
import { LiveCallsBoard } from '@/features/telephony/LiveCallsBoard';

export const Route = createFileRoute('/_app/live-calls')({
  component: function GatedRoute() {
    return (
      <FeatureGate feature="telephony" what="Live calls">
        <LiveCallsBoard />
      </FeatureGate>
    );
  },
});
