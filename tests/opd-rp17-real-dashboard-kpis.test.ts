import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const source = (file: string) =>
  readFile(path.join(process.cwd(), file), 'utf8');

describe('OPD-RP17 real dashboard KPIs', () => {
  test('dashboard removes fabricated operational claims', async () => {
    const dashboard = await source('components/opd/OpdDashboardKpis.tsx');

    for (const fabricated of [
      '+14% vs yesterday',
      'Avg wait: 14.2 min',
      'Avg consult: 16.5 min',
      'Total Throughput: 18.4 pts/hr',
      'Zero Revenue Leakage',
      'All Vitals Stable',
    ]) {
      expect(dashboard).not.toContain(fabricated);
    }
    expect(dashboard).toContain('Current authorized snapshot');
    expect(dashboard).toContain(
      'No high-risk signal in visible snapshot'
    );
  });

  test('dashboard uses canonical OPD stages while tolerating migration aliases', async () => {
    const dashboard = await source('components/opd/OpdDashboardKpis.tsx');

    expect(dashboard).toContain("'REGISTRATION'");
    expect(dashboard).toContain("'QUEUE'");
    expect(dashboard).toContain("'TRIAGE'");
    expect(dashboard).toContain("'CONSULTATION'");
    expect(dashboard).toContain("'DIAGNOSTICS_LAB_RAD'");
    expect(dashboard).toContain("'PHARMACY_DISPENSARY'");
    expect(dashboard).toContain("'BILLING_SETTLEMENT'");
    expect(dashboard).toContain("'DISPOSITION'");
    expect(dashboard).toContain("'QUEUE_ASSIGNMENT'");
    expect(dashboard).toContain("'NURSING_INTAKE'");
    expect(dashboard).toContain("'SPECIALTY_CONSULTATION'");
  });

  test('queue KPIs are derived from authoritative queue timestamps', async () => {
    const dashboard = await source('components/opd/OpdDashboardKpis.tsx');

    expect(dashboard).toContain('queue: QueueEntry[]');
    expect(dashboard).toContain("'WAITING', 'CALLED', 'IN_SERVICE'");
    expect(dashboard).toContain('token.issuedAt || token.createdAt');
    expect(dashboard).toContain('token.serviceStartedAt');
    expect(dashboard).toContain('Observed token→service');
    expect(dashboard).toContain('No completed wait samples');
  });

  test('dashboard does not manufacture clinician or department identities', async () => {
    const dashboard = await source('components/opd/OpdDashboardKpis.tsx');

    expect(dashboard).not.toContain("'doc-default'");
    expect(dashboard).not.toContain("'Attending Physician'");
    expect(dashboard).not.toContain("'General Practice'");
    expect(dashboard).not.toContain("'GENERAL_MEDICINE'");
    expect(dashboard).toContain("'UNASSIGNED'");
    expect(dashboard).toContain("'Unassigned clinician'");
  });

  test('department percentages are represented without fake minimum bars', async () => {
    const dashboard = await source('components/opd/OpdDashboardKpis.tsx');

    expect(dashboard).not.toContain('Math.max(pct, 12)');
    expect(dashboard).toContain('style={{ width:');
    expect(dashboard).toContain('percentage');
  });

  test('dashboard explicitly labels metrics as authorized visible scope', async () => {
    const dashboard = await source('components/opd/OpdDashboardKpis.tsx');

    expect(dashboard).toContain(
      'Counts are derived only from the server-authorized OPD read model visible'
    );
    expect(dashboard).toContain(
      'No tenant-wide or historical trend is inferred from'
    );
    expect(dashboard).toContain('Visible OPD Encounters');
    expect(dashboard).toContain('Visible Department Distribution');
    expect(dashboard).toContain('Visible Clinician Workload');
  });

  test('workspace passes authoritative queue and enforces role-safe KPI navigation', async () => {
    const workspace = await source('components/opd/OpdMasterWorkspace.tsx');

    expect(workspace).toContain('queue={queue}');
    expect(workspace).toContain("if (canAccessTab('CONSULTATION'))");
    expect(workspace).toContain('if (canAccessTab(stage))');
    expect(workspace).not.toContain(
      "else if (stage === 'QUEUE_ASSIGNMENT') setActiveTab('QUEUE')"
    );
  });
});
