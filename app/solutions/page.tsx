import type { Metadata } from 'next';
import { SolutionsPage } from '@/components/marketing/ghims-pages';

export const metadata: Metadata = {
  title: 'Hospital Solutions | G-HIMS',
  description: 'Hospital-specific integration, clinical evaluation, and hospital operating system adoption pathways.',
  alternates: { canonical: '/solutions' },
  openGraph: { title: 'Hospital Solutions | G-HIMS', description: 'Hospital-specific integration, clinical evaluation, and hospital operating system adoption pathways.' },
};

export default function Page() { return <SolutionsPage />; }
