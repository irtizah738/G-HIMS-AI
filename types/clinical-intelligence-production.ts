export const CI10I_PRODUCTION_POLICY_VERSION = 'ci10i-production-qualification-v1' as const;

export interface ClinicalIntelligenceProductionStatus {
  policyVersion: typeof CI10I_PRODUCTION_POLICY_VERSION;
  runtime: 'DEMO' | 'TEST' | 'STAGING' | 'PRODUCTION';
  ready: boolean;
  blockers: string[];
  ai: {
    state: string;
    provider?: string;
    model?: string;
    timeoutMs?: number;
    providerApproved: boolean;
    modelApproved: boolean;
    credentialsConfigured: boolean;
  };
}

export interface ClinicalIntelligenceEdgeCacheMetadata {
  cachedAt: number;
  patient360Revision: number;
  patient360SourceCheckpoint: string;
  source: 'AUTHORITATIVE_SERVER';
}
