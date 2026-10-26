import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const source = (name: string) =>
  readFile(path.join(process.cwd(), name), 'utf8');

describe('Official G-HIMS AI website and application boundaries', () => {
  test('root keeps the authenticated hospital dashboard behind the existing guard', async () => {
    const page = await source('app/page.tsx');
    expect(page).toContain('useAuth()');
    expect(page).toContain('if (!user)');
    expect(page).toContain('<ClinicalIntelligenceLanding />');
    expect(page).toContain('<AuthGuard>');
    expect(page).toContain('<TenantDashboard />');
    expect(page).not.toContain('signIn(');
    expect(page).not.toContain('fetch(');
  });

  test('public site explains CI and OS without replacing hospital workflows', async () => {
    const site = await source('components/marketing/clinical-intelligence-landing.tsx');
    for (const anchor of ['why-ghims', 'experience', 'workflow', 'architecture', 'pilot']) {
      expect(site).toContain('id="' + anchor + '"');
    }
    expect(site).toContain('G-HIMS Clinical Intelligence');
    expect(site).toContain('G-HIMS OS');
    expect(site).toContain('Existing hospital systems');
    expect(site).toContain('Clinicians remain in control');
  });

  test('marketing preview is explicitly synthetic and does not claim clinical clearance', async () => {
    const site = await source('components/marketing/clinical-intelligence-landing.tsx');
    expect(site).toContain('Illustrative interface using synthetic concepts.');
    expect(site).toContain('Not a patient record or a validated clinical alert.');
    expect(site).toContain('not claims of clinical validation, regulatory clearance or general availability');
    expect(site).not.toContain('HIPAA certified');
    expect(site).not.toContain('FDA cleared');
    expect(site).not.toContain('100% accurate');
  });

  test('pilot contact is actionable only after the contact address is configured', async () => {
    const site = await source('components/marketing/clinical-intelligence-landing.tsx');
    expect(site).toContain('NEXT_PUBLIC_GHIMS_CONTACT_EMAIL');
    expect(site).toContain('pilotEmailHref ?');
    expect(site).toContain('mailto:');
    expect(site).toContain('href="#workflow"');
    expect(site).toContain('href="/login"');
    expect(site).not.toContain('contact@g-hims.com');
  });

  test('marketing does not touch clinical or authorization routes', async () => {
    const site = await source('components/marketing/clinical-intelligence-landing.tsx');
    expect(site).not.toContain('firebase');
    expect(site).not.toContain('/api/clinical/');
    expect(site).not.toContain('localStorage');
    const metadata = await source('app/layout.tsx');
    expect(metadata).toContain('G-HIMS AI | Clinical Intelligence for Hospitals');
  });
});
