import crypto from 'node:crypto';
import { getAdminFirestore } from '@/server/firebase/admin';
import { sanitizeForFirestore } from '@/lib/firestore/sanitize';
import { Patient360ProjectionService } from '@/lib/clinical/patient360/patient360-projection-service';
import { normalizeCareSetting } from '@/lib/clinical/patient360/care-context';
import type {
  MedicationSafetyCandidate,
  MedicationSafetyCandidateEvaluation,
  MedicationSafetyEvidenceRef,
  MedicationSafetyFinding,
  MedicationSafetyProjection,
  MedicationSafetyState,
} from '@/types/medication-safety';
import type {
  Patient360AllergySummary,
  Patient360MedicationSummary,
  Patient360Projection,
} from '@/types/patient360-projection';

export interface MedicationSafetyTriggerEvent {
  eventId: string;
  tenantId: string;
  eventType: string;
  aggregateType?: string;
  aggregateId?: string;
  payload?: Record<string, unknown>;
  occurredAt?: number;
  recordedAt?: number;
}

function stableId(prefix: string, parts: string[]): string {
  return `${prefix}_${crypto
    .createHash('sha256')
    .update(parts.join('|'))
    .digest('hex')
    .slice(0, 32)}`;
}

function normalized(value: unknown): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function conceptKey(input: {
  code?: string;
  system?: string;
  name?: string;
}): string {
  const code = normalized(input.code);
  const system = normalized(input.system);
  if (code) return `code:${system || 'unknown'}:${code}`;
  return `name:${normalized(input.name)}`;
}

function sameMedication(
  medication: { code?: string; system?: string; name?: string },
  other: { code?: string; system?: string; name?: string }
): boolean {
  const leftCode = normalized(medication.code);
  const rightCode = normalized(other.code);
  if (leftCode && rightCode) {
    const leftSystem = normalized(medication.system);
    const rightSystem = normalized(other.system);
    return (
      leftCode === rightCode &&
      (!leftSystem || !rightSystem || leftSystem === rightSystem)
    );
  }

  const leftName = normalized(medication.name);
  const rightName = normalized(other.name);
  return Boolean(leftName && rightName && leftName === rightName);
}

function careContext(projection: Patient360Projection) {
  const encounter =
    projection.careContexts.activeIpdEncounter ||
    projection.careContexts.activeEmergencyEncounter ||
    projection.careContexts.activeOpdEncounters[0] ||
    projection.activeEncounter ||
    projection.careContexts.latestIpdEncounter ||
    projection.careContexts.latestOpdEncounter;

  return {
    encounter,
    encounterId: encounter?.encounterId,
    careSetting: normalizeCareSetting(encounter?.careSetting),
  };
}

function allergyEvidence(
  allergy: Patient360AllergySummary
): MedicationSafetyEvidenceRef {
  return {
    source: 'PATIENT360_ALLERGY',
    entityId: allergy.allergyId,
    label: allergy.substance,
    code: allergy.code,
    system: allergy.system,
  };
}

function medicationEvidence(
  medication: Patient360MedicationSummary
): MedicationSafetyEvidenceRef {
  return {
    source: 'PATIENT360_MEDICATION',
    entityId: medication.medicationOrderId,
    label: medication.medication,
    code: medication.code,
    system: medication.system,
    occurredAt: medication.authoredAt,
  };
}

function stateFor(findings: MedicationSafetyFinding[]): MedicationSafetyState {
  if (
    findings.some(
      (finding) => finding.severity === 'CRITICAL_REVIEW_REQUIRED'
    )
  ) {
    return 'CRITICAL_REVIEW_REQUIRED';
  }
  if (
    findings.some(
      (finding) =>
        finding.severity === 'ACTION_REQUIRED' ||
        finding.severity === 'REVIEW_REQUIRED'
    )
  ) {
    return 'REVIEW_REQUIRED';
  }
  return 'CLEAR_FOR_CURRENT_EVIDENCE';
}

