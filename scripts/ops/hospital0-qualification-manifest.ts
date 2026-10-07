import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

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
  file: string;
  description: string;
  externalOrHumanGate?: boolean;
}

const evidenceDir = path.resolve(
  process.env.GHIMS_HOSPITAL0_QUALIFICATION_DIR ||
    path.join(process.cwd(), 'artifacts', 'hospital0-qualification')
);

const required: Requirement[] = [
  {
    gate: 'H0_1_STAGING_DEPLOYMENT',
    file: 'staging-deployment-evidence.json',
    description: 'Exact current main deployed to remote HTTPS STAGING with dedicated Firebase trust domain.',
    externalOrHumanGate: true,
  },
  {
    gate: 'H0_1_STAGING_DEPLOYMENT',
    file: 'staging-smoke.json',
    description: 'Remote readiness/liveness/login/trust-boundary smoke evidence.',
  },
  {
    gate: 'H0_2_IDENTITY_TENANT',
    file: 'hospital0-identity-provisioning.json',
    description: 'Canonical synthetic Hospital-0 tenant, facility, departments and role identities provisioned in dedicated STAGING.',
  },
  {
    gate: 'H0_2_IDENTITY_TENANT',
    file: 'hospital0-credential-scope-review.json',
    description: 'Role, facility, department and clinical privilege scope review.',
    externalOrHumanGate: true,
  },
  {
    gate: 'H0_3_PHYSICAL_OFFLINE',
    file: 'hospital0-physical-offline.json',
    description: 'Physical-device offline/reconnect/shared-workstation qualification on at least two devices.',
    externalOrHumanGate: true,
  },
  {
    gate: 'H0_4_CROSS_ROLE',
    file: 'hospital0-cross-role-rehearsal.json',
    description: 'Deployed Reception/Billing/Nursing/Doctor/Diagnostics/Pharmacy/IPD workflow evidence.',
  },
  {
    gate: 'H0_4_CROSS_ROLE',
    file: 'hospital0-opd-browser-e2e.json',
    description: 'Deployed OPD browser journey evidence.',
  },
  {
    gate: 'H0_5_RESILIENCE',
    file: 'hospital0-backup-restore.json',
    description: 'Real isolated Firestore export/import with measured RPO/RTO.',
    externalOrHumanGate: true,
  },
  {
    gate: 'H0_5_RESILIENCE',
    file: 'hospital0-rollback.json',
    description: 'Known-good staging rollback/redeploy drill.',
    externalOrHumanGate: true,
  },
  {
    gate: 'H0_5_RESILIENCE',
    file: 'hospital0-projection-recovery.json',
    description: 'Injected projection failure and clean deterministic rebuild evidence.',
  },
  {
    gate: 'H0_6_SECURITY_PERFORMANCE',
    file: 'hospital0-authenticated-load.json',
    description: 'Authenticated staging concurrency/load evidence with latency and error thresholds.',
  },
  {
    gate: 'H0_6_SECURITY_PERFORMANCE',
    file: 'hospital0-independent-security.json',
    description: 'Independent penetration/security assessment with Critical/High retest outcome.',
    externalOrHumanGate: true,
  },
  {
    gate: 'H0_6_SECURITY_PERFORMANCE',
    file: 'hospital0-alert-routing.json',
    description: 'External alert delivery and acknowledgement evidence.',
    externalOrHumanGate: true,
  },
  {
    gate: 'H0_7_CONTROLLED_PILOT',
    file: 'hospital0-consent.json',
    description: 'Signed institutional pilot approval and governance scope.',
    externalOrHumanGate: true,
  },
  {
    gate: 'H0_7_CONTROLLED_PILOT',
    file: 'hospital0-training-signoff.json',
    description: 'Approved participant list and training acknowledgement.',
    externalOrHumanGate: true,
  },
  {
    gate: 'H0_7_CONTROLLED_PILOT',
    file: 'hospital0-daily-log.json',
    description: 'Controlled pilot operational/incident log.',
    externalOrHumanGate: true,
  },
  {
    gate: 'H0_7_CONTROLLED_PILOT',
    file: 'hospital0-site-signoff.json',
    description: 'Final operator/site sign-off with unresolved Critical/High count.',
    externalOrHumanGate: true,
  },
];

