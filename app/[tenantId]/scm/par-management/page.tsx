import { redirect } from 'next/navigation';

interface PageProps {
  params: Promise<{
    tenantId: string;
  }>;
}

/**
 * Legacy PAR workbench retired by SCM-1.
 *
 * The old page performed browser-authoritative quantity edits and stock
 * transfers. PAR management now lives in the governed SCM workspace where
 * replenishment and stock movements route through the CommandBus.
 */
export default async function ParManagementPage({ params }: PageProps) {
  const { tenantId } = await params;
  redirect(`/${encodeURIComponent(tenantId)}/scm`);
}
