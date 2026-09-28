type LogLevel = 'INFO' | 'WARN' | 'ERROR';

const SENSITIVE_KEY = /(patient|mrn|name|email|phone|address|dob|diagnos|medication|note|password|token|secret|authorization|cookie|private.?key)/i;

function redact(value: unknown, depth = 0): unknown {
  if (depth > 5) return '[TRUNCATED]';
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  if (!value || typeof value !== 'object') return value;

  const output: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    output[key] = SENSITIVE_KEY.test(key) ? '[REDACTED]' : redact(nested, depth + 1);
  }
  return output;
}

export interface OperationalLogEvent {
  event: string;
  level?: LogLevel;
  correlationId?: string;
  requestId?: string;
  tenantId?: string;
  component?: string;
  metadata?: Record<string, unknown>;
}

export function buildStructuredLog(event: OperationalLogEvent): Record<string, unknown> {
  return {
    timestamp: new Date().toISOString(),
    level: event.level || 'INFO',
    event: event.event,
    ...(event.component ? { component: event.component } : {}),
    ...(event.correlationId ? { correlationId: event.correlationId } : {}),
    ...(event.requestId ? { requestId: event.requestId } : {}),
    ...(event.tenantId ? { tenantId: event.tenantId } : {}),
    metadata: redact(event.metadata || {}),
  };
}

export function logOperationalEvent(event: OperationalLogEvent): void {
  const payload = JSON.stringify(buildStructuredLog(event));
  if (event.level === 'ERROR') console.error(payload);
  else if (event.level === 'WARN') console.warn(payload);
  else console.info(payload);
}