async function readEvidence(file: string) {
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
      path: filePath,
      size: metadata.size,
      sha256: createHash('sha256').update(raw).digest('hex'),
      parsed,
    };
  } catch {
    return null;
  }
}

function validate(requirement: Requirement, body: any): string[] {
  const issues: string[] = [];
  if (!body || typeof body !== 'object') return ['MISSING_OR_INVALID_JSON'];

  if (requirement.file === 'staging-deployment-evidence.json') {
    if (!body.mainSha) issues.push('MAIN_SHA_REQUIRED');
    if (body.runtime !== 'STAGING') issues.push('STAGING_RUNTIME_REQUIRED');
    if (!String(body.deploymentUrl || '').startsWith('https://')) issues.push('REMOTE_HTTPS_DEPLOYMENT_REQUIRED');
    if (!body.firebaseProjectId) issues.push('DEDICATED_FIREBASE_PROJECT_REQUIRED');
    if (body.firebaseProjectId === body.demoProjectId || body.firebaseProjectId === body.productionProjectId) {
      issues.push('FIREBASE_PROJECT_COLLISION');
    }
  }

  if (requirement.file === 'hospital0-physical-offline.json') {
    if (!Array.isArray(body.devices) || body.devices.length < 2) issues.push('TWO_PHYSICAL_DEVICES_REQUIRED');
    if (body.syntheticToggleOnly === true) issues.push('SYNTHETIC_OFFLINE_TOGGLE_NOT_EVIDENCE');
    if (body.zeroDuplicateReplay !== true) issues.push('ZERO_DUPLICATE_REPLAY_REQUIRED');
    if (body.sharedWorkstationActorIsolation !== true) issues.push('SHARED_WORKSTATION_ACTOR_ISOLATION_REQUIRED');
  }

  if (requirement.file === 'hospital0-independent-security.json') {
    if (!body.assessor) issues.push('INDEPENDENT_ASSESSOR_REQUIRED');
    if (!body.testedCommitSha) issues.push('TESTED_COMMIT_REQUIRED');
    if (Number(body.unresolvedCritical || 0) > 0) issues.push('UNRESOLVED_CRITICAL_SECURITY');
    if (Number(body.unresolvedHigh || 0) > 0) issues.push('UNRESOLVED_HIGH_SECURITY');
    if (body.retestCompleted !== true) issues.push('SECURITY_RETEST_REQUIRED');
  }

  if (requirement.file === 'hospital0-consent.json') {
    if (body.status !== 'SIGNED') issues.push('CONSENT_NOT_SIGNED');
    if (body.livePilotUseApproved !== true && body.dataGovernance?.livePilotUseApproved !== true) {
      issues.push('LIVE_PILOT_APPROVAL_REQUIRED');
    }
  }

  if (requirement.file === 'hospital0-site-signoff.json') {
    if (body.status !== 'SIGNED') issues.push('SITE_SIGNOFF_NOT_SIGNED');
    if (Number(body.unresolvedCriticalIssues || 0) > 0) issues.push('UNRESOLVED_CRITICAL_ISSUES');
    if (Number(body.unresolvedHighIssues || 0) > 0) issues.push('UNRESOLVED_HIGH_ISSUES');
  }

  if ('success' in body && body.success !== true) issues.push('EVIDENCE_REPORTS_FAILURE');
  return issues;
}

const evidence = [];
for (const requirement of required) {
  const item = await readEvidence(requirement.file);
  const issues = item ? validate(requirement, item.parsed) : ['MISSING_OR_INVALID_JSON'];
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
    complete: items.length > 0 && items.every((item) => item.status === 'PRESENT_VALID'),
    items,
  };
});

const complete = gates.every((gate) => gate.complete);
const firstIncompleteGate = gates.find((gate) => !gate.complete)?.gate || null;

const report = {
  schemaVersion: 1,
  program: 'G-HIMS Hospital-0 Deployment & Qualification',
  generatedAt: new Date().toISOString(),
  evidenceDirectory: evidenceDir,
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
