import { createFileRoute } from '@tanstack/react-router';
import { CompanyDetailScreen } from '@/features/companies/CompanyDetail';

export const Route = createFileRoute('/_app/companies/$companyId')({
  component: function CompanyRoute() {
    const { companyId } = Route.useParams();
    return <CompanyDetailScreen companyId={companyId} />;
  },
});
