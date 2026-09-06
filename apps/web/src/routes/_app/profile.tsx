import { createFileRoute } from '@tanstack/react-router';
import { ProfileScreen } from '@/features/account/ProfileScreen';

export const Route = createFileRoute('/_app/profile')({ component: ProfileScreen });
