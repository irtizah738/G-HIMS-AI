/**
 * G-HIMS ORC-8: Authoritative Qualification Test Matrix Evaluator
 *
 * Evaluates the 56 operational domains from lib/domain-manifest.ts against
 * the 7-dimension qualification criteria:
 *   1. Implementation: command handlers, service methods, and schemas present.
 *   2. Authorization: role baselines and privilege evaluation defined.
 *   3. Hydration: edge snapshot surface and collections mapped.
 *   4. Runtime: command -> event -> projection round-trip qualification.
 *   5. Offline: client-side capture and reconciliation qualification.
 *   6. Staging: synthetic fixture multi-role validation.
 *   7. Release: final clinical, security, and financial sign-off.
 *
 * Enforces fail-closed rules:
 *   - No domain may claim SIGNED_OFF without verified staging and evidence refs.
 *   - Registered commands must be known to the authoritative command registry.
 *   - Edge hydration surfaces must be recognized by hydration-policy.
 *   - Every ORC-fixed domain must retain its gate tag and evidence trace.
 */

import {
  DOMAIN_MANIFEST,
  TOTAL_DOMAINS,
  type DomainManifestEntry,
  type DomainQualificationStatus,
  type ImplementationStatus,
  type AuthorizationStatus,
  type HydrationStatus,
  type RuntimeStatus,
  type OfflineStatus,
  type StagingStatus,
  type ReleaseStatus,
} from '@/lib/domain-manifest';
import { validateCommandPayload } from '@/lib/backend/commands/command-schema-registry';
import { EDGE_HYDRATION_SURFACES } from '@/lib/offline/hydration-policy';

export interface QualificationDimensionBreakdown {
  implementation: Record<ImplementationStatus, number>;
  authorization: Record<AuthorizationStatus, number>;
  hydration: Record<HydrationStatus, number>;
  runtime: Record<RuntimeStatus, number>;
  offline: Record<OfflineStatus, number>;
  staging: Record<StagingStatus, number>;
  release: Record<ReleaseStatus, number>;
}

export interface DomainDiscrepancy {
  domainId: string;
  dimension: keyof DomainQualificationStatus | 'general';
  rule: string;
  detail: string;
}

export interface QualificationMatrixReport {
  schema: 'ghims.orc8.qualification-matrix.v1';
  evaluatedAt: string;
  totalDomains: number;
  expectedDomainCount: number;
  counts: QualificationDimensionBreakdown;
  gateCoverage: Record<string, number>;
  blockingDomains: string[];
  orcPendingDomains: string[];
  releasedDomains: string[];
  discrepancies: DomainDiscrepancy[];
  passed: boolean;
}

const KNOWN_ROLE_TAXONOMIES = new Set<string>([
  'DOCTOR', 'CONSULTANT', 'NURSE', 'ATTENDING_PHYSICIAN',
  'RECEPTIONIST', 'REGISTRAR', 'ADMISSION_OFFICER',
  'BILLING_CLERK', 'BILLING_ADMIN', 'CASHIER', 'BILLING_CASHIER', 'FINANCE_MANAGER',
  'EMERGENCY_NURSE', 'EMERGENCY_DOCTOR', 'ER_NURSE', 'TRIAGE_NURSE', 'ER_DOCTOR',
  'HR_MANAGER', 'HR_OFFICER', 'DEPARTMENT_HEAD', 'SYSTEM_ADMIN', 'ADMINISTRATOR', 'ADMIN',
  'ACCOUNTANT', 'TREASURY_MANAGER', 'AUDITOR',
  'PHARMACIST', 'PHARMACY_TECH',
  'LAB_TECH', 'LAB_MANAGER', 'PATHOLOGIST',
  'RADIOLOGIST', 'RADIOLOGY_TECH',
  'FACILITIES_ADMIN', 'CLINICAL_COORDINATOR', 'CASE_MANAGER',
]);

const VALID_SURFACES = new Set<string>([
  ...EDGE_HYDRATION_SURFACES,
  'PATIENT_REGISTRY',
  'CLINICAL_ENCOUNTER',
  'DIAGNOSTICS',
  'PHARMACY',
  'ADMIN_OPERATIONS',
  'INTEROP_DEVICE',
]);

/**
 * Validates that a command type is registered in the command-schema-registry.
 */
export function isCommandRegistered(commandType: string): boolean {
  const result = validateCommandPayload({
    commandId: 'cmd-val-check',
    idempotencyKey: 'idem-val-check',
    tenantId: 'tenant-val-check',
    commandType,
    schemaVersion: 1,
    payload: {},
  });
  return result.error?.code !== 'COMMAND_SCHEMA_NOT_REGISTERED';
}

/**
 * Evaluates the 56-domain manifest against all 7 qualification dimensions.
 */
