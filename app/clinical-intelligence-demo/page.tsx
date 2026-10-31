import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getRuntimeMode } from '@/lib/runtime/runtime-mode';
import { getPublicRuntimeMode } from '@/lib/runtime/environment-contract';
import { DemoClinicianReviewClient } from '@/components/demo/DemoClinicianReviewClient';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Helixis Clinical Intelligence | Synthetic Investor Demo',
  description: 'Explore an isolated, synthetic, clinician-governed Clinical Intelligence demonstration from Helixis AI.',
  robots: { index: false, follow: false },
};



/**
 * This is the dedicated investor-demo entry point. Open on the
 * evidence-first Clinical Intelligence experience, NOT the EHR record.
 * The original Patient360 is accessible as supporting context only.
 */
export default function ClinicalIntelligenceInvestorDemoHome() {
  if (
    process.env.VERCEL !== '1' ||
    process.env.VERCEL_ENV !== 'preview' ||
    getRuntimeMode() !== 'DEMO' ||
    getPublicRuntimeMode() !== 'DEMO' ||
    process.env.FIREBASE_PROJECT_ID !== 'g-hims-ci-demo' ||
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID !== 'g-hims-ci-demo' ||
    process.env.GHIMS_FIREBASE_PROJECT_ID_DEMO !== 'g-hims-ci-demo' ||
    process.env.NEXT_PUBLIC_GHIMS_FIREBASE_PROJECT_ID_DEMO !== 'g-hims-ci-demo' ||
    process.env.GHIMS_DEMO_TENANT_ID !== 'central-metro-hospital'
  ) notFound();
  return <DemoClinicianReviewClient />;
}