function finding(params: Omit<MedicationSafetyFinding, 'findingId'>): MedicationSafetyFinding {
  return {
    ...params,
    findingId: stableId('medsafe', [
      params.patientId,
      params.encounterId || 'no-encounter',
      params.type,
      ...params.medicationOrderIds,
      ...params.allergyIds,
      params.ruleId,
    ]),
  };
}

export class MedicationSafetyService {
  public static evaluateProjection(
    projection: Patient360Projection,
    evaluatedAt = Date.now()
  ): MedicationSafetyProjection {
    const { encounter, encounterId, careSetting } = careContext(projection);
    const findings: MedicationSafetyFinding[] = [];

    if (
      projection.dataQuality.allergyKnowledge === 'UNKNOWN' ||
      projection.dataQuality.allergyKnowledge === 'NOT_ASSESSED' ||
      projection.dataQuality.allergyKnowledge === 'PATIENT_UNABLE_TO_REPORT'
    ) {
      findings.push(
        finding({
          tenantId: projection.tenantId,
          patientId: projection.patientId,
          encounterId,
          careSetting,
          type: 'ALLERGY_STATUS_INCOMPLETE',
          severity: 'ACTION_REQUIRED',
          title: 'Medication allergy status is incomplete',
          description:
            'Medication safety cannot be fully assessed until allergy status is documented or explicitly marked known-none.',
          medicationOrderIds: [],
          allergyIds: [],
          evidence: [
            {
              source: 'PATIENT360_KNOWLEDGE_STATUS',
              entityId: 'ALLERGIES',
              label: projection.dataQuality.allergyKnowledge,
            },
          ],
          ruleId: 'CI9-ALLERGY-KNOWLEDGE-1',
          ruleVersion: 1,
          requiresAcknowledgement: true,
          requiresOverride: false,
          detectedAt: evaluatedAt,
        })
      );
    }

    if (
      projection.dataQuality.medicationKnowledge === 'UNKNOWN' ||
      projection.dataQuality.medicationKnowledge === 'NOT_ASSESSED' ||
      projection.dataQuality.medicationKnowledge === 'PATIENT_UNABLE_TO_REPORT'
    ) {
      findings.push(
        finding({
          tenantId: projection.tenantId,
          patientId: projection.patientId,
          encounterId,
          careSetting,
          type: 'MEDICATION_HISTORY_INCOMPLETE',
          severity: 'ACTION_REQUIRED',
          title: 'Medication history is incomplete',
          description:
            'Current therapy cannot be considered fully reconciled because the medication history is not known.',
          medicationOrderIds: [],
          allergyIds: [],
          evidence: [
            {
              source: 'PATIENT360_KNOWLEDGE_STATUS',
              entityId: 'MEDICATIONS',
              label: projection.dataQuality.medicationKnowledge,
            },
          ],
          ruleId: 'CI9-MEDICATION-KNOWLEDGE-1',
          ruleVersion: 1,
          requiresAcknowledgement: true,
          requiresOverride: false,
          detectedAt: evaluatedAt,
        })
      );
    }

    const encounterStartedAt = Number(encounter?.startedAt || 0);
    const reconciledAt = Number(
      projection.dataQuality.lastMedicationReconciliationAt || 0
    );
    if (encounterId && (!reconciledAt || (encounterStartedAt && reconciledAt < encounterStartedAt))) {
      findings.push(
        finding({
          tenantId: projection.tenantId,
          patientId: projection.patientId,
          encounterId,
          careSetting,
          type: 'MEDICATION_RECONCILIATION_REQUIRED',
          severity: 'ACTION_REQUIRED',
          title: 'Medication reconciliation required for this care context',
          description:
            'No medication reconciliation checkpoint exists after the current encounter began.',
          medicationOrderIds: projection.currentMedications.map(
            (item) => item.medicationOrderId
          ),
          allergyIds: [],
          evidence: [
            {
              source: 'PATIENT360_CARE_CONTEXT',
              entityId: encounterId,
              label: `${careSetting} encounter`,
              occurredAt: encounterStartedAt || undefined,
            },
            {
              source: 'PATIENT360_KNOWLEDGE_STATUS',
              entityId: 'MEDICATION_RECONCILIATION',
              label: reconciledAt
                ? `Last reconciled at ${reconciledAt}`
                : 'No reconciliation recorded',
              occurredAt: reconciledAt || undefined,
            },
          ],
          ruleId: 'CI9-RECONCILIATION-1',
          ruleVersion: 1,
          requiresAcknowledgement: true,
          requiresOverride: false,
          detectedAt: evaluatedAt,
        })
      );
    }

    const medicationAllergies = projection.allergies.filter(
      (allergy) => allergy.category === 'MEDICATION'
    );
    for (const medication of projection.currentMedications) {
      for (const allergy of medicationAllergies) {
        if (
          sameMedication(
            {
              code: medication.code,
              system: medication.system,
              name: medication.medication,
            },
            {
              code: allergy.code,
              system: allergy.system,
              name: allergy.substance,
            }
          )
        ) {
          findings.push(
            finding({
              tenantId: projection.tenantId,
              patientId: projection.patientId,
              encounterId,
              careSetting,
              type: 'MEDICATION_ALLERGY_CONFLICT',
              severity: 'CRITICAL_REVIEW_REQUIRED',
              title: 'Active medication matches a documented medication allergy',
              description: `${medication.medication} matches documented allergy ${allergy.substance}. Exact coded/name evidence requires immediate clinician review.`,
              medicationOrderIds: [medication.medicationOrderId],
              allergyIds: [allergy.allergyId],
              evidence: [
                medicationEvidence(medication),
                allergyEvidence(allergy),
              ],
              ruleId: 'CI9-EXACT-ALLERGY-CONFLICT-1',
              ruleVersion: 1,
              requiresAcknowledgement: true,
              requiresOverride: true,
              detectedAt: evaluatedAt,
            })
          );
        }
      }
    }

    const groups = new Map<string, Patient360MedicationSummary[]>();
    for (const medication of projection.currentMedications) {
      const key = conceptKey({
        code: medication.code,
        system: medication.system,
        name: medication.medication,
      });
      const list = groups.get(key) || [];
      list.push(medication);
      groups.set(key, list);
    }
    for (const duplicates of groups.values()) {
      if (duplicates.length < 2) continue;
      findings.push(
        finding({
          tenantId: projection.tenantId,
          patientId: projection.patientId,
          encounterId,
          careSetting,
          type: 'DUPLICATE_ACTIVE_MEDICATION',
          severity: 'ACTION_REQUIRED',
          title: 'Duplicate active medication orders detected',
          description: `${duplicates.length} active/on-hold orders resolve to the same exact medication identity: ${duplicates[0].medication}.`,
          medicationOrderIds: duplicates.map(
            (item) => item.medicationOrderId
          ),
          allergyIds: [],
          evidence: duplicates.map(medicationEvidence),
          ruleId: 'CI9-DUPLICATE-EXACT-MEDICATION-1',
          ruleVersion: 1,
          requiresAcknowledgement: true,
          requiresOverride: false,
          detectedAt: evaluatedAt,
        })
      );
    }

    const projectionState =
      projection.dataQuality.allergyKnowledge === 'UNKNOWN' &&
      projection.dataQuality.medicationKnowledge === 'UNKNOWN' &&
      findings.length === 0
        ? 'DATA_INSUFFICIENT'
        : stateFor(findings);

    return {
      projectionId: `medsafe_${projection.patientId}`,
      tenantId: projection.tenantId,
      patientId: projection.patientId,
      encounterId,
      careSetting,
      state: projectionState,
      patient360Revision: projection.revision,
      patient360SourceCheckpoint: projection.sourceCheckpoint,
      patient360ContentHash: projection.contentHash,
      evaluatedAt,
      findings: findings.sort(
        (left, right) =>
          (
            {
              CRITICAL_REVIEW_REQUIRED: 0,
              ACTION_REQUIRED: 1,
              REVIEW_REQUIRED: 2,
              INFORMATION: 3,
            } as Record<string, number>
          )[left.severity] -
            (
              {
                CRITICAL_REVIEW_REQUIRED: 0,
                ACTION_REQUIRED: 1,
                REVIEW_REQUIRED: 2,
                INFORMATION: 3,
              } as Record<string, number>
            )[right.severity] ||
          left.findingId.localeCompare(right.findingId)
      ),
      counts: {
        total: findings.length,
        critical: findings.filter(
          (item) => item.severity === 'CRITICAL_REVIEW_REQUIRED'
        ).length,
        actionRequired: findings.filter(
          (item) => item.severity === 'ACTION_REQUIRED'
        ).length,
        reviewRequired: findings.filter(
          (item) => item.severity === 'REVIEW_REQUIRED'
        ).length,
      },
      limitations: [
        'CI-9 exact-match rules do not infer drug classes, cross-reactivity, drug-drug interactions, renal dose adjustments, pregnancy risk, or pharmacogenomic risk without a validated medication knowledge source.',
        'Absence of a CI-9 finding is not proof that a medication is clinically safe.',
      ],
    };
  }

