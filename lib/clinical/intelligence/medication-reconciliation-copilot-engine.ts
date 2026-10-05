import crypto from 'node:crypto';
import { ClinicalEvidenceService } from '@/lib/clinical/intelligence/clinical-evidence-service';
import type {
  ClinicalEvidenceRef,
  ClinicalEvidenceSnapshot,
  CopilotClaim,
} from '@/types/clinical-intelligence-evidence';
import type { ConsultantChangeSeverity } from '@/types/consultant-visibility';
import type {
  MedicationReconciliationFinding,
  MedicationReconciliationFindingType,
} from '@/types/medication-reconciliation-copilot';

type MedicationIdentity = {
  key: string;
  name: string;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown): string {
  return String(value ?? '').trim();
}

function normalized(value: unknown): string {
  return text(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}

function conceptIdentity(
  concept: unknown,
  fallbackName: string
): MedicationIdentity {
  const data = record(concept);
  const codings = Array.isArray(data.codings)
    ? data.codings.map(record)
    : [];
  const first =
    codings.find(
      (item) => text(item.system) && text(item.code)
    ) || codings[0];

  const system = normalized(first?.system);
  const code = normalized(first?.code);
  const name =
    text(data.text) ||
    text(first?.display) ||
    fallbackName ||
    'Medication';

  if (code) {
    return {
      key: `code:${system || 'unknown'}:${code}`,
      name,
    };
  }

  return {
    key: `name:${normalized(name)}`,
    name,
  };
}

function medicationIdentity(
  evidence: ClinicalEvidenceRef
): MedicationIdentity {
  const data = record(evidence.content);
  return conceptIdentity(data.medication, evidence.label);
}

function encounterId(evidence: ClinicalEvidenceRef): string {
  return text(record(evidence.content).encounterId);
}

function orderStatus(evidence: ClinicalEvidenceRef): string {
  return text(record(evidence.content).status || evidence.status).toUpperCase();
}

function dosageSignature(evidence: ClinicalEvidenceRef): string {
  const data = record(evidence.content);
  return [
    normalized(data.dosageText),
    normalized(data.frequency),
    normalized(record(data.route).text),
  ].join('|');
}

function orderedQuantity(evidence: ClinicalEvidenceRef): number | undefined {
  return numberValue(record(record(evidence.content).quantity).value);
}

function dispensedQuantity(evidence: ClinicalEvidenceRef): number | undefined {
  return numberValue(record(record(evidence.content).quantity).value);
}

function stableId(prefix: string, parts: string[]): string {
  return `${prefix}_${crypto
    .createHash('sha256')
    .update(parts.join('|'))
    .digest('hex')
    .slice(0, 32)}`;
}

function finding(
  snapshot: ClinicalEvidenceSnapshot,
  type: MedicationReconciliationFindingType,
  severity: ConsultantChangeSeverity,
  title: string,
  description: string,
  evidence: ClinicalEvidenceRef[],
  options: {
    medication?: MedicationIdentity;
    caveat?: string;
    classification?: CopilotClaim['classification'];
  } = {}
): MedicationReconciliationFinding {
  const evidenceRefs = Array.from(
    new Set(evidence.map((item) => item.evidenceId))
  ).sort();

  return {
    findingId: stableId('medrec', [
      snapshot.snapshotId,
      type,
      options.medication?.key || 'general',
      ...evidenceRefs,
    ]),
    type,
    severity,
    title,
    description,
    classification:
      options.classification || 'POSSIBLE_DISCREPANCY',
    medicationKey: options.medication?.key,
    medicationName: options.medication?.name,
    evidenceRefs,
    caveat: options.caveat,
    requiresClinicianReview: true,
  };
}

function evidenceOfType(
  snapshot: ClinicalEvidenceSnapshot,
  ...types: ClinicalEvidenceRef['sourceType'][]
): ClinicalEvidenceRef[] {
  const wanted = new Set(types);
  return snapshot.evidenceRefs.filter((item) =>
    wanted.has(item.sourceType)
  );
}

function contextEvidence(
  snapshot: ClinicalEvidenceSnapshot,
  encounterIdValue: string
): ClinicalEvidenceRef {
  const item = snapshot.evidenceRefs.find(
    (evidence) =>
      evidence.sourceType === 'ENCOUNTER_CONTEXT' &&
      evidence.sourceEntityId === encounterIdValue
  );
  if (!item) throw new Error('CI10E_ENCOUNTER_CONTEXT_REQUIRED');
  return item;
}

function knowledgeEvidence(
  snapshot: ClinicalEvidenceSnapshot
): ClinicalEvidenceRef | undefined {
  return snapshot.evidenceRefs.find(
    (item) => item.sourceType === 'KNOWLEDGE_STATUS'
  );
}

function sameMedication(
  left: ClinicalEvidenceRef,
  right: ClinicalEvidenceRef
): boolean {
  return medicationIdentity(left).key === medicationIdentity(right).key;
}

function ci9Type(item: ClinicalEvidenceRef): string {
  return text(record(item.content).type).toUpperCase();
}

export class MedicationReconciliationCopilotEngine {
  public static compute(
    snapshot: ClinicalEvidenceSnapshot,
    encounterIdValue: string
  ): MedicationReconciliationFinding[] {
    if (snapshot.purpose !== 'MEDICATION_RECONCILIATION') {
      throw new Error('CI10E_EVIDENCE_PURPOSE_MISMATCH');
    }
    if (
      snapshot.evidenceRefs.some(
        (item) =>
          item.tenantId !== snapshot.tenantId ||
          item.patientId !== snapshot.patientId
      )
    ) {
      throw new Error('CI10E_EVIDENCE_SCOPE_MISMATCH');
    }

    const context = contextEvidence(snapshot, encounterIdValue);
    const contextData = record(context.content);
    const encounter = record(contextData.encounter);
    const startedAt =
      numberValue(encounter.startedAt) ||
      numberValue(context.occurredAt) ||
      0;

    const knowledge = knowledgeEvidence(snapshot);
    const orders = evidenceOfType(snapshot, 'MEDICATION_HISTORY');
    const dispenses = evidenceOfType(snapshot, 'MEDICATION_DISPENSE');
    const administrations = evidenceOfType(
      snapshot,
      'MEDICATION_ADMINISTRATION'
    );
    const ci9Findings = evidenceOfType(
      snapshot,
      'MEDICATION_SAFETY_FINDING'
    );

    const currentOrders = orders.filter(
      (item) =>
        encounterId(item) === encounterIdValue &&
        ['ACTIVE', 'ON_HOLD'].includes(orderStatus(item))
    );
    const previousOrders = orders.filter(
      (item) =>
        encounterId(item) !== encounterIdValue ||
        Number(item.occurredAt || 0) < startedAt
    );
    const preEncounterActive = previousOrders.filter((item) =>
      ['ACTIVE', 'ON_HOLD'].includes(orderStatus(item))
    );

    const findings: MedicationReconciliationFinding[] = [];

    const medicationKnowledge = text(
      record(knowledge?.content).medicationKnowledge
    ).toUpperCase();
    if (
      medicationKnowledge &&
      !['KNOWN', 'KNOWN_NONE'].includes(medicationKnowledge) &&
      knowledge
    ) {
      findings.push(
        finding(
          snapshot,
          'MEDICATION_HISTORY_INCOMPLETE',
          'ACTION_REQUIRED',
          'Medication history is incomplete',
          `Medication knowledge is ${medicationKnowledge}; reconciliation cannot be considered complete from the represented evidence.`,
          [knowledge],
          {
            classification: 'DIRECT_FACT',
            caveat:
              'This identifies incomplete medication knowledge; it does not infer which medications are missing.',
          }
        )
      );
    }

    for (const item of ci9Findings) {
      const type = ci9Type(item);
      const data = record(item.content);
      const severity =
        (text(data.severity) as ConsultantChangeSeverity) ||
        'REVIEW_REQUIRED';
      const description = text(data.description) || item.label;

      if (type === 'MEDICATION_RECONCILIATION_REQUIRED') {
        findings.push(
          finding(
            snapshot,
            'RECONCILIATION_REQUIRED',
            severity,
            'Medication reconciliation is required',
            description,
            [item, context, ...(knowledge ? [knowledge] : [])],
            { classification: 'DIRECT_FACT' }
          )
        );
      } else if (type === 'DUPLICATE_ACTIVE_MEDICATION') {
        findings.push(
          finding(
            snapshot,
            'DUPLICATE_ACTIVE_MEDICATION',
            severity,
            'Duplicate active medication requires review',
            description,
            [item, ...orders.filter((order) =>
              Array.isArray(data.medicationOrderIds)
                ? data.medicationOrderIds
                    .map(text)
                    .includes(order.sourceEntityId)
                : false
            )],
            { classification: 'POSSIBLE_DISCREPANCY' }
          )
        );
      } else if (type === 'MEDICATION_ALLERGY_CONFLICT') {
        findings.push(
          finding(
            snapshot,
            'MEDICATION_ALLERGY_CONFLICT',
            severity,
            'Medication-allergy conflict requires review',
            description,
            [
              item,
              ...orders.filter((order) =>
                Array.isArray(data.medicationOrderIds)
                  ? data.medicationOrderIds
                      .map(text)
                      .includes(order.sourceEntityId)
                  : false
              ),
              ...evidenceOfType(snapshot, 'ALLERGY').filter((allergy) =>
                Array.isArray(data.allergyIds)
                  ? data.allergyIds
                      .map(text)
                      .includes(allergy.sourceEntityId)
                  : false
              ),
            ],
            { classification: 'POSSIBLE_DISCREPANCY' }
          )
        );
      }
    }

    for (const prior of preEncounterActive) {
      const identity = medicationIdentity(prior);
      const matchingCurrent = currentOrders.some((item) =>
        sameMedication(prior, item)
      );
      if (!matchingCurrent) {
        findings.push(
          finding(
            snapshot,
            'PRE_ENCOUNTER_ACTIVE_NOT_REPRESENTED_CURRENT',
            'REVIEW_REQUIRED',
            'Possible continuation gap',
            `${identity.name} is represented as active/on-hold before the selected encounter but no matching active/on-hold order is represented in the selected encounter.`,
            [prior, context],
            {
              medication: identity,
              caveat:
                'This is a possible discrepancy only. The prior order is not automatically a verified home medication, and absence of a current order does not prove an unintended omission.',
            }
          )
        );
      }
    }

    for (const current of currentOrders) {
      const identity = medicationIdentity(current);
      const priorSame = previousOrders.filter((item) =>
        sameMedication(current, item)
      );

      const stopped = priorSame.filter((item) =>
        ['STOPPED', 'COMPLETED', 'CANCELLED'].includes(orderStatus(item))
      );
      if (stopped.length > 0) {
        findings.push(
          finding(
            snapshot,
            'CURRENT_ORDER_REAPPEARS_AFTER_STOP',
            'REVIEW_REQUIRED',
            'Medication reappears after prior stop/completion',
            `${identity.name} is active in the selected encounter and also has earlier stopped/completed/cancelled order evidence.`,
            [current, ...stopped],
            {
              medication: identity,
              caveat:
                'Restarting a previously stopped medication may be intentional; clinician review is required.',
            }
          )
        );
      }

      const changed = priorSame.filter(
        (item) =>
          dosageSignature(item) &&
          dosageSignature(current) &&
          dosageSignature(item) !== dosageSignature(current)
      );
      if (changed.length > 0) {
        findings.push(
          finding(
            snapshot,
            'CURRENT_ORDER_DOSE_CHANGED',
            'REVIEW_REQUIRED',
            'Medication regimen changed across care contexts',
            `${identity.name} has different represented dosage/frequency/route details between prior and current orders.`,
            [current, ...changed],
            {
              medication: identity,
              caveat:
                'The engine reports a recorded regimen difference only; it does not infer whether the change is clinically appropriate.',
            }
          )
        );
      }
    }

    const orderById = new Map(
      orders.map((item) => [item.sourceEntityId, item])
    );

    const dispensesByOrder = new Map<string, ClinicalEvidenceRef[]>();
    for (const dispense of dispenses) {
      const data = record(dispense.content);
      const medicationOrderId = text(data.medicationOrderId);
      const matchedOrder = medicationOrderId
        ? orderById.get(medicationOrderId)
        : undefined;

      if (!matchedOrder) {
        const identity = medicationIdentity(dispense);
        findings.push(
          finding(
            snapshot,
            'DISPENSE_WITHOUT_MATCHING_ORDER',
            'ACTION_REQUIRED',
            'Dispense lacks matching canonical medication order',
            `A dispense record for ${identity.name} does not reference a represented canonical medication order.`,
            [dispense],
            {
              medication: identity,
              caveat:
                'This is a traceability discrepancy; it does not establish that dispensing was clinically inappropriate.',
            }
          )
        );
        continue;
      }

      const list = dispensesByOrder.get(medicationOrderId) || [];
      list.push(dispense);
      dispensesByOrder.set(medicationOrderId, list);
    }

    for (const [orderId, orderDispenses] of dispensesByOrder.entries()) {
      const order = orderById.get(orderId);
      if (!order) continue;

      const prescribed = orderedQuantity(order);
      const totalDispensed = orderDispenses.reduce(
        (sum, item) => sum + Number(dispensedQuantity(item) || 0),
        0
      );
      if (
        prescribed !== undefined &&
        totalDispensed > prescribed
      ) {
        const identity = medicationIdentity(order);
        findings.push(
          finding(
            snapshot,
            'DISPENSE_QUANTITY_EXCEEDS_ORDER',
            'ACTION_REQUIRED',
            'Dispensed quantity exceeds represented ordered quantity',
            `${identity.name} has represented dispense quantity ${totalDispensed} greater than represented ordered quantity ${prescribed}.`,
            [order, ...orderDispenses],
            {
              medication: identity,
              caveat:
                'Quantity comparison is arithmetic only and does not infer intent, replacement supply, or external corrections.',
            }
          )
        );
      }
    }

    for (const administration of administrations) {
      const data = record(administration.content);
      const medicationOrderId = text(data.medicationOrderId);
      const exact = medicationOrderId
        ? orderById.get(medicationOrderId)
        : undefined;
      const sameCurrent = currentOrders.some((item) =>
        sameMedication(administration, item)
      );

      if (!exact && !sameCurrent) {
        const identity = medicationIdentity(administration);
        findings.push(
          finding(
            snapshot,
            'ADMINISTRATION_WITHOUT_MATCHING_ORDER',
            'ACTION_REQUIRED',
            'Administration lacks matching represented medication order',
            `A medication-administration record for ${identity.name} has no matching canonical order in the frozen evidence packet.`,
            [administration],
            {
              medication: identity,
              caveat:
                'This is a traceability discrepancy and does not infer that administration was clinically inappropriate.',
            }
          )
        );
      }
    }

    if (currentOrders.length > 0 && dispenses.length === 0) {
      findings.push(
        finding(
          snapshot,
          'DISPENSE_EVIDENCE_NOT_REPRESENTED',
          'INFORMATION',
          'No canonical dispense evidence is represented',
          'Current medication orders are represented, but this evidence snapshot contains no canonical medication-dispense records.',
          [...currentOrders, context],
          {
            classification: 'DIRECT_FACT',
            caveat:
              'This is a coverage statement only. It is not proof that medication was not dispensed or obtained elsewhere.',
          }
        )
      );
    }

    if (
      ['IPD', 'EMERGENCY'].includes(
        text(record(context.content).encounter && record(context.content).encounter && record(record(context.content).encounter).careSetting).toUpperCase()
      ) &&
      currentOrders.length > 0 &&
      administrations.length === 0
    ) {
      findings.push(
        finding(
          snapshot,
          'ADMINISTRATION_EVIDENCE_NOT_REPRESENTED',
          'INFORMATION',
          'No canonical administration evidence is represented',
          'Current medication orders are represented for an inpatient/emergency care context, but this evidence snapshot contains no canonical medication-administration records.',
          [...currentOrders, context],
          {
            classification: 'DIRECT_FACT',
            caveat:
              'This is a coverage statement only. It is not proof that medication was not administered.',
          }
        )
      );
    }

    const deduped = new Map<string, MedicationReconciliationFinding>();
    for (const item of findings) {
      deduped.set(item.findingId, item);
    }

    const ordered = Array.from(deduped.values()).sort(
      (left, right) =>
        ({
          CRITICAL_REVIEW_REQUIRED: 0,
          ACTION_REQUIRED: 1,
          REVIEW_REQUIRED: 2,
          INFORMATION: 3,
        }[left.severity] -
          {
            CRITICAL_REVIEW_REQUIRED: 0,
            ACTION_REQUIRED: 1,
            REVIEW_REQUIRED: 2,
            INFORMATION: 3,
          }[right.severity]) ||
        left.findingId.localeCompare(right.findingId)
    );

    const claims: CopilotClaim[] = ordered.map((item) => ({
      claimId: item.findingId,
      text: item.description,
      classification: item.classification,
      evidenceRefs: item.evidenceRefs,
      confidence: 1,
    }));
    const grounding = ClinicalEvidenceService.validateClaims(
      snapshot,
      claims
    );
    if (!grounding.valid) {
      throw new Error(
        `CI10E_GROUNDING_VALIDATION_FAILED:${grounding.errors.join(',')}`
      );
    }

    return ordered;
  }
}
