import { AIGateway } from '@/lib/ai/gateway';
import { CLINICAL_AI_BOUNDARY_VERSION } from '@/types/clinical-intelligence-safety';

const startedAt = Date.now();

const result = await AIGateway.generateJson<{
  status: string;
  sourceMarker: string;
}>({
  purpose: 'CLINICAL_COPILOT',
  systemInstruction:
    'This is a synthetic non-PHI production connectivity qualification. Return only the requested JSON and do not add clinical content.',
  sourceData: {
    synthetic: true,
    marker: 'CI10I_SYNTHETIC_PROVIDER_SMOKE',
  },
  responseSchema:
    '{"status":"ok","sourceMarker":"CI10I_SYNTHETIC_PROVIDER_SMOKE"}',
  temperature: 0,
  correlationId: `ci10i-live-smoke-${Date.now()}`,
});

if (
  String(result.data?.status || '').trim().toLowerCase() !== 'ok' ||
  result.data?.sourceMarker !== 'CI10I_SYNTHETIC_PROVIDER_SMOKE'
) {
  throw new Error('CI10I_LIVE_AI_SMOKE_RESPONSE_INVALID');
}
if (
  result.provenance.safetyBoundaryVersion !==
  CLINICAL_AI_BOUNDARY_VERSION
) {
  throw new Error('CI10I_LIVE_AI_SMOKE_SAFETY_BOUNDARY_INVALID');
}

process.stdout.write(
  JSON.stringify(
    {
      success: true,
      purpose: result.provenance.purpose,
      provider: result.provenance.provider,
      model: result.provenance.model,
      safetyBoundaryVersion: result.provenance.safetyBoundaryVersion,
      durationMs: Date.now() - startedAt,
      verifiedAt: new Date().toISOString(),
    },
    null,
    2
  ) + '\n'
);
