import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

interface RequiredEvidence {
  gate: 'P7A' | 'P7B' | 'P7C' | 'P7D' | 'P7E' | 'P7F' | 'P7G';
  file: string;
  description: string;
  humanGate?: boolean;
}

const evidenceDir = path.resolve(
  process.env.GHIMS_P7_EVIDENCE_DIR || path.join(process.cwd(), 'artifacts', 'p7')
);

const required: RequiredEvidence[] = [
  {
    gate: 'P7A',
    file: 'staging-smoke.json',
    description: 'STAGING readiness and fail-closed smoke result',
  },
  {
    gate: 'P7A',
    file: 'staging-deployment-evidence.txt',
    description: 'Frozen commit and deployment identity',
  },
  {
    gate: 'P7B',
    file: 'p7-device-offline-evidence.json',
    description: 'Real-device physical offline qualification',
    humanGate: true,
  },
  {
    gate: 'P7C',
    file: 'p7-hospital-day-evidence.json',
    description: 'Synthetic multi-role hospital-day rehearsal',
  },
  {
    gate: 'P7D',
    file: 'p7-backup-restore-evidence.json',
    description: 'Real export/import drill with measured RPO/RTO',
    humanGate: true,
  },
  {
    gate: 'P7D',
    file: 'p7-rollback-evidence.json',
    description: 'Known-good deployment rollback rehearsal',
    humanGate: true,
  },
  {
    gate: 'P7D',
    file: 'p7-alert-routing-evidence.json',
    description: 'External alert/log destination test',
    humanGate: true,
  },
  {
    gate: 'P7E',
    file: 'p7-independent-security-assessment.json',
    description: 'Independent security assessment metadata and retest outcome',
    humanGate: true,
  },
  {
    gate: 'P7F',
    file: 'p7-hospital0-consent.json',
    description: 'Hospital-0 written consent metadata',
    humanGate: true,
  },
  {
    gate: 'P7F',
    file: 'p7-hospital0-operational-log.json',
    description: 'Controlled pilot operational/incident log',
    humanGate: true,
  },
  {
    gate: 'P7G',
    file: 'p7-site-signoff.json',
    description: 'Operator/site qualification sign-off',
    humanGate: true,
  },
];

async function sha256(filePath: string): Promise<string> {
  const bytes = await readFile(filePath);
  return createHash('sha256').update(bytes).digest('hex');
}

async function inspectEvidence(item: RequiredEvidence) {
  const filePath = path.join(evidenceDir, item.file);
  try {
    const metadata = await stat(filePath);
    if (!metadata.isFile() || metadata.size === 0) {
      return {
        ...item,
        status: 'INVALID' as const,
        reason: 'Evidence path is not a non-empty file.',
      };
    }
    return {
      ...item,
      status: 'PRESENT' as const,
      sizeBytes: metadata.size,
      sha256: await sha256(filePath),
      modifiedAt: metadata.mtime.toISOString(),
    };
  } catch {
    return {
      ...item,
      status: 'MISSING' as const,
    };
  }
}

let discoveredFiles: string[] = [];
try {
  discoveredFiles = (await readdir(evidenceDir)).sort();
} catch {
  discoveredFiles = [];
}

const evidence = await Promise.all(required.map(inspectEvidence));
const gateNames = ['P7A', 'P7B', 'P7C', 'P7D', 'P7E', 'P7F', 'P7G'] as const;

const gates = Object.fromEntries(
  gateNames.map((gate) => {
    const items = evidence.filter((item) => item.gate === gate);
    const complete = items.every((item) => item.status === 'PRESENT');
    return [
      gate,
      {
        complete,
        present: items.filter((item) => item.status === 'PRESENT').length,
        required: items.length,
        missing: items
          .filter((item) => item.status !== 'PRESENT')
          .map((item) => item.file),
        humanOrExternalGate: items.some((item) => item.humanGate),
      },
    ];
  })
);

const complete = Object.values(gates).every((gate: any) => gate.complete);

const manifest = {
  schemaVersion: 1,
  program: 'P7 Controlled Live Pilot & TRL-6 Qualification',
  generatedAt: new Date().toISOString(),
  evidenceDirectory: evidenceDir,
  complete,
  trl6ClaimReady: complete,
  warning:
    complete
      ? null
      : 'P7 is not complete. Missing evidence must not be replaced by repository assertions or synthetic claims.',
  gates,
  evidence,
  discoveredFiles,
};

process.stdout.write(JSON.stringify(manifest, null, 2) + '\n');

if (String(process.env.GHIMS_P7_REQUIRE_COMPLETE || '').toLowerCase() === 'true' && !complete) {
  process.exit(2);
}
