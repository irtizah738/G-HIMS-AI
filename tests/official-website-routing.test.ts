import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
const source = (file: string) => readFile(path.join(process.cwd(), file), 'utf8');
const routes = ['products/clinical-intelligence','products/hospital-os','solutions','technology','research','company','resources','contact','privacy','terms'];

describe('Official G-HIMS site and hospital application boundaries', () => {
  test('anonymous public home does not bypass authenticated dashboard', async () => {
    const page = await source('app/page.tsx');
    expect(page).toContain('useAuth()');
    expect(page).toContain('if (!user) return <GhimHome />;');
    expect(page).toContain('<AuthGuard>');
    expect(page).toContain('<TenantDashboard />');
    expect(page).toContain('ssr: false');
    expect(page).not.toContain('signIn(');
  });
  test('G-HIMS is the parent brand and CI and OS are differentiated products', async () => {
    const site = await source('components/marketing/ghims-pages.tsx');
    const shell = await source('components/marketing/ghims-site.tsx');
    for (const required of ['G-HIMS CI','G-HIMS OS','Flagship product','Hospital Operating System','existing hospital systems']) expect(site).toContain(required);
    expect(shell).toContain('G-HIMS');
    expect(shell).toContain('Clinical Intelligence');
  });
  test('all public routes have standalone pages and metadata', async () => {
    for (const route of routes) {
      const page = await source('app/' + route + '/page.tsx');
      expect(page).toContain('export const metadata');
      expect(page).toContain('canonical:');
      expect(page).toContain('Page()');
    }
  });
  test('public routes never resolve tenant identity from URL or cookie', async () => {
    const proxy = await source('proxy.ts');
    expect(proxy).toContain('PUBLIC_SITE_ROUTES');
    expect(proxy).toContain('if (PUBLIC_SITE_ROUTES.has(firstPathSegment)) return null;');
    for (const route of routes) expect(proxy).toContain("'" + route.split('/')[0] + "'");
    expect(proxy).toContain('TENANT_PATH_REGEX');
  });
  test('mobile menu covers all widths below desktop', async () => {
    const shell = await source('components/marketing/ghims-site.tsx');
    expect(shell).toContain('lg:hidden');
    expect(shell).toContain('lg:flex');
    expect(shell).toContain('Mobile navigation');
    expect(shell).toContain('Skip to content');
  });
  test('visuals are explicitly illustrative and claims remain qualified', async () => {
    const pages = await source('components/marketing/ghims-pages.tsx');
    const shell = await source('components/marketing/ghims-site.tsx');
    expect(shell).toContain('Illustrative interface, synthetic concepts only.');
    expect(pages).toContain('not a claim of clinically proven outcomes');
    expect(pages).not.toContain('FDA cleared');
    expect(pages).not.toContain('HIPAA certified');
  });
  test('contact avoids invented email and clinical data collection', async () => {
    const pages = await source('components/marketing/ghims-pages.tsx');
    const shell = await source('components/marketing/ghims-site.tsx');
    expect(shell).toContain('NEXT_PUBLIC_GHIMS_CONTACT_EMAIL');
    expect(shell).toContain('mailto:');
    expect(pages).toContain('Official enquiry inbox pending verification');
    expect(pages).not.toContain('contact@g-hims.com');
    expect(pages).not.toContain('localStorage');
  });
  test('public sitemap and robot directives exclude application endpoints', async () => {
    const sitemap = await source('app/sitemap.ts');
    const robots = await source('app/robots.ts');
    for (const route of routes) expect(sitemap).toContain("'/" + route + "'");
    expect(robots).toContain("'/api/'");
    expect(robots).toContain("'/login'");
    expect(sitemap).not.toContain('/patients/');
  });
  test('corporate metadata and icon are branded', async () => {
    const layout = await source('app/layout.tsx');
    const manifest = await source('app/manifest.ts');
    expect(layout).toContain('G-HIMS | Clinical Intelligence & Hospital Operating System');
    expect(layout).toContain("applicationName: 'G-HIMS'");
    expect(manifest).toContain("short_name: 'G-HIMS'");
    expect(manifest).toContain("'/icon.svg'");
  });
  test('public components do not import Firebase or privileged clinical APIs', async () => {
    for (const file of ['components/marketing/ghims-site.tsx','components/marketing/ghims-pages.tsx']) {
      const site = await source(file);
      expect(site).not.toContain("from 'firebase/");
      expect(site).not.toContain('/api/clinical/');
      expect(site).not.toContain('GHIMS_FIREBASE_PROJECT_ID_PRODUCTION');
    }
  });
});
