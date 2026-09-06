import { createFileRoute } from '@tanstack/react-router';
import { CallsListScreen } from '@/features/calls/CallsList';

export const Route = createFileRoute('/_app/calls/')({ component: CallsListScreen });
