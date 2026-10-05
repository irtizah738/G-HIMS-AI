import type {
  ClinicalEvidenceSnapshot,
  GovernedClinicalIntelligenceRequest,
  GovernedClinicalIntelligenceResult,
} from '@/types/clinical-intelligence-evidence';
import { ClinicalEvidenceService } from './clinical-evidence-service';

export interface ClinicalIntelligenceProvider {
  readonly providerName: string;

  generate(
    request: GovernedClinicalIntelligenceRequest,
    snapshot: ClinicalEvidenceSnapshot
  ): Promise<GovernedClinicalIntelligenceResult>;
}

export class GovernedClinicalIntelligenceGateway {
  public static async generate(
    provider: ClinicalIntelligenceProvider,
    request: GovernedClinicalIntelligenceRequest,
    snapshot: ClinicalEvidenceSnapshot
  ): Promise<GovernedClinicalIntelligenceResult> {
    if (
      request.tenantId !== snapshot.tenantId ||
      request.patientId !== snapshot.patientId
    ) {
      throw new Error('CI10_GENERATION_SCOPE_MISMATCH');
    }
    if (
      request.evidenceSnapshotId !== snapshot.snapshotId ||
      request.evidenceSnapshotHash !== snapshot.snapshotHash
    ) {
      throw new Error('CI10_EVIDENCE_SNAPSHOT_MISMATCH');
    }
    if (request.purpose !== snapshot.purpose) {
      throw new Error('CI10_GENERATION_PURPOSE_MISMATCH');
    }

    const result = await provider.generate(request, snapshot);
    if (result.requestId !== request.requestId) {
      throw new Error('CI10_PROVIDER_REQUEST_MISMATCH');
    }
    if (result.promptPolicyVersion !== request.promptPolicyVersion) {
      throw new Error('CI10_PROMPT_POLICY_MISMATCH');
    }

    const validation = ClinicalEvidenceService.validateGeneratedResult(
      snapshot,
      result
    );
    if (!validation.valid) {
      throw new Error(
        `CI10_UNGROUNDED_OUTPUT_BLOCKED:${validation.errors.join(',')}`
      );
    }

    return result;
  }
}
