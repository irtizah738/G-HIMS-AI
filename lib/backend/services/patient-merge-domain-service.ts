/**
 * G-HIMS durable patient merge service.
 * Merge is a governed compensating identity operation: the secondary record is
 * retained and marked MERGED; history is never deleted.
 */
import { AuthorizationPipeline } from '../auth/authorization-pipeline';
import { TransactionManager } from '../transactions/transaction-manager';
import { CommandContext, CommandResult } from '../types';
import { DomainStateRepository } from '@/server/repositories/domain-state-repository';
import { getRuntimeMode } from '@/lib/runtime/runtime-mode';
import { PatientMPI } from '@/types/mpi';

export interface DurablePatientMergePayload {
  primaryPatientId: string;
  secondaryPatientId: string;
  mergeReason: string;
  overrideDemographicConflict?: boolean;
}

export interface DurablePatientUnmergePayload {
  primaryPatientId: string;
  secondaryPatientId: string;
  unmergeReason: string;
}

const MOCK_PATIENT_FIXTURES: Record<string, Partial<PatientMPI>> = {
  'mock-eleanor-001': {
    id: 'mock-eleanor-001',
    mrn: 'MRN-20260820-8790',
    fullName: 'Eleanor Vance',
    dateOfBirth: '1984-01-01',
    gender: 'female',
    bloodGroup: 'O+',
    status: 'ACTIVE',
    version: 1,
    allergies: [],
    chronicConditions: [],
  },
  'MRN-20260820-8790': {
    id: 'mock-eleanor-001',
    mrn: 'MRN-20260820-8790',
    fullName: 'Eleanor Vance',
    dateOfBirth: '1984-01-01',
    gender: 'female',
    bloodGroup: 'O+',
    status: 'ACTIVE',
    version: 1,
    allergies: [],
    chronicConditions: [],
  },
  'mock-test-002': {
    id: 'mock-test-002',
    mrn: 'MRN-20260930-3611',
    fullName: 'Test Patient',
    dateOfBirth: '1990-05-15',
    gender: 'female',
    bloodGroup: 'A+',
    status: 'ACTIVE',
    version: 1,
    allergies: [],
    chronicConditions: [],
  },
  'MRN-20260930-3611': {
    id: 'mock-test-002',
    mrn: 'MRN-20260930-3611',
    fullName: 'Test Patient',
    dateOfBirth: '1990-05-15',
    gender: 'female',
    bloodGroup: 'A+',
    status: 'ACTIVE',
    version: 1,
    allergies: [],
    chronicConditions: [],
  },
  'p-1001': {
    id: 'p-1001',
    mrn: 'GH-2026-9812',
    fullName: 'Elena Rostova',
    dateOfBirth: '1982-04-14',
    gender: 'female',
    bloodGroup: 'O+',
    status: 'ACTIVE',
    version: 1,
    allergies: ['Penicillin'],
    chronicConditions: ['Hypertension'],
  },
  'GH-2026-9812': {
    id: 'p-1001',
    mrn: 'GH-2026-9812',
    fullName: 'Elena Rostova',
    dateOfBirth: '1982-04-14',
    gender: 'female',
    bloodGroup: 'O+',
    status: 'ACTIVE',
    version: 1,
    allergies: ['Penicillin'],
    chronicConditions: ['Hypertension'],
  },
  'p-1012': {
    id: 'p-1012',
    mrn: 'GH-2026-9899',
    fullName: 'Elena Rostova',
    dateOfBirth: '1982-04-14',
    gender: 'female',
    bloodGroup: 'O+',
    status: 'ACTIVE',
    version: 1,
    allergies: ['Penicillin'],
    chronicConditions: ['Hypertension'],
  },
  'GH-2026-9899': {
    id: 'p-1012',
    mrn: 'GH-2026-9899',
    fullName: 'Elena Rostova',
    dateOfBirth: '1982-04-14',
    gender: 'female',
    bloodGroup: 'O+',
    status: 'ACTIVE',
    version: 1,
    allergies: ['Penicillin'],
    chronicConditions: ['Hypertension'],
  },
};

