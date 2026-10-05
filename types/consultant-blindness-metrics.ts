export interface ConsultantBlindnessMetrics {
  tenantId: string;
  scope: 'ACTOR' | 'TENANT';
  actorId: string;
  generatedAt: number;
  attentionCoveragePct: number;
  unresolvedAttentionItems: number;
  criticalUnacknowledgedItems: number;
  overdueAttentionItems: number;
  pendingConsultations: number;
  pendingHandoffs: number;
  unresolvedDiagnostics: number;
  deteriorationItems: number;
  ownedItems: number;
  evidenceLinkedItems: number;
  reviewedPatientCount: number;
  lastReviewAt?: number;
}
