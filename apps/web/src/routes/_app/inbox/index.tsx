import { createFileRoute } from '@tanstack/react-router';
import { InboxScreen } from '@/features/inbox/InboxScreen';

export const Route = createFileRoute('/_app/inbox/')({ component: InboxScreen });
