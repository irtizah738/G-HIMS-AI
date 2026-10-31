import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Helixis AI | Helixis Health Platform',
    short_name: 'Helixis',
    description:
      'Clinical intelligence and offline-first hospital workflows with auditable clinical and operational records',
    start_url: '/',
    display: 'standalone',
    background_color: '#0B132B',
    theme_color: '#0B132B',
    orientation: 'any',
    icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
    categories: ['medical', 'productivity', 'business'],
    shortcuts: [
      {
        name: 'Emergency Triage',
        short_name: 'Triage',
        description: 'Instant bedside trauma and emergency intake triage',
        url: '/?tab=triage',
        icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' }],
      },
      {
        name: 'OPD Clinical Queue',
        short_name: 'OPD Queue',
        description: 'Outpatient consultation queue and electronic prescriptions',
        url: '/?tab=opd',
        icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' }],
      },
      {
        name: 'Inpatient Bed Census',
        short_name: 'Bed Census',
        description: 'Hospital bed allocations, telemetry vitals and census',
        url: '/?tab=beds',
        icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' }],
      },
      {
        name: 'Split-Billing & Claims',
        short_name: 'Billing ERP',
        description: 'Point-of-care multi-tariff split invoices and claims adjudication',
        url: '/?tab=billing-erp',
        icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' }],
      },
    ],
  };
}
