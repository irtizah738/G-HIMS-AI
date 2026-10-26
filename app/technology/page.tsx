import type { Metadata } from 'next';
import { TechnologyPage } from '@/components/marketing/ghims-pages';

export const metadata: Metadata = {
  title: 'Technology and Trust | G-HIMS',
  description: 'An event-driven architecture focused on provenance, tenant isolation, clinical authority and recoverable workflows.',
  alternates: { canonical: '/technology' },
  openGraph: { title: 'Technology and Trust | G-HIMS', description: 'An event-driven architecture focused on provenance, tenant isolation, clinical authority and recoverable workflows.' },
};

export default function Page() { return <TechnologyPage />; }
