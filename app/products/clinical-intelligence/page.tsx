import type { Metadata } from 'next';
import { ClinicalIntelligencePage } from '@/components/marketing/ghims-pages';

export const metadata: Metadata = {
  title: 'Clinical Intelligence | G-HIMS',
  description: 'Evidence-linked patient context, trends and clinician-governed review, designed to integrate with existing hospital systems.',
  alternates: { canonical: '/products/clinical-intelligence' },
  openGraph: { title: 'Clinical Intelligence | G-HIMS', description: 'Evidence-linked patient context, trends and clinician-governed review, designed to integrate with existing hospital systems.' },
};

export default function Page() { return <ClinicalIntelligencePage />; }
