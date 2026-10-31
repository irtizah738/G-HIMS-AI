import { notFound, redirect } from 'next/navigation';
import { getRuntimeMode } from '@/lib/runtime/runtime-mode';
import { getPublicRuntimeMode } from '@/lib/runtime/environment-contract';

interface PageProps {
  params: Promise<{ tenantId: string }>;
}

/**
 * Legacy DEMO landing now redirects to Clinical Intelligence first.
 * The full Patient 360 is accessible from the intelligence review as evidence.
 * Both runtime and Firebase project remain explicitly demo-scoped.
 */
export default async function ClinicalIntelligenceDemoPage({ params }: PageProps) {
  const { tenantId } = await params;
  if (
    getRuntimeMode() !== 'DEMO' ||
    getPublicRuntimeMode() !== 'DEMO' ||
    process.env.VERCEL !== '1' ||
    process.env.VERCEL_ENV !== 'preview' ||
    tenantId !== 'central-metro-hospital' ||
    process.env.GHIMS_DEMO_TENANT_ID !== 'central-metro-hospital' ||
    process.env.FIREBASE_PROJECT_ID !== 'g-hims-ci-demo' ||
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID !== 'g-hims-ci-demo' ||
    process.env.GHIMS_FIREBASE_PROJECT_ID_DEMO !== 'g-hims-ci-demo' ||
    process.env.NEXT_PUBLIC_GHIMS_FIREBASE_PROJECT_ID_DEMO !== 'g-hims-ci-demo'
  ) notFound();
  redirect('/clinical-intelligence-demo');
}
