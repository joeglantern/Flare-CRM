import { createFileRoute } from '@tanstack/react-router';
import { HelpPrintScreen } from '@/features/help/HelpPrintScreen';

export const Route = createFileRoute('/_app/help/print')({ component: HelpPrintScreen });
