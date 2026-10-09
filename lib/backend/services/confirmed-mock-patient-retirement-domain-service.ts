/**
 * Explicit development-only retirement of two confirmed mock MPI identities.
 *
 * This is not a general patient deletion API. It never destroys legal records,
 * recreates synthetic clinical dispositions, or touches financial ledgers.
 */
import { AuthorizationPipeline } from '../auth/authorization-pipeline';
import {
  AtomicMutationRejectedError,
  TransactionManager,
} from '../transactions/transaction-manager';
import { DomainStateRepository } from '@/server/repositories/domain-state-repository';
import { getRuntimeMode } from '@/lib/runtime/runtime-mode';
import type { CommandContext, CommandResult } from '../types';
import type { PatientMPI } from '@/types/mpi';
import { mockRetirementNonOpdPointerBlockers } from './mock-patient-pointer-inspection';

const TARGET_TENANTS = new Set(['tenant_02bb76e3', 'central-metro-hospital']);
const ALLOWED_PATIENTS: Readonly<Record<string, string>> = Object.freeze({
  'MRN-20260820-8790': 'eleanor vance',
  'MRN-20260930-3611': 'test patient',
});
const ADMIN_ROLES = ['ADMIN', 'ADMINISTRATOR', 'SYSTEM_ADMIN', 'SUPER_ADMIN'];
const TERMINAL = new Set(['COMPLETED', 'CLOSED', 'CANCELLED', 'CANCELED', 'DISCHARGED', 'TRANSFERRED']);
const MAX_ENCOUNTERS = 20;
const MAX_QUEUE_TOKENS = 40;
const MAX_TELEHEALTH_SESSIONS = 10;
const CLINICAL_REVIEW_COLLECTIONS = [
  'encounterEvidence', 'clinicalDocuments', 'clinicalObservations',
  'medicationOrders', 'prescriptions', 'orders', 'diagnosticReports',
  'clinicalConditions', 'clinicalAllergies',
] as const;
const EMPTY_TELEHEALTH_STATUSES = new Set(['WAITING_ROOM', 'IN_CONSULTATION', 'DOCUMENTING']);

export interface RetireConfirmedMockPatientPayload {
  patientId: string;
  expectedMrn: string;
  reason: string;
  confirmedSynthetic: true;
}

