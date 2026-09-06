import { createFileRoute } from '@tanstack/react-router';
import { HomeScreen } from '@/features/dashboard/HomeScreen';

export const Route = createFileRoute('/_app/home')({ component: HomeScreen });
