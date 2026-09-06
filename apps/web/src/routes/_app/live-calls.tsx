import { createFileRoute } from '@tanstack/react-router';
import { LiveCallsBoard } from '@/features/telephony/LiveCallsBoard';

export const Route = createFileRoute('/_app/live-calls')({ component: LiveCallsBoard });
