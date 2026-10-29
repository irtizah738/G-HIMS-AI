import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), 'utf8');

describe('Helixis AI brand surface and infrastructure boundary', () => {
  test('public app identity and install metadata use the approved Helixis names', () => {
    expect(read('app/layout.tsx')).toContain('Helixis AI | Clinical Intelligence & Health Platform');
    expect(read('metadata.json')).toContain('Helixis AI | Clinical Intelligence & Health Platform');
    const manifest = read('app/manifest.ts');
    expect(manifest).toContain("name: 'Helixis AI | Helixis Health Platform'");
    expect(manifest).toContain("short_name: 'Helixis'");
    expect(manifest).toContain("src: '/icon.svg'");
    expect(manifest).not.toContain('/icon.png');
  });

  test('the original shared icon uses the investor-demo Helixis palette', () => {
    const mark = read('components/branding/HelixisMark.tsx');
    const icon = read('app/icon.svg');
    for (const color of ['#0B132B', '#48CAE4', '#00F5D4']) {
      expect(mark + icon).toContain(color);
    }
    expect(mark).toContain('aria-hidden="true"');
  });

  test('customer-facing login, facility and hospital shell labels are no longer G-HIMS', () => {
    const checks: Record<string, string> = {
      'components/auth/login-portal.tsx': 'Sign In to Helixis AI',
      'app/forgot-password/page.tsx': 'Helixis AI',
      'app/tenant-selection/page.tsx': 'Helixis AI',
      'components/tenant-dashboard.tsx': 'Helixis AI',
      'components/navigation/collapsible-sidebar.tsx': 'Helixis Health Platform',
      'app/[tenantId]/settings/page.tsx': 'Helixis Health Platform',
      'components/tenant/tenant-route-authority-guard.tsx': 'Sign In to Helixis AI',
      'components/navigation/command-palette.tsx': 'Helixis Command Palette',
    };
    for (const [path, requiredLabel] of Object.entries(checks)) {
      const source = read(path);
      expect(source, path).toContain(requiredLabel);
      expect(source, path).not.toContain('G-HIMS OS');
      expect(source, path).not.toContain('Sign In to G-HIMS');
    }
  });

  test('do not rename persisted machine contracts or backend service identities', () => {
    expect(read('package.json')).toContain('"name": "g-hims-applet"');
    expect(read('app/api/health/clinical-intelligence/route.ts')).toContain("'g-hims-clinical-intelligence'");
    expect(read('app/[tenantId]/layout.tsx')).toContain('data-ghims-shell="tenant"');
    expect(read('lib/auth/auth-session.ts')).toContain('ghims_workstation_device_id');
  });
});
