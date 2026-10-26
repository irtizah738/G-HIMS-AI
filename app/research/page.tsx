import type { Metadata } from 'next';
import { ResearchPage } from '@/components/marketing/ghims-pages';

export const metadata: Metadata = {
  title: 'Clinical Research and Evaluation | G-HIMS',
  description: 'Our approach to synthetic engineering evidence, qualified clinical review, transparent limitations and hospital oversight.',
  alternates: { canonical: '/research' },
  openGraph: { title: 'Clinical Research and Evaluation | G-HIMS', description: 'Our approach to synthetic engineering evidence, qualified clinical review, transparent limitations and hospital oversight.' },
};

export default function Page() { return <ResearchPage />; }
