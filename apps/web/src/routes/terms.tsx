import { createFileRoute } from '@tanstack/react-router';
import { Terms } from '@/features/legal/Terms';

/** Public: reachable without a session, and quoted to Meta and to regulators. */
export const Route = createFileRoute('/terms')({ component: Terms });
