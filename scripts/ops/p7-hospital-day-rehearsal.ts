export {};

type PersonaKey =
  | 'admin'
  | 'reception'
  | 'nurse'
  | 'doctor'
  | 'billing'
  | 'lab'
  | 'pharmacy';

interface AuthenticatedPersona {
  key: PersonaKey;
  email: string;
  idToken: string;
  sessionId: string;
  tenantId: string;
  roles: string[];
}

interface EvidenceCheck {
  name: string;
  persona?: PersonaKey;
  ok: boolean;
  status?: number;
  details?: Record<string, unknown>;
}

const baseUrlRaw = String(process.env.GHIMS_P7_BASE_URL || '').trim();
const tenantId = String(process.env.GHIMS_P7_TENANT_ID || 'p7-hospital-zero')
  .trim()
  .toLowerCase();
const apiKey = String(process.env.NEXT_PUBLIC_FIREBASE_API_KEY || '').trim();
const password = String(process.env.GHIMS_P7_BOOTSTRAP_PASSWORD || '');
const runtime = String(process.env.GHIMS_RUNTIME_MODE || '').trim().toUpperCase();

if (runtime !== 'STAGING') {
  throw new Error('P7_REHEARSAL_STAGING_ONLY');
}
if (!baseUrlRaw) throw new Error('P7_BASE_URL_REQUIRED');
if (!apiKey) throw new Error('P7_FIREBASE_WEB_API_KEY_REQUIRED');
if (password.length < 16) throw new Error('P7_BOOTSTRAP_PASSWORD_REQUIRED');

const baseUrl = new URL(baseUrlRaw);
if (baseUrl.protocol !== 'https:') throw new Error('P7_HTTPS_REQUIRED');

const bypassHeaderName = String(process.env.GHIMS_P7_BYPASS_HEADER_NAME || '').trim();
const bypassHeaderValue = String(process.env.GHIMS_P7_BYPASS_HEADER_VALUE || '').trim();
const timeoutMs = Number(process.env.GHIMS_P7_TIMEOUT_MS || 20000);

const personaEmails: Record<PersonaKey, string> = {
  admin: process.env.GHIMS_P7_ADMIN_EMAIL || 'p7.admin@g-hims.invalid',
  reception: process.env.GHIMS_P7_RECEPTION_EMAIL || 'p7.reception@g-hims.invalid',
  nurse: process.env.GHIMS_P7_NURSE_EMAIL || 'p7.nurse@g-hims.invalid',
  doctor: process.env.GHIMS_P7_DOCTOR_EMAIL || 'p7.doctor@g-hims.invalid',
  billing: process.env.GHIMS_P7_BILLING_EMAIL || 'p7.billing@g-hims.invalid',
  lab: process.env.GHIMS_P7_LAB_EMAIL || 'p7.lab@g-hims.invalid',
  pharmacy: process.env.GHIMS_P7_PHARMACY_EMAIL || 'p7.pharmacy@g-hims.invalid',
};

const checks: EvidenceCheck[] = [];

function commonHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    'Cache-Control': 'no-cache',
    'User-Agent': 'G-HIMS-P7-Rehearsal/1.0',
    ...(bypassHeaderName && bypassHeaderValue
      ? { [bypassHeaderName]: bypassHeaderValue }
      : {}),
    ...(extra || {}),
  };
}

async function request(pathname: string, init?: RequestInit): Promise<Response> {
  return fetch(new URL(pathname, baseUrl), {
    ...init,
    headers: {
      ...commonHeaders(),
      ...(init?.headers || {}),
    },
    signal: AbortSignal.timeout(timeoutMs),
    redirect: 'manual',
  });
}

async function readJson(response: Response): Promise<any> {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`P7_INVALID_JSON:${response.status}:${response.url}`);
  }
}

async function firebaseSignIn(email: string): Promise<string> {
  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        password,
        returnSecureToken: true,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    }
  );
  const payload = await readJson(response);
  if (!response.ok || !payload.idToken) {
    throw new Error(
      `P7_FIREBASE_LOGIN_FAILED:${email}:${payload?.error?.message || response.status}`
    );
  }
  return String(payload.idToken);
}

async function establishSession(
  key: PersonaKey,
  email: string,
  idToken: string
): Promise<AuthenticatedPersona> {
  const response = await request('/api/auth/session', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${idToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      tenantId,
      rememberDevice: false,
      device: {
        deviceId: `p7-${key}-runner`,
        deviceType: 'QUALIFICATION_RUNNER',
        platform: 'SERVER',
        appVersion: 'P7',
      },
    }),
  });
  const payload = await readJson(response);
  if (!response.ok || !payload.authenticated || !payload.session?.sessionId) {
    throw new Error(
      `P7_SESSION_FAILED:${key}:${payload?.code || payload?.error || response.status}`
    );
  }

  return {
    key,
    email,
    idToken,
    sessionId: String(payload.session.sessionId),
    tenantId: String(payload.tenant?.tenantId || tenantId),
    roles: Array.isArray(payload.authorization?.roles)
      ? payload.authorization.roles.map(String)
      : [],
  };
}