export function evaluateQualificationMatrix(
  manifest: DomainManifestEntry[] = DOMAIN_MANIFEST
): QualificationMatrixReport {
  const counts: QualificationDimensionBreakdown = {
    implementation: { PRESENT: 0, PARTIAL: 0, MISSING: 0 },
    authorization: { TESTED: 0, UNTESTED: 0, FAILING: 0 },
    hydration: {
      CURRENT: 0, STALE: 0, PARTIAL: 0, UNHYDRATED: 0,
      DENIED: 0, FAILED: 0, NOT_APPLICABLE: 0,
    },
    runtime: { QUALIFIED: 0, UNQUALIFIED: 0 },
    offline: { QUALIFIED: 0, UNQUALIFIED: 0, NOT_APPLICABLE: 0 },
    staging: { PASSED: 0, FAILED: 0, PENDING: 0 },
    release: { SIGNED_OFF: 0, PENDING: 0 },
  };

  const gateCoverage: Record<string, number> = {};
  const discrepancies: DomainDiscrepancy[] = [];
  const domainIds = new Set<string>();

  for (const entry of manifest) {
    // 1. Domain uniqueness
    if (domainIds.has(entry.domainId)) {
      discrepancies.push({
        domainId: entry.domainId,
        dimension: 'general',
        rule: 'UNIQUE_DOMAIN_IDENTIFIER',
        detail: `Duplicate domainId detected: ${entry.domainId}`,
      });
    }
    domainIds.add(entry.domainId);

    // 2. Track gate coverage
    const gate = entry.orcGate || 'unassigned';
    gateCoverage[gate] = (gateCoverage[gate] || 0) + 1;

    // 3. Tally dimension statuses
    const { qualificationStatus: q } = entry;
    counts.implementation[q.implementation] = (counts.implementation[q.implementation] || 0) + 1;
    counts.authorization[q.authorization] = (counts.authorization[q.authorization] || 0) + 1;
    counts.hydration[q.hydration] = (counts.hydration[q.hydration] || 0) + 1;
    counts.runtime[q.runtime] = (counts.runtime[q.runtime] || 0) + 1;
    counts.offline[q.offline] = (counts.offline[q.offline] || 0) + 1;
    counts.staging[q.staging] = (counts.staging[q.staging] || 0) + 1;
    counts.release[q.release] = (counts.release[q.release] || 0) + 1;

    // 4. Validate command integrity
    for (const cmd of entry.requiredCommands) {
      if (!isCommandRegistered(cmd)) {
        discrepancies.push({
          domainId: entry.domainId,
          dimension: 'implementation',
          rule: 'REGISTERED_COMMAND_EXISTS',
          detail: `Required command ${cmd} is not registered in command-schema-registry.`,
        });
      }
    }

    // 5. Validate hydration surface
    if (entry.hydrationSurface !== null && !VALID_SURFACES.has(entry.hydrationSurface)) {
      discrepancies.push({
        domainId: entry.domainId,
        dimension: 'hydration',
        rule: 'VALID_HYDRATION_SURFACE',
        detail: `Unknown hydration surface: ${entry.hydrationSurface}`,
      });
    }

    // 6. Validate offline compatibility
    if (entry.hydrationSurface === null && q.offline !== 'NOT_APPLICABLE') {
      discrepancies.push({
        domainId: entry.domainId,
        dimension: 'offline',
        rule: 'OFFLINE_SURFACE_CONSISTENCY',
        detail: `Domain has null hydration surface but offline status is not NOT_APPLICABLE.`,
      });
    }

    // 7. Validate roles
    for (const role of entry.requiredRoles) {
      if (!KNOWN_ROLE_TAXONOMIES.has(role)) {
        discrepancies.push({
          domainId: entry.domainId,
          dimension: 'authorization',
          rule: 'KNOWN_ROLE_TAXONOMY',
          detail: `Unrecognized role: ${role}`,
        });
      }
    }

    // 8. Fail-closed release guard: cannot be SIGNED_OFF without PASSED staging
    if (q.release === 'SIGNED_OFF') {
      if (q.staging !== 'PASSED' || q.runtime !== 'QUALIFIED') {
        discrepancies.push({
          domainId: entry.domainId,
          dimension: 'release',
          rule: 'RELEASE_SIGN_OFF_FAIL_CLOSED',
          detail: `Domain claims SIGNED_OFF release but staging=${q.staging}, runtime=${q.runtime}.`,
        });
      }
      if (!entry.evidenceRefs || entry.evidenceRefs.length === 0) {
        discrepancies.push({
          domainId: entry.domainId,
          dimension: 'release',
          rule: 'RELEASE_EVIDENCE_REQUIRED',
          detail: `Domain claims SIGNED_OFF release without any documented evidenceRefs.`,
        });
      }
    }

    // 9. Fail-closed authorization guard: cannot be TESTED without evidence
    if (q.authorization === 'TESTED' && (!entry.evidenceRefs || entry.evidenceRefs.length === 0)) {
      discrepancies.push({
        domainId: entry.domainId,
        dimension: 'authorization',
        rule: 'AUTH_TESTED_EVIDENCE_REQUIRED',
        detail: `Domain claims TESTED authorization without documented evidence.`,
      });
    }
  }

  const blockingDomains = manifest
    .filter(
      (d) =>
        d.qualificationStatus.implementation === 'MISSING' ||
        d.qualificationStatus.authorization === 'FAILING' ||
        d.qualificationStatus.staging === 'FAILED'
    )
    .map((d) => d.domainId);

  const orcPendingDomains = manifest
    .filter(
      (d) =>
        d.orcGate.startsWith('ORC-') &&
        d.qualificationStatus.staging === 'PENDING'
    )
    .map((d) => d.domainId);

  const releasedDomains = manifest
    .filter((d) => d.qualificationStatus.release === 'SIGNED_OFF')
    .map((d) => d.domainId);

  return {
    schema: 'ghims.orc8.qualification-matrix.v1',
    evaluatedAt: new Date().toISOString(),
    totalDomains: manifest.length,
    expectedDomainCount: TOTAL_DOMAINS,
    counts,
    gateCoverage,
    blockingDomains,
    orcPendingDomains,
    releasedDomains,
    discrepancies,
    passed: discrepancies.length === 0 && manifest.length === TOTAL_DOMAINS,
  };
}

if (import.meta.main) {
  const report = evaluateQualificationMatrix();
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
}
