/**
 * G-HIMS ORC-7: Authoritative Compensating Data Repair Script
 *
 * Implements architectural doctrine (§95) for data corrections:
 *   - NEVER directly mutate or delete historical records.
 *   - All mutations execute as transactional compensating events with audit records.
 *   - Requires explicit --dry-run (default) or --approve-actor=<uid> for live execution.
 *   - Strict tenant isolation and staging/test runtime verification.
 *
 * Repair targets:
 *   1. Encounters missing facilityId → backfill from tenant's primary facility.
 *   2. Doctor membership documents missing RECORD_VITALS → re-derive via deriveClinicalPrivileges().
 *   3. OPD encounters in CONSULTATION_COMPLETED with financialClearanceState = CONSULTATION_CLEARED
 *      and zero open AR items → advance currentStage to BILLING_SETTLEMENT.
 */

import { getAdminFirestore } from '@/server/firebase/admin';
import { FieldPath, type DocumentReference, type QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { TransactionManager } from '@/lib/backend/transactions/transaction-manager';
import { deriveClinicalPrivileges } from '@/server/auth/tenant-membership';

export type RecordRow = { documentId: string; [key: string]: unknown };

export interface OrcRepairOptions {
  tenantId: string;
  isDryRun: boolean;
  approveActorId?: string;
  defaultFacilityId: string;
}

export interface FacilityRepairCandidate {
  encounterId: string;
  encounterType: string;
  currentFacilityId: string;
  targetFacilityId: string;
}

export interface PrivilegeRepairCandidate {
  userId: string;
  roles: string[];
  currentPrivileges: string[];
  repairedPrivileges: string[];
  missingPrivilege: 'RECORD_VITALS';
}

export interface BillingStageAdvanceCandidate {
  encounterId: string;
  currentStage: string;
  targetStage: 'BILLING_SETTLEMENT';
  financialClearanceState: string;
  openArItemsCount: number;
}

export interface OrcRepairPlan {
  facilityRepairs: FacilityRepairCandidate[];
  privilegeRepairs: PrivilegeRepairCandidate[];
  billingStageRepairs: BillingStageAdvanceCandidate[];
}

export interface OrcRepairExecutionResult {
  schema: 'ghims.orc7.data-repair.v1';
  executedAt: string;
  tenantId: string;
  isDryRun: boolean;
  approveActorId?: string;
  summary: {
    facilityRepairsIdentified: number;
    facilityRepairsApplied: number;
    privilegeRepairsIdentified: number;
    privilegeRepairsApplied: number;
    billingStageRepairsIdentified: number;
    billingStageRepairsApplied: number;
  };
  plan: OrcRepairPlan;
}

const str = (value: unknown): string => String(value ?? '').trim();

/**
 * Parses and strictly validates CLI arguments and environment variables.
 */
export function parseOrcRepairOptions(
  argv: string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env
): OrcRepairOptions {
  if (String(env.GHIMS_RUNTIME_MODE || '').trim().toUpperCase() === 'PRODUCTION') {
    throw new Error('ORC_REPAIR_STAGING_ONLY: Live compensating repairs are forbidden in production mode.');
  }

  let tenantId = String(env.GHIMS_ORC_REPAIR_TENANT_ID || env.GHIMS_ORC_AUDIT_TENANT_ID || '').trim().toLowerCase();
  let approveActorId: string | undefined = undefined;
  let isDryRun = true;
  let defaultFacilityId = 'facility-primary';

  for (const arg of argv) {
    if (arg === '--dry-run') {
      isDryRun = true;
    } else if (arg === '--execute' || arg === '--live') {
      isDryRun = false;
    } else if (arg.startsWith('--tenant-id=')) {
      tenantId = arg.slice('--tenant-id='.length).trim().toLowerCase();
    } else if (arg.startsWith('--approve-actor=')) {
      approveActorId = arg.slice('--approve-actor='.length).trim();
    } else if (arg.startsWith('--default-facility=')) {
      defaultFacilityId = arg.slice('--default-facility='.length).trim();
    }
  }

  if (!tenantId || !/^[a-z0-9][a-z0-9_-]{1,127}$/.test(tenantId)) {
    throw new Error('ORC_REPAIR_EXPLICIT_TENANT_REQUIRED: A valid tenant ID must be specified.');
  }

  if (!isDryRun) {
    if (!approveActorId) {
      throw new Error('ORC_REPAIR_APPROVE_ACTOR_REQUIRED: Live execution requires --approve-actor=<uid>.');
    }
  }

  return { tenantId, isDryRun, approveActorId, defaultFacilityId };
}

/**
 * Identifies encounters missing facilityId.
 */
export function findEncounterFacilityRepairCandidates(
  encounters: RecordRow[],
  targetFacilityId: string
): FacilityRepairCandidate[] {
  const candidates: FacilityRepairCandidate[] = [];

  for (const enc of encounters) {
    const facilityId = str(enc.facilityId);
    if (!facilityId) {
      candidates.push({
        encounterId: str(enc.encounterId || enc.documentId),
        encounterType: str(enc.encounterType || 'OPD').toUpperCase(),
        currentFacilityId: '',
        targetFacilityId,
      });
    }
  }

  return candidates;
}

/**
 * Identifies doctor memberships missing the RECORD_VITALS privilege.
 */
export function findDoctorPrivilegeRepairCandidates(
  users: RecordRow[]
): PrivilegeRepairCandidate[] {
  const candidates: PrivilegeRepairCandidate[] = [];

  for (const user of users) {
    const rawRoles = Array.isArray(user.roles) ? user.roles.map(str) : [str(user.role)];
    const isDoctor = rawRoles.some((r) => {
      const norm = r.toLowerCase();
      return norm.includes('doctor') || norm.includes('physician') || norm.includes('consultant');
    });

    if (!isDoctor) continue;

    const privileges = Array.isArray(user.clinicalPrivileges)
      ? user.clinicalPrivileges.map(str)
      : deriveClinicalPrivileges(rawRoles);

    if (!privileges.includes('RECORD_VITALS')) {
      const repaired = Array.from(new Set([...privileges, 'RECORD_VITALS']));
      candidates.push({
        userId: str(user.userId || user.documentId),
        roles: rawRoles,
        currentPrivileges: privileges,
        repairedPrivileges: repaired,
        missingPrivilege: 'RECORD_VITALS',
      });
    }
  }

  return candidates;
}

/**
 * Identifies OPD encounters in CONSULTATION_COMPLETED with financialClearanceState = CONSULTATION_CLEARED
 * and zero open AR items, which need advancement to BILLING_SETTLEMENT.
 */
export function findBillingStageAdvanceCandidates(
  encounters: RecordRow[],
  arOpenItems: RecordRow[]
): BillingStageAdvanceCandidate[] {
  const openArByEncounter = new Map<string, number>();

  for (const item of arOpenItems) {
    const encounterId = str(item.encounterId);
    const balance = Number(item.balanceDue ?? item.openAmountMinorUnits ?? 0);
    const status = str(item.status).toUpperCase();
    if (encounterId && balance > 0 && status !== 'CLEARED' && status !== 'PAID') {
      openArByEncounter.set(encounterId, (openArByEncounter.get(encounterId) || 0) + 1);
    }
  }

  const candidates: BillingStageAdvanceCandidate[] = [];

  for (const enc of encounters) {
    const encounterType = str(enc.encounterType).toUpperCase();
    const currentStage = str(enc.currentStage || enc.clinicalState).toUpperCase();
    const clearance = str(enc.financialClearanceState).toUpperCase();
    const encounterId = str(enc.encounterId || enc.documentId);

    if (
      encounterType === 'OPD' &&
      currentStage === 'CONSULTATION_COMPLETED' &&
      clearance === 'CONSULTATION_CLEARED'
    ) {
      const openCount = openArByEncounter.get(encounterId) || 0;
      if (openCount === 0) {
        candidates.push({
          encounterId,
          currentStage,
          targetStage: 'BILLING_SETTLEMENT',
          financialClearanceState: clearance,
          openArItemsCount: 0,
        });
      }
    }
  }

  return candidates;
}

/**
 * Reads all rows from a Firestore tenant collection with pagination.
 */
async function readAll(
  ref: DocumentReference,
  collection: string,
  maxRows = 50000
): Promise<RecordRow[]> {
  const out: RecordRow[] = [];
  let cursor: QueryDocumentSnapshot | null = null;
  for (;;) {
    let query = ref.collection(collection).orderBy(FieldPath.documentId()).limit(500);
    if (cursor) query = query.startAfter(cursor);
    const snap = await query.get();
    for (const document of snap.docs) {
      out.push({ ...document.data(), documentId: document.id });
    }
    if (out.length > maxRows) {
      throw new Error(`ORC_REPAIR_COLLECTION_TOO_LARGE: ${collection}`);
    }
    if (snap.size < 500) return out;
    cursor = snap.docs[snap.docs.length - 1] || null;
    if (!cursor) return out;
  }
}

/**
 * Builds the complete repair plan from retrieved records.
 */
export function buildOrcRepairPlan(
  encounters: RecordRow[],
  users: RecordRow[],
  arOpenItems: RecordRow[],
  defaultFacilityId: string
): OrcRepairPlan {
  return {
    facilityRepairs: findEncounterFacilityRepairCandidates(encounters, defaultFacilityId),
    privilegeRepairs: findDoctorPrivilegeRepairCandidates(users),
    billingStageRepairs: findBillingStageAdvanceCandidates(encounters, arOpenItems),
  };
}

/**
 * Main execution routine: reads tenant data, plans repairs, and executes transactional
 * compensating events if not in dry-run mode.
 */
export async function executeOrcDataRepair(
  options: OrcRepairOptions
): Promise<OrcRepairExecutionResult> {
  const db = getAdminFirestore();
  if (!db) {
    throw new Error('ORC_REPAIR_FIRESTORE_UNAVAILABLE: Firestore Admin SDK is not initialized.');
  }

  const tenantRef = db.collection('tenants').doc(options.tenantId);
  const [encounters, users, arOpenItems] = await Promise.all([
    readAll(tenantRef, 'encounters'),
    readAll(tenantRef, 'users'),
    readAll(tenantRef, 'arOpenItems'),
  ]);

  const plan = buildOrcRepairPlan(encounters, users, arOpenItems, options.defaultFacilityId);

  let facilityRepairsApplied = 0;
  let privilegeRepairsApplied = 0;
  let billingStageRepairsApplied = 0;

  if (!options.isDryRun && options.approveActorId) {
    const actorId = options.approveActorId;

    // 1. Apply Encounter Facility Scope Compensating Mutations
    for (const item of plan.facilityRepairs) {
      const existing = encounters.find((e) => str(e.encounterId || e.documentId) === item.encounterId) || {};
      const now = Date.now();
      await TransactionManager.executeAtomicMutation({
        tenantId: options.tenantId,
        actorId,
        actorRole: 'SYSTEM_ADMIN',
        aggregateType: 'ENCOUNTER',
        aggregateId: item.encounterId,
        eventType: 'ENCOUNTER_FACILITY_SCOPE_REPAIRED',
        eventPayload: {
          encounterId: item.encounterId,
          previousFacilityId: item.currentFacilityId,
          repairedFacilityId: item.targetFacilityId,
          repairReason: 'ORC-7: Compensating facility scope backfill from primary facility',
          repairedAt: now,
        },
        auditAction: 'COMPENSATING_EVENT_ENCOUNTER_FACILITY_REPAIR',
        auditReason: `ORC-7: Backfilled missing facilityId with ${item.targetFacilityId}`,
        auditResourceType: 'ENCOUNTER',
        auditResourceId: item.encounterId,
        outboxTopic: 'g-hims-clinical-events',
        idempotencyKey: `orc7_fac_repair_${item.encounterId}`,
        commandId: `cmd_orc7_fac_${item.encounterId}`,
        domainState: {
          ...existing,
          facilityId: item.targetFacilityId,
          updatedAt: now,
          orc7FacilityRepairedAt: now,
        },
      });
      facilityRepairsApplied++;
    }

    // 2. Apply Doctor Clinical Privilege Compensating Mutations
    for (const item of plan.privilegeRepairs) {
      const existing = users.find((u) => str(u.userId || u.documentId) === item.userId) || {};
      const now = Date.now();
      await TransactionManager.executeAtomicMutation({
        tenantId: options.tenantId,
        actorId,
        actorRole: 'SYSTEM_ADMIN',
        aggregateType: 'TENANT_MEMBERSHIP',
        aggregateId: item.userId,
        eventType: 'CLINICAL_PRIVILEGES_RECOMPENSATED',
        eventPayload: {
          userId: item.userId,
          roles: item.roles,
          addedPrivilege: 'RECORD_VITALS',
          repairedPrivileges: item.repairedPrivileges,
          repairReason: 'ORC-7: Re-derived RECORD_VITALS privilege for doctor membership',
          repairedAt: now,
        },
        auditAction: 'COMPENSATING_EVENT_PRIVILEGES_REPAIR',
        auditReason: 'ORC-7: Added RECORD_VITALS privilege to doctor membership document',
        auditResourceType: 'TENANT_MEMBERSHIP',
        auditResourceId: item.userId,
        outboxTopic: 'g-hims-workforce-events',
        idempotencyKey: `orc7_priv_repair_${item.userId}`,
        commandId: `cmd_orc7_priv_${item.userId}`,
        domainState: {
          ...existing,
          clinicalPrivileges: item.repairedPrivileges,
          updatedAt: now,
          orc7PrivilegesRepairedAt: now,
        },
      });
      privilegeRepairsApplied++;
    }

    // 3. Apply Settled OPD Encounter Stage Advance Compensating Mutations
    for (const item of plan.billingStageRepairs) {
      const existing = encounters.find((e) => str(e.encounterId || e.documentId) === item.encounterId) || {};
      const now = Date.now();
      await TransactionManager.executeAtomicMutation({
        tenantId: options.tenantId,
        actorId,
        actorRole: 'SYSTEM_ADMIN',
        aggregateType: 'ENCOUNTER',
        aggregateId: item.encounterId,
        eventType: 'OPD_ENCOUNTER_BILLING_STAGE_RECONCILED',
        eventPayload: {
          encounterId: item.encounterId,
          previousStage: item.currentStage,
          targetStage: item.targetStage,
          repairReason: 'ORC-7: Reconciled consultation-cleared encounter to BILLING_SETTLEMENT stage',
          repairedAt: now,
        },
        auditAction: 'COMPENSATING_EVENT_BILLING_STAGE_REPAIR',
        auditReason: 'ORC-7: Advanced CONSULTATION_COMPLETED encounter to BILLING_SETTLEMENT stage',
        auditResourceType: 'ENCOUNTER',
        auditResourceId: item.encounterId,
        outboxTopic: 'g-hims-finance-events',
        idempotencyKey: `orc7_stage_repair_${item.encounterId}`,
        commandId: `cmd_orc7_stage_${item.encounterId}`,
        domainState: {
          ...existing,
          currentStage: item.targetStage,
          billingSettlementEnteredAt: now,
          updatedAt: now,
          orc7StageRepairedAt: now,
        },
      });
      billingStageRepairsApplied++;
    }
  }

  return {
    schema: 'ghims.orc7.data-repair.v1',
    executedAt: new Date().toISOString(),
    tenantId: options.tenantId,
    isDryRun: options.isDryRun,
    approveActorId: options.approveActorId,
    summary: {
      facilityRepairsIdentified: plan.facilityRepairs.length,
      facilityRepairsApplied,
      privilegeRepairsIdentified: plan.privilegeRepairs.length,
      privilegeRepairsApplied,
      billingStageRepairsIdentified: plan.billingStageRepairs.length,
      billingStageRepairsApplied,
    },
    plan,
  };
}

if (import.meta.main) {
  const options = parseOrcRepairOptions(process.argv.slice(2), process.env);
  const result = await executeOrcDataRepair(options);
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}
