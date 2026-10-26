import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{
      userAgent: '*',
      allow: ['/', '/products/', '/solutions', '/technology', '/research', '/company', '/resources', '/contact', '/privacy', '/terms'],
      disallow: ['/api/', '/login', '/dashboard/', '/settings', '/tenant-selection', '/forgot-password', '/telehealth/', '/_next/', '/admin/'],
    }],
    sitemap: 'https://g-hims-ai.vercel.app/sitemap.xml',
  };
}
