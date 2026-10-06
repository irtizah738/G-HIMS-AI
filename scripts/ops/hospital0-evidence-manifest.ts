import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

interface Requirement {
  file: string;
  description: string;
}

const evidenceDir = path.resolve(
  process.env.GHIMS_HOSPITAL0_EVIDENCE_DIR ||
    path.join(process.cwd(), 'artifacts', 'hospital0')
);

const requirements: Requirement[] = [
  { file: 'hospital0-consent.json', description: 'Institutional pilot consent metadata' },
  { file: 'clinical-collaborator-attestation.json', description: 'Signed clinical collaborator attestation metadata' },
  { file: 'hospital0-metrics.json', description: 'Aggregate pilot metrics' },
  { file: 'hospital0-daily-log.json', description: 'Operational log for the pilot window' },
  { file: 'hospital0-site-signoff.json', description: 'Final site/operator sign-off' },
];

async function readJson(file: string): Promise<any | null> {
  const filePath = path.join(evidenceDir, file);
  try {
    const metadata = await stat(filePath);
    if (!metadata.isFile() || metadata.size === 0) return null;
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch {
    return null;
  }
}

const evidence = [];
for (const requirement of requirements) {
  const body = await readJson(requirement.file);
  const issues: string[] = [];

  if (!body) {
    issues.push('MISSING_OR_INVALID_JSON');
  } else if (requirement.file === 'hospital0-consent.json') {
    if (body.status !== 'SIGNED') issues.push('CONSENT_NOT_SIGNED');
    if (!body.hospital?.legalName) issues.push('HOSPITAL_LEGAL_NAME_REQUIRED');
    if (!body.hospital?.pilotOwnerName) issues.push('PILOT_OWNER_REQUIRED');
    if (!body.dataGovernance?.livePilotUseApproved) issues.push('LIVE_PILOT_APPROVAL_REQUIRED');
    if (!Array.isArray(body.signatories) || body.signatories.length === 0) {
      issues.push('CONSENT_SIGNATORY_REQUIRED');
    }
  } else if (requirement.file === 'clinical-collaborator-attestation.json') {
    if (body.status !== 'SIGNED') issues.push('COLLABORATOR_ATTESTATION_NOT_SIGNED');
    if (!body.collaborator?.name) issues.push('COLLABORATOR_NAME_REQUIRED');
    if (!body.collaborator?.professionalTitle) issues.push('COLLABORATOR_TITLE_REQUIRED');
    if (!body.attestsTo?.reviewedClinicalAuthorityBoundary) {
      issues.push('AUTHORITY_BOUNDARY_ATTESTATION_REQUIRED');
    }
    if (!body.attestsTo?.observedSystemInRelevantEnvironment) {
      issues.push('RELEVANT_ENVIRONMENT_OBSERVATION_REQUIRED');
    }
  } else if (requirement.file === 'hospital0-metrics.json') {
    if (body.status !== 'FINAL') issues.push('METRICS_NOT_FINAL');
    if (!body.frozenCommitSha) issues.push('FROZEN_COMMIT_REQUIRED');
    if (Number(body.pilot?.clinicianCount || 0) <= 0) issues.push('CLINICIAN_COUNT_REQUIRED');
    if (Number(body.pilot?.encounterCount || 0) <= 0) issues.push('ENCOUNTER_COUNT_REQUIRED');
    const clinical = body.clinicalMetrics || {};
    if (Number(clinical.totalFactualClaims || 0) <= 0) issues.push('FACTUAL_CLAIMS_REQUIRED');
    if (Number(clinical.criticalFactsExpected || 0) <= 0) issues.push('CRITICAL_FACTS_REQUIRED');
  } else if (requirement.file === 'hospital0-daily-log.json') {
    if (!body.date) issues.push('LOG_DATE_REQUIRED');
    if (!body.site) issues.push('LOG_SITE_REQUIRED');
    if (Number(body.encountersObserved || 0) <= 0) issues.push('OBSERVED_ENCOUNTERS_REQUIRED');
    if (!body.operatorName) issues.push('OPERATOR_REQUIRED');
  } else if (requirement.file === 'hospital0-site-signoff.json') {
    if (body.status !== 'SIGNED') issues.push('SITE_SIGNOFF_NOT_SIGNED');
    if (!body.scopeReviewed) issues.push('SCOPE_REVIEW_REQUIRED');
    if (!body.quantitativeResultsReviewed) issues.push('RESULTS_REVIEW_REQUIRED');
    if (!body.incidentsReviewed) issues.push('INCIDENT_REVIEW_REQUIRED');
    if (Number(body.unresolvedCriticalIssues || 0) > 0) issues.push('UNRESOLVED_CRITICAL_ISSUES');
    if (Number(body.unresolvedHighIssues || 0) > 0) issues.push('UNRESOLVED_HIGH_ISSUES');
    if (!Array.isArray(body.signatories) || body.signatories.length === 0) {
      issues.push('SITE_SIGNATORY_REQUIRED');
    }
  }

  evidence.push({
    ...requirement,
    status: issues.length === 0 ? 'PRESENT_VALID' : body ? 'PRESENT_INVALID' : 'MISSING',
    issues,
  });
}

const complete = evidence.every((item) => item.status === 'PRESENT_VALID');

const report = {
  schemaVersion: 1,
  program: 'G-HIMS Clinical Intelligence Hospital-0 Evidence',
  evidenceDirectory: evidenceDir,
  generatedAt: new Date().toISOString(),
  complete,
  hospital0EvidenceReady: complete,
  warning: complete
    ? null
    : 'Hospital-0 evidence is incomplete. Templates, repository assertions and synthetic validation are not substitutes for signed institutional evidence.',
  evidence,
};

process.stdout.write(JSON.stringify(report, null, 2) + '\n');

if (
  String(process.env.GHIMS_HOSPITAL0_REQUIRE_COMPLETE || '').toLowerCase() ===
    'true' &&
  !complete
) {
  process.exitCode = 2;
}
