import type { Metadata } from 'next';
import { ContactPage } from '@/components/marketing/ghims-pages';

export const metadata: Metadata = {
  title: 'Contact G-HIMS | G-HIMS',
  description: 'Enquiries for hospitals, clinicians, research collaborators and healthcare technology partners.',
  alternates: { canonical: '/contact' },
  openGraph: { title: 'Contact G-HIMS | G-HIMS', description: 'Enquiries for hospitals, clinicians, research collaborators and healthcare technology partners.' },
};

export default function Page() { return <ContactPage />; }
