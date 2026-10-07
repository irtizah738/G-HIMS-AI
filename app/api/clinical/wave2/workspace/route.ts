import { NextRequest, NextResponse } from 'next/server';
import { deriveAuthoritativeContext } from '@/lib/backend/security/authoritative-context';
import { DomainStateRepository } from '@/server/repositories/domain-state-repository';
import { assertPatient360PatientAccess } from '@/lib/clinical/patient360/patient360-access';
import { getAdminFirestore } from '@/server/firebase/admin';

const WAVE2_READ_ROLES = new Set([
  'SYSTEM_ADMIN',
  'ADMIN',
  'ADMINISTRATOR',
  'DOCTOR',
  'PHYSICIAN',
  'CONSULTANT',
  'ATTENDING_PHYSICIAN',
  'NURSE',
  'HEAD_NURSE',
  'PHYSIOTHERAPIST',
  'PHYSICAL_THERAPIST',
  'OCCUPATIONAL_THERAPIST',
  'SPEECH_THERAPIST',
  'REHABILITATION_THERAPIST',
]);

const WAVE2_COLLECTIONS = [
  'medicationOrders',
  'emarScheduleSlots',
  'medicationAdministrations',
  'nursingCarePlans',
  'renalDialysisOrders',
  'renalDialysisSessions',
  'obstetricEpisodes',
  'obstetricPartogramEntries',
  'oncologyCases',
  'oncologyTumorBoardRecommendations',
  'oncologyRegimens',
  'oncologyChemotherapyLinks',
  'oncologyToxicityAssessments',
  'rehabilitationPlans',
  'rehabilitationSessions',
  'clinicalHandoffs',
  'clinicalConditions',
  'diagnosticReports',
  'clinicalDocuments',
  'clinicalObservations',
  'diseaseIntakeArtifacts',
] as const;

type Wave2Collection = (typeof WAVE2_COLLECTIONS)[number];

function assertWave2ReadRole(roles: string[]): void {
  const normalized = roles.map((role) => String(role || '').trim().toUpperCase());
  if (!normalized.some((role) => WAVE2_READ_ROLES.has(role))) {
    throw new Error('WAVE2_WORKSPACE_ACCESS_DENIED');
  }
}

async function readPatientCollection(
  tenantId: string,
  collection: Wave2Collection,
  patientId: string,
  encounterId: string
): Promise<Record<string, unknown>[]> {
  const db = getAdminFirestore();
  if (!db) throw new Error('WAVE2_WORKSPACE_STORE_UNAVAILABLE');

  const snapshot = await db
    .collection('tenants')
    .doc(tenantId)
    .collection(collection)
    .where('patientId', '==', patientId)
    .limit(251)
    .get();

  if (snapshot.size > 250) {
    throw new Error(`WAVE2_WORKSPACE_LIMIT_EXCEEDED:${collection}`);
  }

  return snapshot.docs
    .map((document) => {
      const data = document.data() as Record<string, unknown>;
      return {
        id: document.id,
        ...data,
      } as Record<string, unknown>;
    })
    .filter((record) => {
      const recordEncounter = String(record.encounterId || '').trim();
      return !recordEncounter || recordEncounter === encounterId;
    });
}

function sortByTimestamp(
  records: Record<string, unknown>[],
  keys: string[]
): Record<string, unknown>[] {
  return [...records].sort((left, right) => {
    const timestamp = (record: Record<string, unknown>) => {
      for (const key of keys) {
        const value = Number(record[key] || 0);
        if (Number.isFinite(value) && value > 0) return value;
      }
      return 0;
    };
    return timestamp(right) - timestamp(left);
  });
}

