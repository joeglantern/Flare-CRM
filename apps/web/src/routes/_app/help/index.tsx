import { createFileRoute } from '@tanstack/react-router';
import { HelpScreen } from '@/features/help/HelpScreen';

export const Route = createFileRoute('/_app/help/')({ component: HelpScreen });
