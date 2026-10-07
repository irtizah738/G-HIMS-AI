import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  type Hospital0EvidenceFile,
  type Hospital0QualificationContext,
  validateHospital0Evidence,
} from '@/lib/qualification/hospital0-evidence';

type Gate =
  | 'H0_1_STAGING_DEPLOYMENT'
  | 'H0_2_IDENTITY_TENANT'
  | 'H0_3_PHYSICAL_OFFLINE'
  | 'H0_4_CROSS_ROLE'
  | 'H0_5_RESILIENCE'
  | 'H0_6_SECURITY_PERFORMANCE'
  | 'H0_7_CONTROLLED_PILOT';

interface Requirement {
  gate: Gate;
  file: Hospital0EvidenceFile;
  description: string;
  externalOrHumanGate?: boolean;
}

interface EvidenceInspection extends Requirement {
  status: 'PRESENT_VALID' | 'PRESENT_INVALID' | 'MISSING';
  issues: string[];
  sha256?: string;
  size?: number;
}

const evidenceDir = path.resolve(
  process.env.GHIMS_HOSPITAL0_QUALIFICATION_DIR ||
    path.join(process.cwd(), 'artifacts', 'hospital0-qualification')
);

const qualificationContext: Hospital0QualificationContext = {
  qualificationRunId: String(process.env.GHIMS_HOSPITAL0_QUALIFICATION_RUN_ID || '').trim(),
  gitCommitSha: String(
    process.env.GHIMS_HOSPITAL0_QUALIFICATION_SHA ||
      process.env.GITHUB_SHA ||
      ''
  ).trim(),
};

const contextIssues: string[] = [];
if (qualificationContext.qualificationRunId.length < 8) {
  contextIssues.push('QUALIFICATION_RUN_ID_REQUIRED');
}
if (!/^[0-9a-f]{40}$/i.test(qualificationContext.gitCommitSha)) {
  contextIssues.push('QUALIFICATION_COMMIT_SHA_REQUIRED');
}

const required: Requirement[] = [
  { gate: 'H0_1_STAGING_DEPLOYMENT', file: 'staging-deployment-evidence.json', description: 'Exact qualification commit deployed to remote HTTPS STAGING with a dedicated Firebase trust domain.', externalOrHumanGate: true },
  { gate: 'H0_1_STAGING_DEPLOYMENT', file: 'staging-smoke.json', description: 'Remote readiness/liveness/login/trust-boundary smoke evidence.' },
  { gate: 'H0_2_IDENTITY_TENANT', file: 'hospital0-identity-provisioning.json', description: 'Canonical synthetic Hospital-0 tenant, facility, departments and role identities provisioned in dedicated STAGING.' },
  { gate: 'H0_2_IDENTITY_TENANT', file: 'hospital0-credential-scope-review.json', description: 'Canonical Employee/Credential/Privilege, facility and department scope review.', externalOrHumanGate: true },
  { gate: 'H0_3_PHYSICAL_OFFLINE', file: 'hospital0-physical-offline.json', description: 'Physical-device offline/reconnect/shared-workstation qualification on at least two devices.', externalOrHumanGate: true },
  { gate: 'H0_4_CROSS_ROLE', file: 'hospital0-cross-role-rehearsal.json', description: 'Deployed Reception/Billing/Nursing/Doctor/Diagnostics/Pharmacy/IPD workflow evidence.' },
  { gate: 'H0_4_CROSS_ROLE', file: 'hospital0-opd-browser-e2e.json', description: 'Deployed OPD browser journey evidence.' },
  { gate: 'H0_5_RESILIENCE', file: 'hospital0-backup-restore.json', description: 'Real isolated Firestore export/import with measured RPO/RTO.', externalOrHumanGate: true },
  { gate: 'H0_5_RESILIENCE', file: 'hospital0-rollback.json', description: 'Known-good staging rollback/redeploy drill.', externalOrHumanGate: true },
  { gate: 'H0_5_RESILIENCE', file: 'hospital0-projection-recovery.json', description: 'Injected projection failure and clean deterministic rebuild evidence.' },
  { gate: 'H0_6_SECURITY_PERFORMANCE', file: 'hospital0-authenticated-load.json', description: 'Authenticated staging concurrency/load evidence with latency and error thresholds.' },
  { gate: 'H0_6_SECURITY_PERFORMANCE', file: 'hospital0-independent-security.json', description: 'Independent penetration/security assessment of the exact qualification commit with Critical/High retest outcome.', externalOrHumanGate: true },
  { gate: 'H0_6_SECURITY_PERFORMANCE', file: 'hospital0-alert-routing.json', description: 'External alert delivery and acknowledgement evidence.', externalOrHumanGate: true },
  { gate: 'H0_7_CONTROLLED_PILOT', file: 'hospital0-consent.json', description: 'Signed institutional pilot approval and governance scope.', externalOrHumanGate: true },
  { gate: 'H0_7_CONTROLLED_PILOT', file: 'hospital0-training-signoff.json', description: 'Approved participant list and training acknowledgement.', externalOrHumanGate: true },
  { gate: 'H0_7_CONTROLLED_PILOT', file: 'hospital0-daily-log.json', description: 'Controlled pilot operational/incident log.', externalOrHumanGate: true },
  { gate: 'H0_7_CONTROLLED_PILOT', file: 'hospital0-site-signoff.json', description: 'Final operator/site sign-off with unresolved Critical/High count.', externalOrHumanGate: true },
];

