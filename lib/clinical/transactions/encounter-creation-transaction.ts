/**
 * Encounter Creation Transaction Executor
 * Executes atomic, multi-document Firestore writes for clinical intake, workflow instantiation, outbox, and audit.
 */

import { doc, writeBatch, runTransaction } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { ClinicalPaths } from '../paths';
import { EncounterCreationBundle } from '@/types/clinical-workflow';
import { handleFirestoreError, OperationType } from '@/lib/firebase/errors';
import { sanitizeForFirestore } from '@/lib/firestore/sanitize';

export interface TransactionExecutionResult {
  success: boolean;
  tenantId: string;
  patientId: string;
  mrn: string;
  encounterId: string;
  snapshotId: string;
  stageId: string;
  tokenNumber: string;
  auditLogId: string;
  outboxEventIds: string[];
  executedAt: string;
  error?: string;
}

export class EncounterCreationTransaction {
  /**
   * Executes the EncounterCreationBundle atomically across all tenant collections using Firestore WriteBatch.
   */
  public static async executeBatch(bundle: EncounterCreationBundle): Promise<TransactionExecutionResult> {
    const { patientRecord, encounterPlan, initialSnapshot, initialStage, tokenQueueItem, auditEntry, outboxEvents } =
      bundle;

    const tenantId = patientRecord.tenantId;
    const executedAt = new Date().toISOString();
    const batch = writeBatch(db);

    try {
      // 1. Patient MPI Document (Tenant-scoped & Root mirror for global query)
      const patientRef = doc(db, ClinicalPaths.tenant.patient(tenantId, patientRecord.id));
      batch.set(patientRef, sanitizeForFirestore(patientRecord));

      // Root mirror
      const rootPatientRef = doc(db, ClinicalPaths.root.patient(patientRecord.id));
      batch.set(rootPatientRef, sanitizeForFirestore({
        id: patientRecord.id,
        mrn: patientRecord.mrn,
        fullName: patientRecord.fullName,
        dateOfBirth: patientRecord.dateOfBirth,
        age: patientRecord.age,
        gender: patientRecord.gender,
        bloodGroup: patientRecord.bloodGroup,
        contactNumber: patientRecord.phone,
        email: patientRecord.email || '',
        address: typeof patientRecord.address === 'object' ? `${patientRecord.address.street}, ${patientRecord.address.city}` : patientRecord.address,
        allergies: patientRecord.allergies,
        chronicConditions: patientRecord.chronicConditions,
        activeEncounterId: encounterPlan.id,
        registeredAt: patientRecord.registeredAt,
        updatedAt: patientRecord.updatedAt,
      }));

      // 2. MPI Deterministic Registry Key
      if (patientRecord.matchKeys?.dobNameHash) {
        const mpiRef = doc(db, ClinicalPaths.tenant.mpiRecord(tenantId, patientRecord.matchKeys.dobNameHash));
        batch.set(mpiRef, sanitizeForFirestore({
          mpiKey: patientRecord.matchKeys.dobNameHash,
          patientId: patientRecord.id,
          mrn: patientRecord.mrn,
          fullName: patientRecord.fullName,
          dateOfBirth: patientRecord.dateOfBirth,
          soundexLastName: patientRecord.matchKeys.soundexLastName,
          createdAt: executedAt,
        }));
      }

      // 3. Clinical Encounter Document
      const encounterRef = doc(db, ClinicalPaths.tenant.encounter(tenantId, encounterPlan.id));
      batch.set(encounterRef, sanitizeForFirestore(encounterPlan));

      // 4. Workflow Snapshot
      const snapshotRef = doc(
        db,
        ClinicalPaths.tenant.workflowSnapshot(tenantId, encounterPlan.id, initialSnapshot.id)
      );
      batch.set(snapshotRef, sanitizeForFirestore(initialSnapshot));

      // 5. Workflow Runtime Stage (Registration - Active)
      const stageRef = doc(db, ClinicalPaths.tenant.stage(tenantId, encounterPlan.id, initialStage.id));
      batch.set(stageRef, sanitizeForFirestore(initialStage));

      // 6. OPD Queue Token (Tenant-scoped & Root mirror)
      const opdTokenRef = doc(db, ClinicalPaths.tenant.opdToken(tenantId, tokenQueueItem.id));
      batch.set(opdTokenRef, sanitizeForFirestore(tokenQueueItem));

      const rootOpdTokenRef = doc(db, ClinicalPaths.root.opdToken(tokenQueueItem.id));
      batch.set(rootOpdTokenRef, sanitizeForFirestore({
        id: tokenQueueItem.id,
        tokenNumber: tokenQueueItem.tokenNumber,
        patientId: tokenQueueItem.patientId,
        patientName: tokenQueueItem.patientName,
        mrn: tokenQueueItem.mrn,
        department: tokenQueueItem.department,
        assignedDoctor: tokenQueueItem.assignedDoctor,
        priority: tokenQueueItem.priority,
        status: tokenQueueItem.status,
        arrivalTime: tokenQueueItem.arrivalTime,
        chiefComplaint: tokenQueueItem.chiefComplaint,
        updatedAt: executedAt,
      }));

      // 7. Cryptographic HIPAA Audit Ledger Entry (Tenant & Root mirror)
      const auditLogRef = doc(db, ClinicalPaths.tenant.auditLog(tenantId, auditEntry.id));
      batch.set(auditLogRef, sanitizeForFirestore(auditEntry));

      const rootAuditRef = doc(db, ClinicalPaths.root.auditLog(auditEntry.id));
      batch.set(rootAuditRef, sanitizeForFirestore(auditEntry));

      // 8. Transactional Outbox Events
      const outboxEventIds: string[] = [];
      for (const obx of outboxEvents) {
        const obxRef = doc(db, ClinicalPaths.tenant.outboxEvent(tenantId, obx.id));
        batch.set(obxRef, sanitizeForFirestore(obx));
        outboxEventIds.push(obx.id);
      }

      // Commit the atomic write batch
      await batch.commit();

      return {
        success: true,
        tenantId,
        patientId: patientRecord.id,
        mrn: patientRecord.mrn,
        encounterId: encounterPlan.id,
        snapshotId: initialSnapshot.id,
        stageId: initialStage.id,
        tokenNumber: tokenQueueItem.tokenNumber,
        auditLogId: auditEntry.id,
        outboxEventIds,
        executedAt,
      };
    } catch (error) {
      console.error('[EncounterCreationTransaction] Batch execution error:', error);
      handleFirestoreError(error, OperationType.WRITE, `tenants/${tenantId}/encounters`);
    }
  }
}
