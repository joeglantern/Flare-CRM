import { createFileRoute } from '@tanstack/react-router';
import { CallDetailScreen } from '@/features/calls/CallDetail';

export const Route = createFileRoute('/_app/calls/$callId')({
  component: function CallRoute() {
    const { callId } = Route.useParams();
    return <CallDetailScreen callId={callId} />;
  },
});
