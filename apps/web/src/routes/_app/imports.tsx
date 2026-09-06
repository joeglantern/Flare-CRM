import { createFileRoute } from '@tanstack/react-router';
import { ImportExportScreen } from '@/features/imports/ImportExportScreen';

export const Route = createFileRoute('/_app/imports')({ component: ImportExportScreen });
