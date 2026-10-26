import type { Metadata } from 'next';
import { PrivacyPage } from '@/components/marketing/ghims-pages';

export const metadata: Metadata = {
  title: 'Website Privacy Notice | G-HIMS',
  description: 'How we approach public-website enquiries, technical visitor information and hospital data separation.',
  alternates: { canonical: '/privacy' },
  openGraph: { title: 'Website Privacy Notice | G-HIMS', description: 'How we approach public-website enquiries, technical visitor information and hospital data separation.' },
};

export default function Page() { return <PrivacyPage />; }
