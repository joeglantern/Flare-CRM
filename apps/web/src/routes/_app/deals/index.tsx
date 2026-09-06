import { createFileRoute } from '@tanstack/react-router';
import { DealsScreen } from '@/features/deals/DealsScreen';

export const Route = createFileRoute('/_app/deals/')({ component: DealsScreen });
