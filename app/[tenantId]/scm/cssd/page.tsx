import { redirect } from 'next/navigation';

export default async function GovernedScmRedirect({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = await params;
  redirect(`/${encodeURIComponent(tenantId)}/scm`);
}