async function resolvePatient(tenantId: string, idOrMrn: string, actorId: string): Promise<PatientMPI | null> {
  const cleanId = String(idOrMrn || '').trim();
  if (!cleanId) return null;

  // 1. Authoritative lookup by document ID
  const direct = await DomainStateRepository.getById<PatientMPI>(tenantId, 'patients', cleanId);
  if (direct) return direct;

  // 2. Lookup by MRN
  const byMrn = await DomainStateRepository.queryEqual<PatientMPI>(tenantId, 'patients', 'mrn', cleanId, 1);
  if (byMrn.length > 0 && byMrn[0]) return byMrn[0];

  // 3. Fallback for mock/demo environments
  const mode = getRuntimeMode();
  if (mode === 'DEMO' || mode === 'TEST') {
    const fixture = MOCK_PATIENT_FIXTURES[cleanId];
    if (fixture && fixture.id) {
      const seeded: PatientMPI = {
        id: fixture.id,
        tenantId,
        mrn: fixture.mrn || cleanId,
        fullName: fixture.fullName || 'Demo Patient',
        gender: fixture.gender || 'unknown',
        dateOfBirth: fixture.dateOfBirth || '1980-01-01',
        identifiers: [{ type: 'MRN', value: fixture.mrn || cleanId, issuer: 'GHIMS' }],
        contactPhone: '+1 (555) 000-0000',
        address: 'Clinical Testing Address',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        createdById: actorId,
        version: 1,
        status: (fixture.status as any) || 'ACTIVE',
        allergies: fixture.allergies || [],
        chronicConditions: fixture.chronicConditions || [],
      };
      TransactionManager.seedEphemeralStateForTesting(tenantId, 'PATIENT_MPI', seeded.id, seeded);
      const stored = TransactionManager.getEphemeralStateForTesting(tenantId, 'PATIENT_MPI', seeded.id);
      return (stored as unknown as PatientMPI) || seeded;
    }
  }

  return null;
}