export async function GET(req: NextRequest) {
  try {
    const tenantId = String(req.nextUrl.searchParams.get('tenantId') || '')
      .trim()
      .toLowerCase();
    const patientId = String(req.nextUrl.searchParams.get('patientId') || '').trim();
    const encounterId = String(req.nextUrl.searchParams.get('encounterId') || '').trim();

    if (!tenantId || !patientId || !encounterId) {
      return NextResponse.json(
        { error: 'tenantId, patientId and encounterId are required.' },
        { status: 400 }
      );
    }

    const { context } = await deriveAuthoritativeContext(req, tenantId);
    assertWave2ReadRole(context.roles);

    const [patient, encounter] = await Promise.all([
      DomainStateRepository.getById<Record<string, unknown>>(
        tenantId,
        'patients',
        patientId
      ),
      DomainStateRepository.getById<Record<string, unknown>>(
        tenantId,
        'encounters',
        encounterId
      ),
    ]);

    if (!patient) {
      return NextResponse.json({ error: 'Patient not found.' }, { status: 404 });
    }
    if (!encounter || String(encounter.patientId || '') !== patientId) {
      return NextResponse.json(
        { error: 'Encounter does not belong to patient.' },
        { status: 404 }
      );
    }

    assertPatient360PatientAccess(context, patient, encounter);

    const reads = await Promise.all(
      WAVE2_COLLECTIONS.map((collection) =>
        readPatientCollection(tenantId, collection, patientId, encounterId)
      )
    );

    const byCollection = Object.fromEntries(
      WAVE2_COLLECTIONS.map((collection, index) => [collection, reads[index]])
    ) as Record<Wave2Collection, Record<string, unknown>[]>;

    const activeMedicationOrders = sortByTimestamp(
      byCollection.medicationOrders.filter((item) =>
        ['ACTIVE', 'ON_HOLD'].includes(String(item.status || ''))
      ),
      ['authoredAt', 'createdAt', 'updatedAt']
    );

    return NextResponse.json({
      tenantId,
      patientId,
      encounterId,
      generatedAt: Date.now(),
      encounter: {
        encounterId,
        encounterType: encounter.encounterType || encounter.type,
        status: encounter.status,
        departmentId: encounter.departmentId,
        facilityId: encounter.facilityId,
      },
      activeMedicationOrders,
      emarScheduleSlots: sortByTimestamp(byCollection.emarScheduleSlots, [
        'scheduledFor',
        'createdAt',
      ]),
      medicationAdministrations: sortByTimestamp(
        byCollection.medicationAdministrations,
        ['administeredAt', 'createdAt']
      ),
      nursingCarePlans: sortByTimestamp(byCollection.nursingCarePlans, [
        'updatedAt',
        'authoredAt',
      ]),
      renalDialysisOrders: sortByTimestamp(byCollection.renalDialysisOrders, [
        'updatedAt',
        'orderedAt',
      ]),
      renalDialysisSessions: sortByTimestamp(byCollection.renalDialysisSessions, [
        'updatedAt',
        'startedAt',
      ]),
      obstetricEpisodes: sortByTimestamp(byCollection.obstetricEpisodes, [
        'updatedAt',
        'createdAt',
      ]),
      obstetricPartogramEntries: sortByTimestamp(
        byCollection.obstetricPartogramEntries,
        ['observedAt']
      ),
      oncologyCases: sortByTimestamp(byCollection.oncologyCases, [
        'updatedAt',
        'openedAt',
      ]),
      oncologyTumorBoardRecommendations: sortByTimestamp(
        byCollection.oncologyTumorBoardRecommendations,
        ['recordedAt']
      ),
      oncologyRegimens: sortByTimestamp(byCollection.oncologyRegimens, [
        'updatedAt',
        'approvedAt',
      ]),
      oncologyChemotherapyLinks: sortByTimestamp(
        byCollection.oncologyChemotherapyLinks,
        ['linkedAt']
      ),
      oncologyToxicityAssessments: sortByTimestamp(
        byCollection.oncologyToxicityAssessments,
        ['assessedAt']
      ),
      rehabilitationPlans: sortByTimestamp(byCollection.rehabilitationPlans, [
        'updatedAt',
        'authoredAt',
      ]),
      rehabilitationSessions: sortByTimestamp(
        byCollection.rehabilitationSessions,
        ['occurredAt']
      ),
      acceptedClinicalHandoffs: sortByTimestamp(
        byCollection.clinicalHandoffs.filter(
          (item) => String(item.status || '') === 'ACCEPTED'
        ),
        ['acceptedAt', 'updatedAt', 'createdAt']
      ),
      oncologyEvidenceSources: [
        ...byCollection.clinicalConditions.map((item) => ({
          evidenceId: item.id,
          evidenceType: 'CLINICAL_CONDITION',
          label:
            String((item.code as Record<string, unknown> | undefined)?.text || '') ||
            String(item.display || item.id || ''),
        })),
        ...byCollection.diagnosticReports
          .filter((item) => String(item.status || '').toUpperCase() !== 'ENTERED_IN_ERROR')
          .map((item) => ({
            evidenceId: item.id,
            evidenceType: 'DIAGNOSTIC_REPORT',
            label:
              String((item.code as Record<string, unknown> | undefined)?.text || '') ||
              String(item.conclusion || item.id || ''),
          })),
        ...byCollection.clinicalDocuments
          .filter((item) => String(item.status || '').toUpperCase() !== 'ENTERED_IN_ERROR')
          .map((item) => ({
            evidenceId: item.id,
            evidenceType: 'CLINICAL_DOCUMENT',
            label: String(item.title || item.documentType || item.id || ''),
          })),
        ...byCollection.clinicalObservations
          .filter((item) => String(item.status || '').toUpperCase() !== 'ENTERED_IN_ERROR')
          .map((item) => ({
            evidenceId: item.id,
            evidenceType: 'CLINICAL_OBSERVATION',
            label:
              String((item.code as Record<string, unknown> | undefined)?.text || '') ||
              String(item.id || ''),
          })),
        ...byCollection.diseaseIntakeArtifacts
          .filter((item) => String(item.status || '').toUpperCase() === 'FINAL')
          .map((item) => ({
            evidenceId: item.id,
            evidenceType: 'DISEASE_INTAKE',
            label: String(item.templateName || item.id || ''),
          })),
      ].slice(0, 100),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const forbidden =
      message.includes('ACCESS_DENIED') ||
      message.includes('UNAUTHORIZED') ||
      message.includes('FORBIDDEN');
    return NextResponse.json(
      { error: message },
      { status: forbidden ? 403 : 500 }
    );
  }
}
