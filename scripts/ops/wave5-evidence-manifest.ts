import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

interface RequiredEvidence {
  gate:
    | 'W5A_DEPLOYED_E2E'
    | 'W5B_LOAD_CONCURRENCY'
    | 'W5C_RECOVERY_ROLLBACK'
    | 'W5D_SECURITY'
    | 'W5E_OBSERVABILITY'
    | 'W5F_GOVERNANCE';
  file: string;
  description: string;
  externalOrHumanGate?: boolean;
}

const evidenceDir = path.resolve(
  process.env.GHIMS_WAVE5_EVIDENCE_DIR ||
    path.join(process.cwd(), 'artifacts', 'wave5')
);

const required: RequiredEvidence[] = [
  {
    gate: 'W5A_DEPLOYED_E2E',
    file: 'wave5-staging-smoke.json',
    description: 'Remote HTTPS STAGING readiness and fail-closed smoke evidence.',
  },
  {
    gate: 'W5A_DEPLOYED_E2E',
    file: 'wave5-p7-hospital-day.json',
    description: 'Authenticated multi-role synthetic hospital-day rehearsal.',
  },
  {
    gate: 'W5A_DEPLOYED_E2E',
    file: 'wave5-cross-domain-rehearsal.json',
    description: 'Authenticated clinical/finance/SCM/HCM/facilities cross-domain rehearsal.',
  },
  {
    gate: 'W5B_LOAD_CONCURRENCY',
    file: 'wave5-authenticated-load.json',
    description: 'Authenticated concurrent read-model load evidence with latency/error thresholds.',
  },
  {
    gate: 'W5C_RECOVERY_ROLLBACK',
    file: 'wave5-backup-restore.json',
    description: 'Real isolated Firestore export/import drill with measured RPO/RTO.',
    externalOrHumanGate: true,
  },
  {
    gate: 'W5C_RECOVERY_ROLLBACK',
    file: 'wave5-projection-failure-injection.json',
    description: 'Isolated projection rebuild failure injection evidence.',
  },
  {
    gate: 'W5C_RECOVERY_ROLLBACK',
    file: 'wave5-projection-rebuild.json',
    description: 'Clean deterministic projection rebuild after failure injection.',
  },
  {
    gate: 'W5C_RECOVERY_ROLLBACK',
    file: 'wave5-rollback-rehearsal.json',
    description: 'Known-good deployment rollback/redeploy rehearsal evidence.',
    externalOrHumanGate: true,
  },
  {
    gate: 'W5D_SECURITY',
    file: 'wave5-independent-pentest.json',
    description: 'Independent penetration assessment and retest outcome.',
    externalOrHumanGate: true,
  },
  {
    gate: 'W5E_OBSERVABILITY',
    file: 'wave5-operational-check.json',
    description: 'Outbox/backlog/lease operational health evidence.',
  },
  {
    gate: 'W5E_OBSERVABILITY',
    file: 'wave5-alert-routing.json',
    description: 'External alert destination routing and acknowledgement evidence.',
    externalOrHumanGate: true,
  },
  {
    gate: 'W5F_GOVERNANCE',
    file: 'wave5-retention-governance.json',
    description: 'Deployment retention policy approval and runtime preflight evidence.',
    externalOrHumanGate: true,
  },
];

async function sha256(filePath: string): Promise<string> {
  return createHash('sha256').update(await readFile(filePath)).digest('hex');
}

async function inspect(item: RequiredEvidence) {
  const filePath = path.join(evidenceDir, item.file);
  try {
    const metadata = await stat(filePath);
    if (!metadata.isFile() || metadata.size === 0) {
      return { ...item, status: 'INVALID' as const };
    }
    return {
      ...item,
      status: 'PRESENT' as const,
      sizeBytes: metadata.size,
      sha256: await sha256(filePath),
      modifiedAt: metadata.mtime.toISOString(),
    };
  } catch {
    return { ...item, status: 'MISSING' as const };
  }
}

let discoveredFiles: string[] = [];
try {
  discoveredFiles = (await readdir(evidenceDir)).sort();
} catch {
  discoveredFiles = [];
}

const evidence = await Promise.all(required.map(inspect));
const gateNames = [
  'W5A_DEPLOYED_E2E',
  'W5B_LOAD_CONCURRENCY',
  'W5C_RECOVERY_ROLLBACK',
  'W5D_SECURITY',
  'W5E_OBSERVABILITY',
  'W5F_GOVERNANCE',
] as const;

const gates = Object.fromEntries(
  gateNames.map((gate) => {
    const items = evidence.filter((item) => item.gate === gate);
    return [
      gate,
      {
        complete: items.every((item) => item.status === 'PRESENT'),
        present: items.filter((item) => item.status === 'PRESENT').length,
        required: items.length,
        missing: items
          .filter((item) => item.status !== 'PRESENT')
          .map((item) => item.file),
        externalOrHumanGate: items.some((item) => item.externalOrHumanGate),
      },
    ];
  })
);

const complete = Object.values(gates).every(
  (gate) => (gate as { complete: boolean }).complete
);

const result = {
  schemaVersion: 1,
  program: 'Wave 5 Enterprise Hardening',
  generatedAt: new Date().toISOString(),
  evidenceDirectory: evidenceDir,
  stagingAndPilotEvidenceComplete: complete,
  productionQualified: false,
  warning: complete
    ? 'Wave 5 evidence is complete for controlled staging/pilot qualification. Production qualification still requires site-specific operational approval and live integration/security obligations.'
    : 'Wave 5 is not externally complete. Missing evidence must not be replaced by repository assertions or synthetic claims.',
  gates,
  evidence,
  discoveredFiles,
};

process.stdout.write(JSON.stringify(result, null, 2) + '\n');

if (
  String(process.env.GHIMS_WAVE5_REQUIRE_COMPLETE || '').toLowerCase() ===
    'true' &&
  !complete
) {
  process.exit(2);
}