  public static evaluateCandidate(
    projection: Patient360Projection,
    encounterId: string,
    candidate: MedicationSafetyCandidate,
    evaluatedAt = Date.now()
  ): MedicationSafetyCandidateEvaluation {
    const context = careContext(projection);
    const careSetting = normalizeCareSetting(
      projection.recentEncounters.find(
        (item) => item.encounterId === encounterId
      )?.careSetting || context.careSetting
    );
    const findings: MedicationSafetyFinding[] = [];

    for (const allergy of projection.allergies.filter(
      (item) => item.category === 'MEDICATION'
    )) {
      if (
        sameMedication(
          {
            code: candidate.drugCode,
            system: candidate.system,
            name: candidate.drugName,
          },
          {
            code: allergy.code,
            system: allergy.system,
            name: allergy.substance,
          }
        )
      ) {
        findings.push(
          finding({
            tenantId: projection.tenantId,
            patientId: projection.patientId,
            encounterId,
            careSetting,
            type: 'MEDICATION_ALLERGY_CONFLICT',
            severity: 'CRITICAL_REVIEW_REQUIRED',
            title: 'Proposed medication matches a documented medication allergy',
            description: `${candidate.drugName} exactly matches documented medication-allergy evidence ${allergy.substance}.`,
            medicationOrderIds: [],
            allergyIds: [allergy.allergyId],
            evidence: [
              {
                source: 'PRESCRIPTION_CANDIDATE',
                entityId: candidate.drugCode || candidate.drugName,
                label: candidate.drugName,
                code: candidate.drugCode,
                system: candidate.system,
              },
              allergyEvidence(allergy),
            ],
            ruleId: 'CI9-PRESCRIBE-EXACT-ALLERGY-1',
            ruleVersion: 1,
            requiresAcknowledgement: true,
            requiresOverride: true,
            detectedAt: evaluatedAt,
          })
        );
      }
    }

    for (const medication of projection.currentMedications) {
      if (
        sameMedication(
          {
            code: candidate.drugCode,
            system: candidate.system,
            name: candidate.drugName,
          },
          {
            code: medication.code,
            system: medication.system,
            name: medication.medication,
          }
        )
      ) {
        findings.push(
          finding({
            tenantId: projection.tenantId,
            patientId: projection.patientId,
            encounterId,
            careSetting,
            type: 'DUPLICATE_ACTIVE_MEDICATION',
            severity: 'ACTION_REQUIRED',
            title: 'Proposed medication duplicates an active medication',
            description: `${candidate.drugName} matches active medication order ${medication.medicationOrderId}.`,
            medicationOrderIds: [medication.medicationOrderId],
            allergyIds: [],
            evidence: [
              {
                source: 'PRESCRIPTION_CANDIDATE',
                entityId: candidate.drugCode || candidate.drugName,
                label: candidate.drugName,
                code: candidate.drugCode,
                system: candidate.system,
              },
              medicationEvidence(medication),
            ],
            ruleId: 'CI9-PRESCRIBE-DUPLICATE-1',
            ruleVersion: 1,
            requiresAcknowledgement: true,
            requiresOverride: false,
            detectedAt: evaluatedAt,
          })
        );
      }
    }

    return {
      patientId: projection.patientId,
      encounterId,
      candidate,
      findings,
      blockingFindingIds: findings
        .filter((item) => item.requiresOverride)
        .map((item) => item.findingId),
      acknowledgementFindingIds: findings
        .filter((item) => item.requiresAcknowledgement)
        .map((item) => item.findingId),
      evaluatedAt,
    };
  }