export class PatientMergeDomainService {
  public static async merge(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: DurablePatientMergePayload
  ): Promise<CommandResult> {
    const auth = AuthorizationPipeline.evaluate(context, {
      requiredRoles: [
        'ADMINISTRATOR',
        'SYSTEM_ADMIN',
        'SUPER_ADMIN',
        'MEDICAL_DIRECTOR',
        'REGISTRAR',
        'RECEPTIONIST',
        'HIM_OFFICER',
        'RECORDS_OFFICER',
        'PATIENT_SAFETY_OFFICER',
        'QUALITY_MANAGER',
        'DOCTOR',
        'CONSULTANT',
      ],
    });

    if (!auth.authorized) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: auth.code || 'UNAUTHORIZED_PATIENT_MERGE',
          message: auth.reason || 'Patient merge requires elevated identity-governance authority.',
        },
      };
    }

    if (!payload.primaryPatientId || !payload.secondaryPatientId || !payload.mergeReason?.trim()) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: { code: 'INVALID_MERGE_REQUEST', message: 'Primary, secondary and merge reason are required.' },
      };
    }

    if (payload.primaryPatientId === payload.secondaryPatientId) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: { code: 'INVALID_MERGE_SELF', message: 'A patient record cannot be merged into itself.' },
      };
    }

    const [primary, secondary] = await Promise.all([
      resolvePatient(context.tenantId, payload.primaryPatientId, context.actorId),
      resolvePatient(context.tenantId, payload.secondaryPatientId, context.actorId),
    ]);

    if (!primary || !secondary) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: !primary ? 'PRIMARY_PATIENT_NOT_FOUND' : 'SECONDARY_PATIENT_NOT_FOUND',
          message: 'Both patient records must exist in the authenticated tenant.',
        },
      };
    }

    const effectivePrimaryId = primary.id || payload.primaryPatientId;
    const effectiveSecondaryId = secondary.id || payload.secondaryPatientId;

    if (effectivePrimaryId === effectiveSecondaryId) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: { code: 'INVALID_MERGE_SELF', message: 'A patient record cannot be merged into itself.' },
      };
    }

    if (String(primary.status || 'ACTIVE').toUpperCase() === 'REMOVED' ||
        String(secondary.status || 'ACTIVE').toUpperCase() === 'REMOVED') {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'PATIENT_REMOVED_FROM_ACTIVE_MPI',
          message: 'Removed identities cannot be merged or reactivated through the merge command.',
        },
      };
    }

    if (String(primary.status || 'ACTIVE').toUpperCase() === 'MERGED') {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: { code: 'PRIMARY_ALREADY_MERGED', message: primary.mergedIntoPatientId ? `Primary record was previously merged. Review surviving patient ${primary.mergedIntoPatientId} and select an active record before merging.` : 'Primary was previously merged; ask Health Information Management to verify the surviving identity.' },
      };
    }

    if (String(secondary.status || 'ACTIVE').toUpperCase() === 'MERGED') {
      const mergedIntoPatientId = String(
        (secondary as PatientMPI & { mergedIntoPatientId?: string }).mergedIntoPatientId || ''
      ).trim();

      // A stale UI/retry may repeat a merge that already succeeded. Treat the
      // same-target retry as an idempotent success instead of presenting a red
      // error, while still rejecting attempts to redirect a retired identity
      // into a different survivor.
      if (mergedIntoPatientId === payload.primaryPatientId || mergedIntoPatientId === effectivePrimaryId) {
        return {
          success: true,
          commandId,
          idempotencyKey,
          entityId: effectivePrimaryId,
          data: {
            primaryPatientId: effectivePrimaryId,
            secondaryPatientId: effectiveSecondaryId,
            status: 'MERGED',
            alreadyMerged: true,
            allergies: Array.isArray(primary.allergies) ? primary.allergies : [],
            chronicConditions: Array.isArray(primary.chronicConditions)
              ? primary.chronicConditions
              : [],
          },
        };
      }

      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'SECONDARY_ALREADY_MERGED',
          message: mergedIntoPatientId
            ? `Secondary patient is already merged into ${mergedIntoPatientId}.`
            : 'Secondary patient has already been merged.',
        },
      };
    }

    const primaryGender = String(primary.gender || '').toLowerCase();
    const secondaryGender = String(secondary.gender || '').toLowerCase();
    if (primaryGender && secondaryGender && primaryGender !== secondaryGender && !payload.overrideDemographicConflict) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'MERGE_DEMOGRAPHIC_CONFLICT',
          message: 'Demographic conflict requires explicit governed override.',
        },
      };
    }

    const now = Date.now();
    const allergies = Array.from(new Set([
      ...(Array.isArray(primary.allergies) ? primary.allergies : []),
      ...(Array.isArray(secondary.allergies) ? secondary.allergies : []),
    ]));
    const chronicConditions = Array.from(new Set([
      ...(Array.isArray(primary.chronicConditions) ? primary.chronicConditions : []),
      ...(Array.isArray(secondary.chronicConditions) ? secondary.chronicConditions : []),
    ]));

    const primaryState = {
      ...primary,
      id: effectivePrimaryId,
      tenantId: context.tenantId,
      status: primary.status || 'ACTIVE',
      allergies,
      chronicConditions,
      updatedAt: now,
      version: Number(primary.version || 0) + 1,
    };

    const secondaryState = {
      ...secondary,
      id: effectiveSecondaryId,
      tenantId: context.tenantId,
      status: 'MERGED',
      mergedIntoPatientId: effectivePrimaryId,
      mergeReason: payload.mergeReason.trim(),
      mergedAt: now,
      mergedBy: context.actorId,
      updatedAt: now,
      version: Number(secondary.version || 0) + 1,
    };

    let tx: Awaited<ReturnType<typeof TransactionManager.executeAtomicMutation>>;
    try {
      tx = await TransactionManager.executeAtomicMutation({
      tenantId: context.tenantId,
      actorId: context.actorId,
      actorRole: context.roles[0] || 'MEDICAL_DIRECTOR',
      aggregateType: 'PATIENT_MPI',
      aggregateId: effectivePrimaryId,
      eventType: 'PATIENT_RECORDS_MERGED',
      eventPayload: {
        primaryPatientId: effectivePrimaryId,
        secondaryPatientId: effectiveSecondaryId,
        mergeReason: payload.mergeReason.trim(),
      },
      auditAction: 'PATIENT_MERGED',
      auditResourceType: 'PATIENT',
      auditResourceId: effectivePrimaryId,
      auditReason: payload.mergeReason.trim(),
      omitDomainStateFromAudit: true,
      outboxTopic: 'g-hims-patient-identity-events',
      idempotencyKey,
      commandId,
      correlationId: context.correlationId,
      domainState: primaryState,
      expectedPrimaryServerVersion: Number((primary as PatientMPI & { _serverVersion?: number })._serverVersion || 0),
      additionalStateWrites: [{
        entityType: 'PATIENT_MPI',
        entityId: effectiveSecondaryId,
        domainState: secondaryState,
        expectedServerVersion: Number((secondary as PatientMPI & { _serverVersion?: number })._serverVersion || 0),
      }],
      });
    } catch (error) {
      if (error instanceof Error && error.message.includes('DOMAIN_STATE_VERSION_CONFLICT')) {
        return {
          success: false,
          commandId,
          idempotencyKey,
          error: {
            code: 'PATIENT_MERGE_CONCURRENT_UPDATE',
            message: 'Another operation changed a patient identity while merging. Refresh MPI, verify the surviving MRN and retry with a new command.',
          },
        };
      }
      throw error;
    }

    return {
      success: true,
      commandId,
      idempotencyKey,
      entityId: effectivePrimaryId,
      eventId: tx.eventId,
      auditId: tx.auditId,
      outboxId: tx.outboxId,
      data: {
        primaryPatientId: effectivePrimaryId,
        secondaryPatientId: effectiveSecondaryId,
        status: 'MERGED',
        allergies,
        chronicConditions,
      },
    };
  }

  public static async unmerge(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: DurablePatientUnmergePayload
  ): Promise<CommandResult> {
    AuthorizationPipeline.requireRole(context, [
      'ADMINISTRATOR',
      'MEDICAL_DIRECTOR',
      'CHIEF_MEDICAL_OFFICER',
    ]);

    if (!payload.unmergeReason || payload.unmergeReason.trim().length < 10) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'UNMERGE_REASON_TOO_SHORT',
          message: 'An authoritative unmerge reason of at least 10 characters is required.',
        },
      };
    }

    const primary = await resolvePatient(
      context.tenantId,
      payload.primaryPatientId,
      context.actorId
    );
    const secondary = await resolvePatient(
      context.tenantId,
      payload.secondaryPatientId,
      context.actorId
    );

    if (!primary) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'PRIMARY_PATIENT_NOT_FOUND',
          message: `Primary surviving patient ${payload.primaryPatientId} could not be resolved.`,
        },
      };
    }

    if (!secondary) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'SECONDARY_PATIENT_NOT_FOUND',
          message: `Secondary merged patient ${payload.secondaryPatientId} could not be resolved.`,
        },
      };
    }

    const effectivePrimaryId = primary.id;
    const effectiveSecondaryId = secondary.id;

    const secondaryStatus = String(secondary.status || '').toUpperCase();
    const mergedInto = String(
      (secondary as PatientMPI & { mergedIntoPatientId?: string }).mergedIntoPatientId || ''
    ).trim();

    // Idempotent retry check: if secondary is already ACTIVE, mergedInto is cleared,
    // and was previously unmerged with matching target
    if (
      secondaryStatus === 'ACTIVE' &&
      !mergedInto &&
      (secondary as any).unmergedAt
    ) {
      return {
        success: true,
        commandId,
        idempotencyKey,
        entityId: effectiveSecondaryId,
        data: {
          primaryPatientId: effectivePrimaryId,
          secondaryPatientId: effectiveSecondaryId,
          status: 'ACTIVE',
          alreadyUnmerged: true,
        },
      };
    }

    if (secondaryStatus !== 'MERGED') {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'PATIENT_NOT_MERGED',
          message: `Patient ${effectiveSecondaryId} is currently ${secondaryStatus}, not MERGED. Only merged identities can be unmerged.`,
        },
      };
    }

    if (mergedInto && mergedInto !== effectivePrimaryId && mergedInto !== payload.primaryPatientId) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'PATIENT_MERGE_TARGET_MISMATCH',
          message: `Patient ${effectiveSecondaryId} was merged into ${mergedInto}, not ${effectivePrimaryId}. Unmerge must target the exact surviving record.`,
        },
      };
    }

    const now = Date.now();
    const secondaryState: PatientMPI & {
      unmergedAt?: number;
      unmergedBy?: string;
      unmergeReason?: string;
      mergedIntoPatientId?: string;
    } = {
      ...secondary,
      status: 'ACTIVE',
      mergedIntoPatientId: undefined,
      unmergedAt: now,
      unmergedBy: context.actorId,
      unmergeReason: payload.unmergeReason.trim(),
      updatedAt: now,
      version: Number(secondary.version || 0) + 1,
    };

    const primaryMergedIds = Array.isArray((primary as any).mergedPatientIds)
      ? ((primary as any).mergedPatientIds as string[]).filter(
          (id) => id !== effectiveSecondaryId && id !== secondary.mrn
        )
      : [];

    const primaryState: PatientMPI & {
      mergedPatientIds?: string[];
      unmergedFromHistory?: Array<{
        secondaryPatientId: string;
        unmergedAt: number;
        unmergedBy: string;
        reason: string;
      }>;
    } = {
      ...primary,
      mergedPatientIds: primaryMergedIds,
      unmergedFromHistory: [
        ...(((primary as any).unmergedFromHistory as any[]) || []),
        {
          secondaryPatientId: effectiveSecondaryId,
          unmergedAt: now,
          unmergedBy: context.actorId,
          reason: payload.unmergeReason.trim(),
        },
      ],
      updatedAt: now,
      version: Number(primary.version || 0) + 1,
    };

    let tx: Awaited<ReturnType<typeof TransactionManager.executeAtomicMutation>>;
    try {
      tx = await TransactionManager.executeAtomicMutation({
        tenantId: context.tenantId,
        actorId: context.actorId,
        actorRole: context.roles[0] || 'MEDICAL_DIRECTOR',
        aggregateType: 'PATIENT_MPI',
        aggregateId: effectiveSecondaryId,
        eventType: 'PATIENT_RECORDS_UNMERGED',
        eventPayload: {
          primaryPatientId: effectivePrimaryId,
          secondaryPatientId: effectiveSecondaryId,
          unmergeReason: payload.unmergeReason.trim(),
        },
        auditAction: 'PATIENT_UNMERGED',
        auditResourceType: 'PATIENT',
        auditResourceId: effectiveSecondaryId,
        auditReason: payload.unmergeReason.trim(),
        omitDomainStateFromAudit: true,
        outboxTopic: 'g-hims-patient-identity-events',
        idempotencyKey,
        commandId,
        correlationId: context.correlationId,
        domainState: secondaryState,
        expectedPrimaryServerVersion: Number(
          (secondary as PatientMPI & { _serverVersion?: number })._serverVersion || 0
        ),
        additionalStateWrites: [
          {
            entityType: 'PATIENT_MPI',
            entityId: effectivePrimaryId,
            domainState: primaryState,
            expectedServerVersion: Number(
              (primary as PatientMPI & { _serverVersion?: number })._serverVersion || 0
            ),
          },
        ],
      });
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes('DOMAIN_STATE_VERSION_CONFLICT')
      ) {
        return {
          success: false,
          commandId,
          idempotencyKey,
          error: {
            code: 'PATIENT_UNMERGE_CONCURRENT_UPDATE',
            message:
              'Another operation changed a patient identity while unmerging. Refresh MPI and retry.',
          },
        };
      }
      throw error;
    }

    return {
      success: true,
      commandId,
      idempotencyKey,
      entityId: effectiveSecondaryId,
      eventId: tx.eventId,
      auditId: tx.auditId,
      outboxId: tx.outboxId,
      data: {
        primaryPatientId: effectivePrimaryId,
        secondaryPatientId: effectiveSecondaryId,
        status: 'ACTIVE',
        unmergedAt: now,
      },
    };
  }
}
