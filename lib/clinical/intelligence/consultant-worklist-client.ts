'use client';

import { AuthClient } from '@/lib/auth/auth-client';
import type { ConsultantWorklist } from '@/types/clinical-coordination';
import type { EligibleConsultant } from '@/lib/clinical/intelligence/consultant-directory-service';

export async function loadConsultantWorklist(
  tenantId: string
): Promise<ConsultantWorklist> {
  const response = await AuthClient.authorizedFetch(
    `/api/clinical/consultant/worklist?tenantId=${encodeURIComponent(
      tenantId
    )}`,
    {
      method: 'GET',
      cache: 'no-store',
    },
    tenantId
  );

  const payload = await response.json();
  if (!response.ok || !payload?.success || !payload?.worklist) {
    throw new Error(
      payload?.error || 'Consultant worklist could not be loaded.'
    );
  }

  return payload.worklist as ConsultantWorklist;
}

export async function loadConsultantDirectory(
  tenantId: string,
  options: { departmentId?: string; specialty?: string } = {}
): Promise<EligibleConsultant[]> {
  const params = new URLSearchParams({ tenantId });
  if (options.departmentId) params.set('departmentId', options.departmentId);
  if (options.specialty) params.set('specialty', options.specialty);

  const response = await AuthClient.authorizedFetch(
    `/api/clinical/consultant/directory?${params.toString()}`,
    { method: 'GET', cache: 'no-store' },
    tenantId
  );
  const payload = await response.json();
  if (!response.ok || !payload?.success || !Array.isArray(payload.consultants)) {
    throw new Error(
      payload?.error || 'Consultant directory could not be loaded.'
    );
  }
  return payload.consultants as EligibleConsultant[];
}

async function executeConsultantCommand(
  tenantId: string,
  commandType: string,
  input: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const commandId = `cmd_cbe_${crypto.randomUUID()}`;
  const idempotencyKey = `cbe:${commandType}:${crypto.randomUUID()}`;

  const response = await AuthClient.authorizedFetch(
    '/api/commands/execute',
    {
      method: 'POST',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        command: {
          commandId,
          idempotencyKey,
          tenantId,
          commandType,
          payload: input,
          clientTimestamp: Date.now(),
          schemaVersion: 1,
        },
      }),
    },
    tenantId
  );

  const payload = await response.json();
  if (!response.ok || !payload?.success) {
    throw new Error(
      payload?.error?.message ||
        payload?.error ||
        `${commandType} failed.`
    );
  }

  return payload as Record<string, unknown>;
}

export function requestClinicalConsultation(
  tenantId: string,
  input: {
    patientId: string;
    encounterId: string;
    requestedSpecialty: string;
    requestedConsultantId?: string;
    clinicalQuestion: string;
    priority?: 'ROUTINE' | 'PRIORITY' | 'URGENT' | 'STAT';
    sourceRefs?: string[];
  }
) {
  return executeConsultantCommand(
    tenantId,
    'RequestConsultationCommand',
    input
  );
}

export function acknowledgeClinicalConsultation(
  tenantId: string,
  input: {
    patientId: string;
    encounterId: string;
    consultationId: string;
    note?: string;
  }
) {
  return executeConsultantCommand(
    tenantId,
    'AcknowledgeConsultationCommand',
    input
  );
}

export function acceptClinicalConsultation(
  tenantId: string,
  input: {
    patientId: string;
    encounterId: string;
    consultationId: string;
  }
) {
  return executeConsultantCommand(
    tenantId,
    'AcceptConsultationCommand',
    input
  );
}

export function completeClinicalConsultation(
  tenantId: string,
  input: {
    patientId: string;
    encounterId: string;
    consultationId: string;
    assessment: string;
    recommendations: string[];
    followUpRequired?: boolean;
    primaryTeamReviewRequired?: boolean;
  }
) {
  return executeConsultantCommand(
    tenantId,
    'CompleteConsultationCommand',
    input
  );
}

export function createClinicalHandoff(
  tenantId: string,
  input: {
    patientId: string;
    encounterId: string;
    toClinicianId?: string;
    toDepartmentId?: string;
    toRole?: string;
    currentProblemSummary: string;
    activeRisks?: string[];
    pendingDiagnostics?: string[];
    pendingProcedures?: string[];
    pendingConsultations?: string[];
    medicationConcerns?: string[];
    unresolvedItems?: string[];
    expectedActions?: string[];
    sourceRefs?: string[];
    patient360Revision: number;
    patient360SourceCheckpoint: string;
    sourceArtifactId?: string;
    sourceArtifactType?: 'DISEASE_INTAKE' | 'CLINICAL_DOCUMENT' | 'CONSULTATION' | 'OTHER';
  }
) {
  return executeConsultantCommand(
    tenantId,
    'CreateClinicalHandoffCommand',
    input
  );
}

export function acceptClinicalHandoff(
  tenantId: string,
  input: {
    patientId: string;
    encounterId: string;
    handoffId: string;
  }
) {
  return executeConsultantCommand(
    tenantId,
    'AcceptClinicalHandoffCommand',
    input
  );
}

export function acknowledgeClinicalOpenItem(
  tenantId: string,
  input: {
    patientId: string;
    encounterId: string;
    openItemId: string;
    note?: string;
  }
) {
  return executeConsultantCommand(
    tenantId,
    'AcknowledgeClinicalOpenItemCommand',
    input
  );
}

export function resolveClinicalOpenItem(
  tenantId: string,
  input: {
    patientId: string;
    encounterId: string;
    openItemId: string;
    resolutionReason: string;
    resolutionRef?: string;
  }
) {
  return executeConsultantCommand(
    tenantId,
    'ResolveClinicalOpenItemCommand',
    input
  );
}

export function acknowledgeClinicalEscalation(
  tenantId: string,
  input: {
    patientId: string;
    encounterId: string;
    escalationId: string;
    note?: string;
  }
) {
  return executeConsultantCommand(
    tenantId,
    'AcknowledgeClinicalEscalationCommand',
    input
  );
}
