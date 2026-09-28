export type OperationalLevel = 'INFO' | 'WARN' | 'ERROR';
export type OperationalOutcome = 'SUCCESS' | 'REJECTED' | 'FAILURE';

export interface OperationalEvent {
  event: string;
  level?: OperationalLevel;
  outcome: OperationalOutcome;
  correlationId?: string;
  requestId?: string;
  tenantId?: string;
  durationMs?: number;
  attributes?: Record<string, string | number | boolean | null | undefined>;
  errorCode?: string;
}

const SENSITIVE_KEY = /(patient|mrn|name|email|phone|address|dob|token|authorization|password|secret|note|content|payload|raw|message)/i;

function sanitizeAttributes(
  attributes: OperationalEvent['attributes']
): Record<string, string | number | boolean | null> {
  const safe: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(attributes || {})) {
    if (SENSITIVE_KEY.test(key) || value === undefined) continue;
    safe[key] = value;
  }
  return safe;
}

function tenantFingerprint(tenantId?: string): string | undefined {
  if (!tenantId) return undefined;
  // A non-reversible process-local label is sufficient for log correlation without
  // placing the tenant identifier itself into operational logs.
  let hash = 2166136261;
  for (let i = 0; i < tenantId.length; i += 1) {
    hash ^= tenantId.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return 'tenant_' + (hash >>> 0).toString(16).padStart(8, '0');
}

export function emitOperationalEvent(input: OperationalEvent): void {
  const record = {
    schema: 'ghims.operational.v1',
    timestamp: new Date().toISOString(),
    event: input.event,
    level: input.level || (input.outcome === 'FAILURE' ? 'ERROR' : input.outcome === 'REJECTED' ? 'WARN' : 'INFO'),
    outcome: input.outcome,
    ...(input.correlationId ? { correlationId: input.correlationId } : {}),
    ...(input.requestId ? { requestId: input.requestId } : {}),
    ...(input.tenantId ? { tenant: tenantFingerprint(input.tenantId) } : {}),
    ...(typeof input.durationMs === 'number' ? { durationMs: Math.max(0, Math.round(input.durationMs)) } : {}),
    ...(input.errorCode ? { errorCode: input.errorCode } : {}),
    attributes: sanitizeAttributes(input.attributes),
  };

  const line = JSON.stringify(record);
  if (record.level === 'ERROR') console.error(line);
  else if (record.level === 'WARN') console.warn(line);
  else console.info(line);
}

export function operationalTimer() {
  const startedAt = Date.now();
  return () => Date.now() - startedAt;
}