function authHeaders(persona: AuthenticatedPersona): Record<string, string> {
  return {
    Authorization: `Bearer ${persona.idToken}`,
    'x-ghims-tenant-id': persona.tenantId,
    'x-ghims-session-id': persona.sessionId,
    'Content-Type': 'application/json',
  };
}

async function command(
  persona: AuthenticatedPersona,
  commandType: string,
  payload: Record<string, unknown>,
  idempotencyKey: string
): Promise<any> {
  const response = await request('/api/commands/execute', {
    method: 'POST',
    headers: authHeaders(persona),
    body: JSON.stringify({
      command: {
        commandId: `p7_${crypto.randomUUID()}`,
        idempotencyKey,
        tenantId: persona.tenantId,
        commandType,
        schemaVersion: 1,
        payload,
      },
    }),
  });
  const body = await readJson(response);
  checks.push({
    name: commandType,
    persona: persona.key,
    ok: response.ok && body.success === true,
    status: response.status,
    details: {
      errorCode: body?.error?.code,
      replayedFromCache: body?.replayedFromCache === true,
      entityId: body?.entityId,
    },
  });
  if (!response.ok || body.success !== true) {
    throw new Error(
      `P7_COMMAND_FAILED:${commandType}:${body?.error?.code || body?.error?.message || response.status}`
    );
  }
  return body;
}

const readyResponse = await request('/api/health/ready');
const ready = await readJson(readyResponse);
checks.push({
  name: 'readiness',
  ok: readyResponse.status === 200 && ready?.status === 'ready' && ready?.runtime === 'STAGING',
  status: readyResponse.status,
  details: {
    runtime: ready?.runtime,
    blockers: Array.isArray(ready?.blockers) ? ready.blockers : [],
  },
});
if (!checks.at(-1)?.ok) throw new Error('P7_STAGING_NOT_READY');

const personas = new Map<PersonaKey, AuthenticatedPersona>();
for (const key of Object.keys(personaEmails) as PersonaKey[]) {
  const email = String(personaEmails[key]).trim().toLowerCase();
  const idToken = await firebaseSignIn(email);
  const persona = await establishSession(key, email, idToken);
  personas.set(key, persona);

  const bootstrapResponse = await request(
    `/api/offline/bootstrap?tenantId=${encodeURIComponent(tenantId)}`,
    {
      method: 'GET',
      headers: authHeaders(persona),
    }
  );
  const bootstrap = await readJson(bootstrapResponse);
  checks.push({
    name: 'role_scoped_offline_bootstrap',
    persona: key,
    ok:
      bootstrapResponse.ok &&
      bootstrap?.success === true &&
      bootstrap?.tenantId === tenantId &&
      bootstrap?.collections &&
      typeof bootstrap.collections === 'object',
    status: bootstrapResponse.status,
    details: {
      roles: persona.roles,
      collectionNames:
        bootstrap?.collections && typeof bootstrap.collections === 'object'
          ? Object.keys(bootstrap.collections)
          : [],
    },
  });
  if (!checks.at(-1)?.ok) {
    throw new Error(`P7_BOOTSTRAP_FAILED:${key}`);
  }
}

const reception = personas.get('reception')!;
const nurse = personas.get('nurse')!;
const doctor = personas.get('doctor')!;
const billing = personas.get('billing')!;
const lab = personas.get('lab')!;
const pharmacy = personas.get('pharmacy')!;

const registrationKey = `p7-registration-${Date.now()}`;
const registrationPayload = {
  tenantId,
  fullName: 'P7 Synthetic Patient',
  gender: 'other',
  dateOfBirth: '1990-01-01',
  contactPhone: '+920000000000',
  address: 'Synthetic Qualification Address',
  identifiers: [
    {
      type: 'MRN_EXTERNAL',
      value: `P7-${Date.now()}`,
      issuer: 'G-HIMS-P7',
    },
  ],
  encounterType: 'OPD',
  department: 'General Medicine',
  priority: 'ROUTINE',
  chiefComplaint: 'Synthetic qualification encounter',
};

const registrationResponse = await request('/api/clinical/encounter/create', {
  method: 'POST',
  headers: {
    ...authHeaders(reception),
    'idempotency-key': registrationKey,
  },
  body: JSON.stringify(registrationPayload),
});
const registration = await readJson(registrationResponse);
checks.push({
  name: 'synthetic_registration',
  persona: 'reception',
  ok: registrationResponse.ok && registration?.success === true,
  status: registrationResponse.status,
});
if (!checks.at(-1)?.ok) {
  throw new Error(`P7_REGISTRATION_FAILED:${registration?.error || registrationResponse.status}`);
}

const patientId = String(registration?.data?.patient?.id || '');
const encounterId = String(registration?.data?.encounter?.id || '');
const tokenId = String(registration?.data?.queueToken?.id || '');
if (!patientId || !encounterId || !tokenId) throw new Error('P7_REGISTRATION_IDS_MISSING');

