import { createFileRoute } from '@tanstack/react-router';
import { MissedCallsScreen } from '@/features/calls/MissedCalls';

export const Route = createFileRoute('/_app/calls/missed')({ component: MissedCallsScreen });
