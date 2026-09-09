import { createFileRoute } from '@tanstack/react-router';
import { FeatureGate } from '@/components/access/FeatureGate';
import { ReportsScreen } from '@/features/reports/ReportsScreen';

export const Route = createFileRoute('/_app/reports')({
  component: function GatedRoute() {
    return (
      <FeatureGate feature="reports" what="Reports">
        <ReportsScreen />
      </FeatureGate>
    );
  },
});
