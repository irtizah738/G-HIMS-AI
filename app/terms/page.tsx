import type { Metadata } from 'next';
import { TermsPage } from '@/components/marketing/ghims-pages';

export const metadata: Metadata = {
  title: 'Website Terms and Clinical Disclaimer | G-HIMS',
  description: 'Important information about G-HIMS website content, clinical oversight, pilot qualification and product representations.',
  alternates: { canonical: '/terms' },
  openGraph: { title: 'Website Terms and Clinical Disclaimer | G-HIMS', description: 'Important information about G-HIMS website content, clinical oversight, pilot qualification and product representations.' },
};

export default function Page() { return <TermsPage />; }
