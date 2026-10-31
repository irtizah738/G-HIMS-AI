import { z } from 'zod/v3';

export const sourceLimitedBriefSchema = z.object({
  executiveSummary: z.string().min(1).max(4000),
  sbar: z.object({
    situation: z.string().min(1).max(2000),
    background: z.string().min(1).max(3000),
    assessment: z.string().min(1).max(3000),
    recommendation: z.string().min(1).max(3000),
  }).strict(),
  observedRiskSignals: z.array(z.string().min(1).max(1000)).max(30),
  missingOrUnverifiedInformation: z.array(z.string().min(1).max(1000)).max(30),
  sourceLimited: z.literal(true),
}).strict();

export type SourceLimitedBrief = z.infer<typeof sourceLimitedBriefSchema>;
export const MAX_INTAKE_REQUEST_BYTES = 256 * 1024;
export const MAX_INTAKE_MODEL_RESPONSE_BYTES = 32 * 1024;

export class IntakePayloadError extends Error {
  constructor(public readonly code: 'INVALID_INTAKE_JSON' | 'INTAKE_PAYLOAD_TOO_LARGE',
              public readonly status: 400 | 413) {
    super(code);
    this.name = 'IntakePayloadError';
  }
}

export async function readBoundedIntakeRequest(request: Request): Promise<Record<string, unknown>> {
  const declared = request.headers.get('content-length');
  if (declared && Number.isFinite(Number(declared)) && Number(declared) > MAX_INTAKE_REQUEST_BYTES)
    throw new IntakePayloadError('INTAKE_PAYLOAD_TOO_LARGE', 413);
  if (!request.body) throw new IntakePayloadError('INVALID_INTAKE_JSON', 400);
  const reader = request.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let bytes = 0;
  let json = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_INTAKE_REQUEST_BYTES) {
        await reader.cancel();
        throw new IntakePayloadError('INTAKE_PAYLOAD_TOO_LARGE', 413);
      }
      json += decoder.decode(value, { stream: true });
    }
    json += decoder.decode();
    const body: unknown = JSON.parse(json);
    if (!body || typeof body !== 'object' || Array.isArray(body))
      throw new IntakePayloadError('INVALID_INTAKE_JSON', 400);
    return body as Record<string, unknown>;
  } catch (error) {
    if (error instanceof IntakePayloadError) throw error;
    throw new IntakePayloadError('INVALID_INTAKE_JSON', 400);
  } finally {
    reader.releaseLock();
  }
}

export function parseSourceLimitedBrief(text: string | undefined): SourceLimitedBrief | null {
  if (!text || text.length > MAX_INTAKE_MODEL_RESPONSE_BYTES) return null;
  if (new TextEncoder().encode(text).byteLength > MAX_INTAKE_MODEL_RESPONSE_BYTES) return null;
  try {
    const decoded: unknown = JSON.parse(text.trim());
    const result = sourceLimitedBriefSchema.safeParse(decoded);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
