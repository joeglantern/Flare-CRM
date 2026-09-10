import { createFileRoute } from '@tanstack/react-router';
import { DataDeletion } from '@/features/legal/DataDeletion';

/** Public: reachable without a session, and quoted to Meta and to regulators. */
export const Route = createFileRoute('/data-deletion')({ component: DataDeletion });
