import { createFileRoute } from '@tanstack/react-router';
import { FeatureGate } from '@/components/access/FeatureGate';
import { InboxScreen } from '@/features/inbox/InboxScreen';

export const Route = createFileRoute('/_app/inbox/$conversationId')({
  component: function ConversationRoute() {
    const { conversationId } = Route.useParams();
    return (
      <FeatureGate feature="messaging" what="The inbox">
        <InboxScreen conversationId={conversationId} />
      </FeatureGate>
    );
  },
});
