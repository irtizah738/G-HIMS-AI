import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'G-HIMS | Clinical Intelligence and Hospital Operating System',
    short_name: 'G-HIMS',
    description: 'Clinician-governed intelligence and event-driven hospital infrastructure.',
    start_url: '/',
    display: 'standalone',
    background_color: '#071e30',
    theme_color: '#0b2d43',
    icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
    categories: ['medical', 'productivity', 'business'],
    shortcuts: [
      { name: 'Hospital staff login', short_name: 'Login', url: '/login' },
    ],
  };
}
