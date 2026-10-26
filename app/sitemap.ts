import type { MetadataRoute } from 'next';

const base = 'https://g-hims-ai.vercel.app';
const paths = [
  '/', '/products/clinical-intelligence', '/products/hospital-os',
  '/solutions', '/technology', '/research', '/company', '/resources', '/contact', '/privacy', '/terms',
] as const;

export default function sitemap(): MetadataRoute.Sitemap {
  return paths.map(path => ({
    url: base + path,
    changeFrequency: path === '/' ? 'monthly' : 'yearly',
    priority: path === '/' ? 1 : path.startsWith('/products') ? 0.85 : 0.55,
  }));
}