  public static async getProjection(
    tenantId: string,
    patientId: string
  ): Promise<MedicationSafetyProjection | null> {
    const db = getAdminFirestore();
    if (!db) throw new Error('MEDICATION_SAFETY_STORE_UNAVAILABLE');
    const snapshot = await db
      .collection('tenants')
      .doc(tenantId)
      .collection('medicationSafetyProjections')
      .doc(patientId)
      .get();
    return snapshot.exists
      ? (snapshot.data() as MedicationSafetyProjection)
      : null;
  }

  public static async rebuildPatient(
    tenantId: string,
    patientId: string,
    trigger?: { eventId?: string }
  ): Promise<MedicationSafetyProjection | null> {
    const db = getAdminFirestore();
    if (!db) throw new Error('MEDICATION_SAFETY_STORE_UNAVAILABLE');
    const projection = await Patient360ProjectionService.getProjection(
      tenantId,
      patientId
    );
    if (!projection) return null;

    const medicationSafety = this.evaluateProjection(projection);
    const tenantRef = db.collection('tenants').doc(tenantId);
    await tenantRef
      .collection('medicationSafetyProjections')
      .doc(patientId)
      .set(sanitizeForFirestore(medicationSafety));

    if (trigger?.eventId) {
      await tenantRef
        .collection('medicationSafetyCheckpoints')
        .doc(trigger.eventId)
        .set(
          sanitizeForFirestore({
            eventId: trigger.eventId,
            tenantId,
            patientId,
            patient360Revision: projection.revision,
            processedAt: Date.now(),
          })
        );
    }
    return medicationSafety;
  }

