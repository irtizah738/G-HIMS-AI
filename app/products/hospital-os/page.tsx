import type { Metadata } from 'next';
import { HospitalOSPage } from '@/components/marketing/ghims-pages';

export const metadata: Metadata = {
  title: 'Hospital Operating System | G-HIMS',
  description: 'Explore the event-driven, offline-first G-HIMS hospital platform for clinical, workforce, supply chain and financial workflows.',
  alternates: { canonical: '/products/hospital-os' },
  openGraph: { title: 'Hospital Operating System | G-HIMS', description: 'Explore the event-driven, offline-first G-HIMS hospital platform for clinical, workforce, supply chain and financial workflows.' },
};

export default function Page() { return <HospitalOSPage />; }
