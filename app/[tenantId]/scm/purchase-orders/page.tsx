import { redirect } from 'next/navigation';

interface PageProps {
  params: Promise<{
    tenantId: string;
  }>;
}

/**
 * The legacy Purchase Order workbench used browser-authoritative Firestore
 * mutations and client-generated approval identities. SCM-1 retires that write
 * surface. Procurement is now executed inside the governed SCM workspace.
 */
export default async function PurchaseOrdersPage({ params }: PageProps) {
  const { tenantId } = await params;
  redirect(`/${encodeURIComponent(tenantId)}/scm`);
}