  public static async refreshFromEvent(
    event: MedicationSafetyTriggerEvent
  ): Promise<MedicationSafetyProjection[]> {
    const db = getAdminFirestore();
    if (!db) throw new Error('MEDICATION_SAFETY_STORE_UNAVAILABLE');
    const tenantRef = db.collection('tenants').doc(event.tenantId);
    const checkpoint = await tenantRef
      .collection('medicationSafetyCheckpoints')
      .doc(event.eventId)
      .get();
    if (checkpoint.exists) return [];

    const patientId = String(
      event.payload?.patientId ||
        (String(event.aggregateType || '')
          .toUpperCase()
          .includes('PATIENT')
          ? event.aggregateId
          : '') ||
        ''
    ).trim();
    if (!patientId) {
      await tenantRef
        .collection('medicationSafetyCheckpoints')
        .doc(event.eventId)
        .set(
          sanitizeForFirestore({
            eventId: event.eventId,
            tenantId: event.tenantId,
            ignored: true,
            processedAt: Date.now(),
          })
        );
      return [];
    }

    const projection = await this.rebuildPatient(event.tenantId, patientId, {
      eventId: event.eventId,
    });
    return projection ? [projection] : [];
  }

  public static async rebuildTenantFromEvents(
    tenantId: string,
    events: MedicationSafetyTriggerEvent[]
  ): Promise<number> {
    const patientIds = Array.from(
      new Set(
        events
          .map((event) => String(event.payload?.patientId || '').trim())
          .filter(Boolean)
      )
    );
    let rebuilt = 0;
    for (const patientId of patientIds) {
      const projection = await this.rebuildPatient(tenantId, patientId);
      if (projection) rebuilt += 1;
    }
    return rebuilt;
  }
}
