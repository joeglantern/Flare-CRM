import { createFileRoute } from '@tanstack/react-router';
import { LeadsListScreen } from '@/features/leads/LeadsList';

export const Route = createFileRoute('/_app/leads/')({ component: LeadsListScreen });
