import { startHl7MllpServer, type MllpTenantRoute } from '@/server/interop/hl7-mllp-server';

function jsonRoutes(value: string | undefined): MllpTenantRoute[] {
  if (!value) throw new Error('GHIMS_HL7_MLLP_SOURCE_ROUTES_JSON is required.');
  const parsed = JSON.parse(value);
  if (!Array.isArray(parsed)) throw new Error('GHIMS_HL7_MLLP_SOURCE_ROUTES_JSON must be an array.');
  return parsed;
}

const tlsEnabled = String(process.env.GHIMS_HL7_MLLP_TLS_ENABLED || '').toLowerCase() === 'true';

const server = startHl7MllpServer({
  host: process.env.GHIMS_HL7_MLLP_HOST || '0.0.0.0',
  port: Number(process.env.GHIMS_HL7_MLLP_PORT || 2575),
  ingestUrl: process.env.GHIMS_HL7_INTERNAL_INGEST_URL || 'http://127.0.0.1:3000/api/interop/hl7/receive',
  ingestApiKey: process.env.GHIMS_HL7_INGEST_API_KEY || '',
  sourceRoutes: jsonRoutes(process.env.GHIMS_HL7_MLLP_SOURCE_ROUTES_JSON),
  tls: tlsEnabled
    ? {
        certPath: process.env.GHIMS_HL7_MLLP_TLS_CERT_PATH || '',
        keyPath: process.env.GHIMS_HL7_MLLP_TLS_KEY_PATH || '',
        caPath: process.env.GHIMS_HL7_MLLP_TLS_CA_PATH || undefined,
        requestClientCertificate: true,
        rejectUnauthorized: true,
      }
    : undefined,
});

process.on('SIGTERM', () => server.close(() => process.exit(0)));
process.on('SIGINT', () => server.close(() => process.exit(0)));
