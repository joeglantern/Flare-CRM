import { createFileRoute } from '@tanstack/react-router';
import { DialpadScreen } from '@/features/telephony/Dialpad';

export const Route = createFileRoute('/_app/calls/dialpad')({ component: DialpadScreen });
