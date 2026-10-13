import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const source = (file: string) => readFile(path.join(process.cwd(), file), 'utf8');

describe('G-HIMS P7 controlled live pilot qualification', () => {
  test('P7 evidence manifest refuses to equate code assertions with external evidence', async () => {
    const manifest = await source('scripts/ops/p7-evidence-manifest.ts');

    expect(manifest).toContain('p7-device-offline-evidence.json');
    expect(manifest).toContain('p7-backup-restore-evidence.json');
    expect(manifest).toContain('p7-independent-security-assessment.json');
    expect(manifest).toContain('p7-hospital0-consent.json');
    expect(manifest).toContain('p7-site-signoff.json');
    expect(manifest).toContain('trl6ClaimReady: complete');
    expect(manifest).toContain('GHIMS_P7_REQUIRE_COMPLETE');
    expect(manifest).toContain('repository assertions or synthetic claims');
  });

  test('P7 protocol keeps real-device and hospital-environment proof mandatory', async () => {
    const protocol = await source('docs/operations/P7_CONTROLLED_LIVE_PILOT_TRL6.md');

    expect(protocol).toContain('P7B — Real-device offline qualification');
    expect(protocol).toContain('physical network disconnect');
    expect(protocol).toContain('P7E — Independent security assessment');
    expect(protocol).toContain('P7F — Hospital-0 controlled pilot');
    expect(protocol).toContain('written site consent');
    expect(protocol).toContain('Code or CI success alone is not a TRL-6 claim');
  });

  test('P7 does not loosen the P6 offline qualification protocol', async () => {
    const p6 = await source('docs/operations/OFFLINE_FIRST_QUALIFICATION.md');
    const p7 = await source('docs/operations/P7_CONTROLLED_LIVE_PILOT_TRL6.md');

    expect(p6).toContain('Physically disable network access');
    expect(p6).toContain('no duplicate patient/order/note/stock movement');
    expect(p6).toContain('requires_review');
    expect(p7).toContain('docs/operations/OFFLINE_FIRST_QUALIFICATION.md');
  });
});
