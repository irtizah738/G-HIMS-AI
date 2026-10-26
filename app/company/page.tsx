import type { Metadata } from 'next';
import { CompanyPage } from '@/components/marketing/ghims-pages';

export const metadata: Metadata = {
  title: 'About G-HIMS | G-HIMS',
  description: 'Learn about the G-HIMS mission and our research-led approach to trustworthy healthcare technology.',
  alternates: { canonical: '/company' },
  openGraph: { title: 'About G-HIMS | G-HIMS', description: 'Learn about the G-HIMS mission and our research-led approach to trustworthy healthcare technology.' },
};

export default function Page() { return <CompanyPage />; }
