import type { Metadata } from 'next';
import { ResourcesPage } from '@/components/marketing/ghims-pages';

export const metadata: Metadata = {
  title: 'Resources and FAQs | G-HIMS',
  description: 'Frequently asked questions about G-HIMS CI, G-HIMS OS, hospital pilots, clinical validation and integration.',
  alternates: { canonical: '/resources' },
  openGraph: { title: 'Resources and FAQs | G-HIMS', description: 'Frequently asked questions about G-HIMS CI, G-HIMS OS, hospital pilots, clinical validation and integration.' },
};

export default function Page() { return <ResourcesPage />; }
