import { createFileRoute } from '@tanstack/react-router';
import { CompaniesListScreen } from '@/features/companies/CompaniesList';

export const Route = createFileRoute('/_app/companies/')({ component: CompaniesListScreen });
