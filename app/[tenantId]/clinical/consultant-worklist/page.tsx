import { ConsultantCommandCenter } from '@/components/clinical/ConsultantCommandCenter';

interface PageProps {
  params: Promise<{ tenantId: string }>;
}

export default async function ConsultantCommandCenterPage({ params }: PageProps) {
  await params;
  return <ConsultantCommandCenter />;
}