async function readEvidence(file: Hospital0EvidenceFile) {
  const filePath = path.join(evidenceDir, file);
  try {
    const metadata = await stat(filePath);
    if (!metadata.isFile() || metadata.size === 0) return null;
    const raw = await readFile(filePath);
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(raw.toString('utf8'));
    } catch {
      parsed = null;
    }
    return {
      size: metadata.size,
      sha256: createHash('sha256').update(raw).digest('hex'),
      parsed,
    };
  } catch {
    return null;
  }
}

const evidence: EvidenceInspection[] = [];
for (const requirement of required) {
  const item = await readEvidence(requirement.file);
  const issues = item
    ? contextIssues.length > 0
      ? [...contextIssues]
      : validateHospital0Evidence(requirement.file, item.parsed, qualificationContext)
    : ['MISSING_OR_INVALID_JSON'];

  evidence.push({
    ...requirement,
    status: issues.length === 0 ? 'PRESENT_VALID' : item ? 'PRESENT_INVALID' : 'MISSING',
    issues,
    sha256: item?.sha256,
    size: item?.size,
  });
}

const gateOrder: Gate[] = [
  'H0_1_STAGING_DEPLOYMENT',
  'H0_2_IDENTITY_TENANT',
  'H0_3_PHYSICAL_OFFLINE',
  'H0_4_CROSS_ROLE',
  'H0_5_RESILIENCE',
  'H0_6_SECURITY_PERFORMANCE',
  'H0_7_CONTROLLED_PILOT',
];

const gates = gateOrder.map((gate) => {
  const items = evidence.filter((item) => item.gate === gate);
  return {
    gate,
    complete: contextIssues.length === 0 && items.length > 0 && items.every((item) => item.status === 'PRESENT_VALID'),
    items,
  };
});

const complete = contextIssues.length === 0 && gates.every((gate) => gate.complete);
const firstIncompleteGate = gates.find((gate) => !gate.complete)?.gate || null;

const report = {
  schemaVersion: 2,
  program: 'G-HIMS Hospital-0 Deployment & Qualification',
  generatedAt: new Date().toISOString(),
  evidenceDirectory: evidenceDir,
  qualificationContext,
  contextIssues,
  complete,
  qualificationState: complete ? 'PILOT_QUALIFIED' : 'ENGINEERING_QUALIFIED',
  firstIncompleteGate,
  warning: complete
    ? null
    : 'Hospital-0 qualification is incomplete. Repository CI, templates, synthetic rehearsals and generated evidence cannot replace deployed, physical-device, independent-security or signed institutional evidence.',
  gates,
};

process.stdout.write(JSON.stringify(report, null, 2) + '\n');

if (
  String(process.env.GHIMS_HOSPITAL0_REQUIRE_COMPLETE || '').toLowerCase() === 'true' &&
  !complete
) {
  process.exitCode = 2;
}
