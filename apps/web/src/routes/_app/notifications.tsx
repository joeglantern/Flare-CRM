import { createFileRoute } from '@tanstack/react-router';
import { NotificationCentre } from '@/features/notifications/NotificationCentre';

export const Route = createFileRoute('/_app/notifications')({ component: NotificationCentre });