// Repeat exactly the same registration with the same idempotency key.
// The backend must return the same canonical entities and must not duplicate state.
const duplicateResponse = await request('/api/clinical/encounter/create', {
  method: 'POST',
  headers: {
    ...authHeaders(reception),
    'idempotency-key': registrationKey,
  },
  body: JSON.stringify(registrationPayload),
});
const duplicate = await readJson(duplicateResponse);
checks.push({
  name: 'registration_idempotent_retry',
  persona: 'reception',
  ok:
    duplicateResponse.ok &&
    duplicate?.success === true &&
    duplicate?.data?.patient?.id === patientId &&
    duplicate?.data?.encounter?.id === encounterId,
  status: duplicateResponse.status,
});
if (!checks.at(-1)?.ok) throw new Error('P7_REGISTRATION_IDEMPOTENCY_FAILED');

await command(
  nurse,
  'RecordVitalsCommand',
  {
    encounterId,
    patientId,
    heartRate: 78,
    bloodPressure: '118/76',
    temperature: 36.8,
    respiratoryRate: 16,
    oxygenSaturation: 98,
  },
  `p7-vitals-${encounterId}`
);

await command(
  reception,
  'UpdateOpdQueueStatusCommand',
  { tokenId, targetStatus: 'in_consultation' },
  `p7-opd-call-${tokenId}`
);

await command(
  doctor,
  'SignClinicalNoteCommand',
  {
    encounterId,
    patientId,
    category: 'SOAP',
    content:
      'Synthetic P7 qualification note. No real patient information is contained in this record.',
  },
  `p7-note-${encounterId}`
);

const order = await command(
  doctor,
  'PlaceDiagnosticOrderCommand',
  {
    encounterId,
    patientId,
    orderType: 'LAB',
    catalogCode: 'P7-CBC',
    orderName: 'Synthetic Complete Blood Count',
    priority: 'ROUTINE',
    clinicalIndication: 'P7 synthetic workflow qualification',
    estimatedCostMinorUnits: 150000,
  },
  `p7-order-${encounterId}`
);

const labBootstrapResponse = await request(
  `/api/offline/bootstrap?tenantId=${encodeURIComponent(tenantId)}`,
  { method: 'GET', headers: authHeaders(lab) }
);
const labBootstrap = await readJson(labBootstrapResponse);
const labOrders = Array.isArray(labBootstrap?.collections?.orders)
  ? labBootstrap.collections.orders
  : [];
checks.push({
  name: 'lab_order_visibility',
  persona: 'lab',
  ok:
    labBootstrapResponse.ok &&
    labOrders.some((item: any) => String(item.orderId || item.id) === String(order.entityId)),
  status: labBootstrapResponse.status,
  details: { orderId: order.entityId },
});
if (!checks.at(-1)?.ok) throw new Error('P7_LAB_ORDER_NOT_VISIBLE');

const receiptId = `p7-receipt-${crypto.randomUUID()}`;
await command(
  billing,
  'RecordCashReceiptCommand',
  {
    receiptId,
    invoiceId: `p7-invoice-${encounterId}`,
    encounterId,
    patientId,
    amountMinorUnits: 150000,
    currency: 'PKR',
    referenceNumber: `P7-${Date.now()}`,
    collectedAt: Date.now(),
    cashierName: 'P7 Staging Billing',
  },
  `p7-cash-${receiptId}`
);

const prescription = await command(
  doctor,
  'PrescribeMedicationCommand',
  {
    encounterId,
    patientId,
    drugCode: 'P7-PARA-500',
    drugName: 'Synthetic Paracetamol',
    dosage: '500 mg',
    route: 'PO',
    frequency: 'BID',
    durationDays: 3,
    instructions: 'Synthetic qualification only',
  },
  `p7-rx-${encounterId}`
);

await command(
  pharmacy,
  'DispensePrescriptionCommand',
  {
    prescriptionId: prescription.entityId,
    quantityDispensed: 6,
    batchNumber: 'P7-SYNTHETIC-BATCH',
    expiryDate: '2030-01-01',
    dispensedByName: 'P7 Staging Pharmacy',
  },
  `p7-dispense-${prescription.entityId}`
);

await command(
  doctor,
  'UpdateOpdQueueStatusCommand',
  { tokenId, targetStatus: 'completed' },
  `p7-opd-complete-${tokenId}`
);

const passed = checks.filter((check) => check.ok).length;
const failed = checks.filter((check) => !check.ok).length;

const evidence = {
  schemaVersion: 1,
  program: 'P7 Controlled Live Pilot & TRL-6 Qualification',
  runtime: 'STAGING',
  syntheticOnly: true,
  tenantId,
  baseUrl: baseUrl.origin,
  executedAt: new Date().toISOString(),
  summary: {
    total: checks.length,
    passed,
    failed,
  },
  canonicalEntities: {
    patientId,
    encounterId,
    tokenId,
    labOrderId: order.entityId,
    prescriptionId: prescription.entityId,
    cashReceiptId: receiptId,
  },
  checks,
};

process.stdout.write(JSON.stringify(evidence, null, 2) + '\n');

if (failed > 0) process.exit(1);
