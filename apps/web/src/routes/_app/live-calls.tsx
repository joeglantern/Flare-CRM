import { createFileRoute } from '@tanstack/react-router';
import { FeatureGate } from '@/components/access/FeatureGate';
import { EmptyState } from '@/components/data/states';
import { LiveCallsBoard } from '@/features/telephony/LiveCallsBoard';
import { useSettings } from '@/providers/settings';

export const Route = createFileRoute('/_app/live-calls')({
  component: function GatedRoute() {
    const { liveCalls } = useSettings();
    return (
      <FeatureGate feature="telephony" what="Live calls">
        {liveCalls?.enabled === true ? (
          <LiveCallsBoard />
        ) : (
          <div className="p-6">
            <EmptyState
              object="handset"
              title="Live calls are switched off"
              description="An admin can switch them on in Settings, Telephony."
            />
          </div>
        )}
      </FeatureGate>
    );
  },
});
