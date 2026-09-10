import { createFileRoute } from '@tanstack/react-router';
import { PrivacyPolicy } from '@/features/legal/PrivacyPolicy';

/** Public: reachable without a session, and quoted to Meta and to regulators. */
export const Route = createFileRoute('/privacy')({ component: PrivacyPolicy });
