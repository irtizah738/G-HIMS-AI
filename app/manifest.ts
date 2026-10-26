import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'G-HIMS | Enterprise Healthcare Information Management System',
    short_name: 'G-HIMS',
    description:
      'AI-Powered Clinical EHR, Multi-Tariff Split Billing ERP, and Offline-First Point-of-Care Terminal',
    start_url: '/',
    display: 'standalone',
    background_color: '#020617',
    theme_color: '#0f172a',
    orientation: 'any',
    icons: [
      {
        src: '/icon.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'maskable',
      },
      {
        src: '/icon.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
    ],
    categories: ['medical', 'productivity', 'business'],
    shortcuts: [
      {
        name: 'Emergency Triage',
        short_name: 'Triage',
        description: 'Instant bedside trauma and emergency intake triage',
        url: '/?tab=triage',
        icons: [{ src: '/icon.png', sizes: '96x96' }],
      },
      {
        name: 'OPD Clinical Queue',
        short_name: 'OPD Queue',
        description: 'Outpatient consultation queue and electronic prescriptions',
        url: '/?tab=opd',
        icons: [{ src: '/icon.png', sizes: '96x96' }],
      },
      {
        name: 'Inpatient Bed Census',
        short_name: 'Bed Census',
        description: 'Hospital bed allocations, telemetry vitals and census',
        url: '/?tab=beds',
        icons: [{ src: '/icon.png', sizes: '96x96' }],
      },
      {
        name: 'Split-Billing & Claims',
        short_name: 'Billing ERP',
        description: 'Point-of-care multi-tariff split invoices and claims adjudication',
        url: '/?tab=billing-erp',
        icons: [{ src: '/icon.png', sizes: '96x96' }],
      },
    ],
  };
}
