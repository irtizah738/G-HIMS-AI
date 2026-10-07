export type DiseaseIntakeRiskSeverity =
  | 'LOW'
  | 'MODERATE'
  | 'HIGH'
  | 'CRITICAL';

export interface DiseaseIntakeRiskSnapshot {
  score: number;
  severity: DiseaseIntakeRiskSeverity;
  signalIds: string[];
  signalTitles: string[];
}

export interface DiseaseIntakeArtifact {
  intakeArtifactId: string;
  tenantId: string;
  patientId: string;
  encounterId: string;
  templateId: string;
  templateName: string;
  templateVersion?: string;
  clinicalGuidelines: string;
  guidedAnswers: Record<string, unknown>;
  specialtyHistory: Record<string, unknown>;
  selectedTreeNodeIds: string[];
  risk: DiseaseIntakeRiskSnapshot;
  specialistTargets: string[];
  sourceRefs: string[];
  patient360Revision: number;
  patient360SourceCheckpoint: string;
  authoredBy: string;
  authoredAt: number;
  status: 'FINAL';
  schemaVersion: 1;
}

export interface SaveDiseaseIntakeArtifactPayload {
  patientId: string;
  encounterId: string;
  templateId: string;
  templateName: string;
  templateVersion?: string;
  clinicalGuidelines: string;
  guidedAnswers: Record<string, unknown>;
  specialtyHistory: Record<string, unknown>;
  selectedTreeNodeIds: string[];
  observedRiskScore: number;
  observedRiskSeverity: DiseaseIntakeRiskSeverity;
  observedRiskSignalIds: string[];
  observedRiskSignalTitles: string[];
  specialistTargets: string[];
  sourceRefs?: string[];
  patient360Revision: number;
  patient360SourceCheckpoint: string;
  clinicianAttestation: true;
}