function normalized(value: unknown): string {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function hasTelehealthClinicalActivity(session: Record<string, unknown>): boolean {
  const soap = session.soapNote;
  if (soap !== undefined && (typeof soap !== 'object' || !soap || Array.isArray(soap))) return true;
  const fields = (soap || {}) as Record<string, unknown>;
  if (Object.values(fields).some(value =>
    Array.isArray(value) ? value.length > 0 :
    typeof value === 'string' ? value.trim().length > 0 :
    value !== null && value !== undefined && value !== false
  )) return true;
  if (session.prescriptions !== undefined && !Array.isArray(session.prescriptions)) return true;
  if (session.transcription !== undefined && !Array.isArray(session.transcription)) return true;
  const duration = Number(session.callDurationSeconds || 0);
  const vitals = session.vitals as Record<string, unknown> | null | undefined;
  const hasVitals = vitals && (
    Boolean(String(vitals.bp || '').trim()) ||
    ['hr', 'spo2', 'temp'].some(field => Number(vitals[field] || 0) !== 0)
  );
  return Boolean(session.signedEvidenceId) ||
    (Array.isArray(session.prescriptions) && session.prescriptions.length > 0) ||
    (Array.isArray(session.transcription) && session.transcription.length > 0) ||
    !Number.isFinite(duration) || duration !== 0 ||
    session.isRecording === true || Boolean(hasVitals);
}

function reject(commandId: string, idempotencyKey: string, code: string, message: string): CommandResult {
  return { success: false, commandId, idempotencyKey, error: { code, message } };
}

export function assertMockCleanupEnvironment(tenantId: string): void {
  const mode = getRuntimeMode();
  const projectId = String(process.env.FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || '').trim();
  const confirmation = String(process.env.GHIMS_MOCK_CLEANUP_CONFIRM_PROJECT || '').trim();
  const prodProject = String(
    process.env.GHIMS_FIREBASE_PROJECT_ID_PRODUCTION ||
    process.env.NEXT_PUBLIC_GHIMS_FIREBASE_PROJECT_ID_PRODUCTION || ''
  ).trim();
  const nodeEnv = String(process.env.NODE_ENV || '').toLowerCase();
  const permittedNode = ['development', 'test'].includes(nodeEnv);
  const expectedProject = String(
    mode === 'DEMO' ? process.env.GHIMS_FIREBASE_PROJECT_ID_DEMO || '' :
      process.env.GHIMS_FIREBASE_PROJECT_ID_TEST || ''
  ).trim();
  // The one known development project may have no separate production ID.
  // Still require the existing opt-in plus a second explicit project acknowledgement.
  const singleConfirmedDevProject = !prodProject && projectId === 'g-hims-ai' &&
    expectedProject === projectId && mode === 'TEST' && nodeEnv === 'development' &&
    process.env.GHIMS_MOCK_CLEANUP_DEV_PROJECT_ACK ===
      'I_CONFIRM_G_HIMS_AI_IS_SYNTHETIC_ONLY';

  if (
    !TARGET_TENANTS.has(tenantId) ||
    !['TEST', 'DEMO'].includes(mode) ||
    !permittedNode ||
    process.env.GHIMS_ENABLE_CONFIRMED_MOCK_CLEANUP !== 'true' ||
    !projectId || !expectedProject || expectedProject !== projectId ||
    confirmation !== projectId ||
    (prodProject ? projectId === prodProject : !singleConfirmedDevProject)
  ) {
    throw new AtomicMutationRejectedError(
      'MOCK_CLEANUP_DISABLED',
      'Synthetic cleanup is disabled. It requires an isolated TEST/DEMO development server, the exact tenant, an explicit enabled flag, and an exact non-production Firebase project confirmation.'
    );
  }
}

export class ConfirmedMockPatientRetirementDomainService {
  public static async retire(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: RetireConfirmedMockPatientPayload
  ): Promise<CommandResult> {
    const auth = AuthorizationPipeline.evaluate(context, { requiredRoles: ADMIN_ROLES });
    if (!auth.authorized) {
      return reject(
        commandId, idempotencyKey, auth.code || 'MOCK_CLEANUP_FORBIDDEN',
        auth.reason || 'Verified hospital administrator authority is required.'
      );
    }
    try {
      assertMockCleanupEnvironment(context.tenantId);
    } catch (error) {
      if (error instanceof AtomicMutationRejectedError) {
        return reject(commandId, idempotencyKey, error.code, error.message);
      }
      throw error;
    }

    const patientId = String(payload.patientId || '').trim();
    const mrn = String(payload.expectedMrn || '').trim().toUpperCase();
    const reason = String(payload.reason || '').trim();
    if (
      !patientId ||
      !Object.prototype.hasOwnProperty.call(ALLOWED_PATIENTS, mrn) ||
      payload.confirmedSynthetic !== true ||
      reason.length < 20 || reason.length > 1000
    ) {
      return reject(
        commandId, idempotencyKey, 'MOCK_CLEANUP_SCOPE_INVALID',
        'Only the two explicitly confirmed mock MRNs can be retired. Confirm the MRN, synthetic status and a written reason.'
      );
    }

    const patient = await DomainStateRepository.getById<PatientMPI>(
      context.tenantId, 'patients', patientId
    );
    if (
      !patient ||
      patient.tenantId !== context.tenantId ||
      patient.mrn?.toUpperCase() !== mrn ||
      normalized(patient.fullName) !== ALLOWED_PATIENTS[mrn] ||
      (patient.gender && normalized(patient.gender) !== 'female') ||
      (patient.bloodGroup && normalized(patient.bloodGroup) !== 'o+')
    ) {
      return reject(
        commandId, idempotencyKey, 'MOCK_CLEANUP_IDENTITY_NOT_VERIFIED',
        'Patient ID, tenant, exact MRN, name, gender or blood group did not match the confirmed mock identity.'
      );
    }
    if (['REMOVED', 'MERGED'].includes(String(patient.status || '').toUpperCase())) {
      return reject(commandId, idempotencyKey, 'MOCK_CLEANUP_ALREADY_RETIRED', 'The mock identity is already removed or merged.');
    }
    const nonOpdPointers = mockRetirementNonOpdPointerBlockers(patient);
    const nonTelehealthBlockers = nonOpdPointers.filter(
      field => field !== 'activeCareContexts.activeTelehealthEncounterIds'
    );
    if (nonTelehealthBlockers.length) {
      return reject(
        commandId, idempotencyKey, 'MOCK_CLEANUP_NON_OPD_ACTIVE_CARE',
        'Synthetic retirement blocked by ' + nonTelehealthBlockers.join(', ') +
        '. Read source: ' +
        (['TEST', 'DEMO'].includes(getRuntimeMode()) &&
        TransactionManager.hasEphemeralState(context.tenantId)
          ? 'in-process TEST/DEMO state'
          : 'Firestore') +
        '. Inspect the authoritative encounter or bed evidence. No records were changed.'
      );
    }

    const encounters = await DomainStateRepository.queryAllEqual<Record<string, unknown>>(
      context.tenantId, 'encounters', 'patientId', patientId,
      { pageSize: 50, maxRows: MAX_ENCOUNTERS + 1 }
    );
    if (encounters.length > MAX_ENCOUNTERS) {
      return reject(commandId, idempotencyKey, 'MOCK_CLEANUP_TOO_MANY_ENCOUNTERS', 'Too many linked encounters. Manual review required.');
    }

    const encounterIds = new Set<string>();
    const telehealthEncounterIds = new Set<string>();
    for (const encounter of encounters) {
      const id = String(encounter.encounterId || encounter.id || '').trim();
      const type = String(encounter.encounterType || encounter.type || '').toUpperCase();
      if (!id || encounterIds.has(id) || !['OPD', 'TELEHEALTH'].includes(type)) {
        return reject(
          commandId, idempotencyKey, 'MOCK_CLEANUP_UNSUPPORTED_ENCOUNTER',
          'Only unique, fully identified OPD or empty verified telehealth test encounters are eligible.'
        );
      }
      encounterIds.add(id);
      if (type === 'TELEHEALTH') telehealthEncounterIds.add(id);
    }

    const rawOpdIds = patient.activeCareContexts?.activeOpdEncounterIds;
    const rawTelehealthIds = patient.activeCareContexts?.activeTelehealthEncounterIds;
    if ((rawOpdIds !== undefined && !Array.isArray(rawOpdIds)) ||
        (rawTelehealthIds !== undefined && !Array.isArray(rawTelehealthIds))) {
      return reject(commandId, idempotencyKey, 'MOCK_CLEANUP_POINTERS_MALFORMED',
        'Malformed care pointers require manual review.');
    }
    const activeOpdIds = (rawOpdIds || []) as string[];
    const activeTelehealthIds = (rawTelehealthIds || []) as string[];
    const stalePointers = [
      ...(patient.activeEncounterId ? [patient.activeEncounterId] : []),
      ...activeOpdIds, ...activeTelehealthIds,
    ].filter(id => typeof id !== 'string' || !encounterIds.has(id));
    if (activeTelehealthIds.some(id => !telehealthEncounterIds.has(id))) {
      return reject(commandId, idempotencyKey, 'MOCK_CLEANUP_TELEHEALTH_POINTER_MISMATCH',
        'Active telehealth pointer does not match the authoritative encounter.');
    }
    if (stalePointers.length) {
      return reject(
        commandId, idempotencyKey, 'MOCK_CLEANUP_ORPHANED_CARE_POINTER',
        `Cannot retire patient while an active care pointer references unverified encounter ${stalePointers[0]}.`
      );
    }

    const sessions = await DomainStateRepository.queryAllEqual<Record<string, unknown>>(
      context.tenantId, 'telehealthSessions', 'patientId', patientId,
      { pageSize: 20, maxRows: MAX_TELEHEALTH_SESSIONS + 1 }
    );
    if (sessions.length > MAX_TELEHEALTH_SESSIONS) {
      return reject(commandId, idempotencyKey, 'MOCK_CLEANUP_TOO_MANY_TELEHEALTH_SESSIONS',
        'Too many linked telehealth sessions for bounded review.');
    }
    const seenSessionIds = new Set<string>();
    const matchedEncounterIds = new Set<string>();
    for (const session of sessions) {
      const sessionId = String(session.id || '').trim();
      const encounterId = String(session.encounterId || '').trim();
      const status = String(session.status || '').toUpperCase();
      const hasClinicalActivity = hasTelehealthClinicalActivity(session);
      if (!sessionId || seenSessionIds.has(sessionId) ||
          !telehealthEncounterIds.has(encounterId) ||
          matchedEncounterIds.has(encounterId) ||
          String(session.patientId) !== patientId ||
          String(session.tenantId || context.tenantId) !== context.tenantId ||
          !EMPTY_TELEHEALTH_STATUSES.has(status) || hasClinicalActivity) {
        return reject(commandId, idempotencyKey, 'MOCK_CLEANUP_TELEHEALTH_REVIEW_REQUIRED',
          'Telehealth session is missing, mismatched, final, duplicate, or contains clinical/call activity.');
      }
      seenSessionIds.add(sessionId);
      matchedEncounterIds.add(encounterId);
    }
    if (matchedEncounterIds.size !== telehealthEncounterIds.size ||
        activeTelehealthIds.some(id => !matchedEncounterIds.has(id))) {
      return reject(commandId, idempotencyKey, 'MOCK_CLEANUP_TELEHEALTH_SESSION_MISSING',
        'Every telehealth encounter and active pointer must resolve to one empty session.');
    }
    // Even an empty session cannot prove clinical evidence is absent.
    for (const collection of CLINICAL_REVIEW_COLLECTIONS) {
      const rows = await DomainStateRepository.queryAllEqual<Record<string, unknown>>(
        context.tenantId, collection, 'patientId', patientId,
        { pageSize: 5, maxRows: 6 }
      );
      if (rows.length) {
        return reject(commandId, idempotencyKey, 'MOCK_CLEANUP_CLINICAL_REVIEW_REQUIRED',
          'Clinical evidence or orders exist in ' + collection + '. Review manually.');
      }
    }
    for (const field of ['patientId', 'currentPatientId']) {
      const linkedBeds = await DomainStateRepository.queryAllEqual<Record<string, unknown>>(
        context.tenantId, 'beds', field, patientId, { pageSize: 5, maxRows: 6 }
      );
      if (linkedBeds.length) {
        return reject(commandId, idempotencyKey, 'MOCK_CLEANUP_BED_LINK_REVIEW_REQUIRED',
          'A bed still references the patient; no change was made.');
      }
    }

    // No automatic invoice voids, reversals, or payment destruction. If finance
    // data exists, its own governed reversal/retirement must happen first.
    for (const collection of ['invoices', 'encounterCharges', 'payments', 'cashReceipts', 'invoiceSettlements']) {
      const rows = await DomainStateRepository.queryAllEqual<Record<string, unknown>>(
        context.tenantId, collection, 'patientId', patientId,
        { pageSize: 5, maxRows: 6 }
      );
      if (rows.length) {
        return reject(
          commandId, idempotencyKey, 'MOCK_CLEANUP_FINANCIAL_RECONCILIATION_REQUIRED',
          `The mock patient has records in ${collection}. Reconcile synthetic financial entries before retirement; no ledger is changed automatically.`
        );
      }
    }
    for (const encounterId of encounterIds) {
      const invoice = await DomainStateRepository.getById<Record<string, unknown>>(
        context.tenantId, 'invoices', `inv_opd_consult_${encounterId}`
      );
      if (invoice) {
        return reject(
          commandId, idempotencyKey, 'MOCK_CLEANUP_FINANCIAL_RECONCILIATION_REQUIRED',
          `Encounter ${encounterId} has a consultation invoice that must be reconciled first.`
        );
      }
    }

    const queueTokens = await DomainStateRepository.queryAllEqual<Record<string, unknown>>(
      context.tenantId, 'opd_queue', 'patientId', patientId,
      { pageSize: 50, maxRows: MAX_QUEUE_TOKENS + 1 }
    );
    if (queueTokens.length > MAX_QUEUE_TOKENS) {
      return reject(commandId, idempotencyKey, 'MOCK_CLEANUP_TOO_MANY_QUEUE_TOKENS', 'Too many linked queue tokens.');
    }
    const queueIds = new Set<string>();
    for (const q of queueTokens) {
      const id = String(q.tokenId || q.id || q.queueTokenId || '').trim();
      if (!id || queueIds.has(id) || (q.encounterId && !encounterIds.has(String(q.encounterId)))) {
        return reject(commandId, idempotencyKey, 'MOCK_CLEANUP_QUEUE_REVIEW_REQUIRED', 'A queue token is malformed or references a different care episode.');
      }
      queueIds.add(id);
    }

    try {
      const tx = await TransactionManager.executeAtomicReadModifyMutation({
        tenantId: context.tenantId,
        actorId: context.actorId,
        actorRole: context.roles[0] || 'ADMINISTRATOR',
        actorRoles: context.roles,
        deviceId: context.deviceId,
        sessionId: context.sessionId,
        aggregateType: 'PATIENT_MPI',
        aggregateId: patientId,
        eventType: 'CONFIRMED_MOCK_PATIENT_RETIRED',
        auditAction: 'PATIENT_RECORD_REMOVED',
        auditResourceType: 'PATIENT',
        auditResourceId: patientId,
        omitDomainStateFromAudit: true,
        outboxTopic: 'g-hims-patient-identity-events',
        idempotencyKey,
        commandId,
        correlationId: context.correlationId,
        source: 'web',
        readTargets: [
          { key: 'patient', entityType: 'PATIENT_MPI', entityId: patientId, required: true },
          ...encounters.map((e, i) => ({
            key: `encounter_${i}`, entityType: 'ENCOUNTER',
            entityId: String(e.encounterId || e.id), required: true,
          })),
          ...queueTokens.map((q, i) => ({
            key: `queue_${i}`, entityType: 'OPD_QUEUE_TOKEN',
            entityId: String(q.tokenId || q.id || q.queueTokenId), required: true,
          })),
          ...sessions.map((session, i) => ({
            key: `session_${i}`, entityType: 'TELEHEALTH_SESSION',
            entityId: String(session.id), required: true,
          })),
        ],
        prepare: (current) => {
          // Check the environment again at commit, not only during preflight.
          assertMockCleanupEnvironment(context.tenantId);
          const latest = current.patient as unknown as PatientMPI;
          if (!latest || latest.tenantId !== context.tenantId ||
              latest.id !== patientId || latest.mrn?.toUpperCase() !== mrn ||
              normalized(latest.fullName) !== ALLOWED_PATIENTS[mrn] ||
              ['MERGED', 'REMOVED'].includes(String(latest.status || '').toUpperCase()) ||
              mockRetirementNonOpdPointerBlockers(latest).some(
                field => field !== 'activeCareContexts.activeTelehealthEncounterIds'
              ) ||
              Number(latest.version || 0) !== Number(patient.version || 0) ||
              JSON.stringify(latest.activeCareContexts?.activeTelehealthEncounterIds || []) !==
                JSON.stringify(activeTelehealthIds) ||
              JSON.stringify(latest.activeCareContexts?.activeOpdEncounterIds || []) !==
                JSON.stringify(activeOpdIds) ||
              String(latest.activeEncounterId || '') !== String(patient.activeEncounterId || '')) {
            throw new AtomicMutationRejectedError(
              'MOCK_CLEANUP_PATIENT_CHANGED',
              'Patient identity or care scope changed since verification; no changes were committed.'
            );
          }

          const now = Date.now();
          const transitions: Array<{ encounterId: string; previousStatus: string; resultingStatus: string }> = [];
          const writes = encounters.map((encounter, i) => {
            const state = current[`encounter_${i}`] as Record<string, unknown> | null;
            const id = String(encounter.encounterId || encounter.id);
            if (!state || String(state.patientId) !== patientId ||
                String(state.encounterId || state.id) !== id ||
                String(state.encounterType || state.type || '').toUpperCase() !==
                  String(encounter.encounterType || encounter.type || '').toUpperCase() ||
                String(state.status || '') !== String(encounter.status || '')) {
              throw new AtomicMutationRejectedError(
                'MOCK_CLEANUP_ENCOUNTER_CHANGED',
                `Encounter ${id} changed. Refresh before retrying.`
              );
            }
            const previousStatus = String(state.status || 'UNKNOWN').toUpperCase();
            const resultingStatus = TERMINAL.has(previousStatus) ? previousStatus : 'CANCELLED';
            transitions.push({ encounterId: id, previousStatus, resultingStatus });
            return {
              entityType: 'ENCOUNTER',
              entityId: id,
              domainState: {
                ...state,
                status: resultingStatus,
                administrativeDisposition: 'CONFIRMED_SYNTHETIC_TEST_RETIREMENT',
                syntheticCleanup: { actorId: context.actorId, commandId, reason, retiredAt: now, previousStatus },
                updatedAt: now,
              },
            };
          });

          for (let i = 0; i < sessions.length; i++) {
            const state = current[`session_${i}`] as Record<string, unknown> | null;
            const snapshot = sessions[i];
            const id = String(snapshot.id);
            if (!state || String(state.id) !== id ||
                String(state.patientId) !== patientId ||
                String(state.encounterId) !== String(snapshot.encounterId) ||
                String(state.status) !== String(snapshot.status) ||
                JSON.stringify(state.soapNote || {}) !== JSON.stringify(snapshot.soapNote || {}) ||
                JSON.stringify(state.prescriptions || []) !== JSON.stringify(snapshot.prescriptions || []) ||
                JSON.stringify(state.transcription || []) !== JSON.stringify(snapshot.transcription || []) ||
                String(state.signedEvidenceId || '') !== String(snapshot.signedEvidenceId || '') ||
                Number(state.callDurationSeconds || 0) !== Number(snapshot.callDurationSeconds || 0) ||
                state.isRecording !== snapshot.isRecording ||
                hasTelehealthClinicalActivity(state)) {
              throw new AtomicMutationRejectedError(
                'MOCK_CLEANUP_TELEHEALTH_CHANGED',
                'Telehealth session changed since empty-session verification. No changes committed.'
              );
            }
            const priorStatus = String(state.status);
            writes.push({
              entityType: 'TELEHEALTH_SESSION',
              entityId: id,
              domainState: {
                ...state,
                status: 'CANCELLED',
                administrativeDisposition: 'CONFIRMED_SYNTHETIC_TEST_RETIREMENT',
                syntheticCleanup: {
                  actorId: context.actorId, commandId, reason, retiredAt: now,
                  previousStatus: priorStatus,
                },
                updatedAt: new Date(now).toISOString(),
              },
            });
          }

          for (let i = 0; i < queueTokens.length; i++) {
            const state = current[`queue_${i}`] as Record<string, unknown> | null;
            const id = String(queueTokens[i].tokenId || queueTokens[i].id || queueTokens[i].queueTokenId);
            if (!state || String(state.patientId) !== patientId ||
                String(state.tokenId || state.id || state.queueTokenId) !== id) {
              throw new AtomicMutationRejectedError('MOCK_CLEANUP_QUEUE_CHANGED', `Queue token ${id} changed.`);
            }
            const previousStatus = String(state.status || 'UNKNOWN');
            writes.push({
              entityType: 'OPD_QUEUE_TOKEN',
              entityId: id,
              domainState: {
                ...state,
                status: ['completed', 'cancelled', 'canceled', 'no_show', 'transferred'].includes(previousStatus.toLowerCase())
                  ? previousStatus : 'cancelled',
                administrativeDisposition: 'CONFIRMED_SYNTHETIC_TEST_RETIREMENT',
                syntheticCleanup: { actorId: context.actorId, commandId, reason, retiredAt: now, previousStatus },
                updatedAt: now,
              },
            });
          }

          const oldStatus = String(latest.status || 'ACTIVE').toUpperCase();
          return {
            domainState: {
              ...latest,
              status: 'REMOVED',
              activeEncounterId: '',
              activeCareContexts: {
                ...(latest.activeCareContexts || {}),
                activeOpdEncounterIds: [],
                activeTelehealthEncounterIds: [],
                updatedAt: now,
              },
              removal: {
                removedBy: context.actorId,
                removedAt: now,
                reason,
                previousStatus: oldStatus,
                commandId,
              },
              syntheticCleanup: {
                confirmedMock: true,
                encounterCount: encounters.length,
                telehealthSessionCount: sessions.length,
                queueTokenCount: queueTokens.length,
                retiredAt: now,
              },
              updatedAt: now,
              version: Number(latest.version || 0) + 1,
            },
            additionalStateWrites: writes,
            eventPayload: {
              patientId, mrn, reason, synthetic: true,
              encounterTransitions: transitions,
              queueTokenIds: [...queueIds],
              telehealthSessionIds: [...seenSessionIds],
            },
            auditReason: reason,
            auditMetadata: {
              mrn, priorStatus: oldStatus, resultingStatus: 'REMOVED',
              synthetic: true,
              encounterTransitions: transitions,
              queueTokenIds: [...queueIds],
              telehealthSessionIds: [...seenSessionIds],
              patientDataDeleted: false,
            },
            resultData: {
              patientId, mrn, status: 'REMOVED',
              retiredEncounters: transitions.map(x => x.encounterId),
              retiredQueueTokens: [...queueIds],
              retiredTelehealthSessions: [...seenSessionIds],
            },
          };
        },
      });
      return {
        success: true,
        commandId,
        idempotencyKey,
        entityId: patientId,
        eventId: tx.eventId,
        auditId: tx.auditId,
        outboxId: tx.outboxId,
        data: tx.resultData,
      };
    } catch (error) {
      if (error instanceof AtomicMutationRejectedError) {
        return reject(commandId, idempotencyKey, error.code, error.message);
      }
      throw error;
    }
  }
}
