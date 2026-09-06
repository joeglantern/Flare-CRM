import { createFileRoute } from '@tanstack/react-router';
import { DealDetailScreen } from '@/features/deals/DealDetail';

export const Route = createFileRoute('/_app/deals/$dealId')({
  component: function DealRoute() {
    const { dealId } = Route.useParams();
    return <DealDetailScreen dealId={dealId} />;
  },
});
