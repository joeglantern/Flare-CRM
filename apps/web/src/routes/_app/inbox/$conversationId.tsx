import { createFileRoute } from '@tanstack/react-router';
import { InboxScreen } from '@/features/inbox/InboxScreen';

export const Route = createFileRoute('/_app/inbox/$conversationId')({
  component: function ConversationRoute() {
    const { conversationId } = Route.useParams();
    return <InboxScreen conversationId={conversationId} />;
  },
});
