import { readFile } from 'node:fs/promises';
import { getAdminFirestore } from '@/server/firebase/admin';

export {};

type PersonaKey =
  | 'admin'
  | 'reception'
  | 'nurse'
  | 'doctor'
  | 'billing'
  | 'lab'
  | 'pharmacy';

interface Persona {
  key: PersonaKey;
  idToken: string;
  sessionId: string;
  tenantId: string;
  roles: string[];
}

interface Check {
  name: string;
  ok: boolean;
  persona?: PersonaKey;
  status?: number;
  details?: Record<string, unknown>;
}

const runtime = String(process.env.GHIMS_RUNTIME_MODE || '').trim().toUpperCase();
const baseUrlRaw = String(process.env.GHIMS_P7_BASE_URL || '').trim();
const tenantId = String(process.env.GHIMS_P7_TENANT_ID || '').trim().toLowerCase();
const apiKey = String(process.env.NEXT_PUBLIC_FIREBASE_API_KEY || '').trim();
const password = String(process.env.GHIMS_P7_BOOTSTRAP_PASSWORD || '');
const workerKey = String(process.env.GHIMS_INTERNAL_WORKER_KEY || '').trim();
const evidencePath = String(
  process.env.GHIMS_DRP10_P7_EVIDENCE_PATH || 'p7-rehearsal.json'
).trim();
const bypassHeaderName = String(process.env.GHIMS_P7_BYPASS_HEADER_NAME || '').trim();
const bypassHeaderValue = String(process.env.GHIMS_P7_BYPASS_HEADER_VALUE || '').trim();
const timeoutMs = Number(process.env.GHIMS_DRP10_TIMEOUT_MS || 30_000);

if (runtime !== 'STAGING') throw new Error('DRP10_STAGING_ONLY');
if (!baseUrlRaw) throw new Error('DRP10_BASE_URL_REQUIRED');
if (!tenantId) throw new Error('DRP10_TENANT_REQUIRED');
if (!apiKey) throw new Error('DRP10_FIREBASE_WEB_API_KEY_REQUIRED');
if (password.length < 16) throw new Error('DRP10_BOOTSTRAP_PASSWORD_REQUIRED');
if (!workerKey) throw new Error('DRP10_INTERNAL_WORKER_KEY_REQUIRED');

const baseUrl = new URL(baseUrlRaw);
if (baseUrl.protocol !== 'https:') throw new Error('DRP10_HTTPS_REQUIRED');

const db = getAdminFirestore();
if (!db) throw new Error('DRP10_ADMIN_FIRESTORE_REQUIRED');
const tenantRef = db.collection('tenants').doc(tenantId);
const checks: Check[] = [];

function commonHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    'Cache-Control': 'no-cache',
    'User-Agent': 'G-HIMS-DRP10-Rehearsal/1.0',
    ...(bypassHeaderName && bypassHeaderValue
      ? { [bypassHeaderName]: bypassHeaderValue }
      : {}),
    ...extra,
  };
}

async function request(pathname: string, init: RequestInit = {}): Promise<Response> {
  return fetch(new URL(pathname, baseUrl), {
    ...init,
    headers: {
      ...commonHeaders(),
      ...(init.headers || {}),
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
    throw new Error(`DRP10_INVALID_JSON:${response.status}:${response.url}`);
  }
}

async function signIn(email: string): Promise<string> {
  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
      signal: AbortSignal.timeout(timeoutMs),
    }
  );
  const body = await readJson(response);
  if (!response.ok || !body.idToken) {
    throw new Error(
      `DRP10_FIREBASE_LOGIN_FAILED:${email}:${body?.error?.message || response.status}`
    );
  }
  return String(body.idToken);
}

const personaEmails: Record<PersonaKey, string> = {
  admin: process.env.GHIMS_P7_ADMIN_EMAIL || 'p7.admin@g-hims.invalid',
  reception: process.env.GHIMS_P7_RECEPTION_EMAIL || 'p7.reception@g-hims.invalid',
  nurse: process.env.GHIMS_P7_NURSE_EMAIL || 'p7.nurse@g-hims.invalid',
  doctor: process.env.GHIMS_P7_DOCTOR_EMAIL || 'p7.doctor@g-hims.invalid',
  billing: process.env.GHIMS_P7_BILLING_EMAIL || 'p7.billing@g-hims.invalid',
  lab: process.env.GHIMS_P7_LAB_EMAIL || 'p7.lab@g-hims.invalid',
  pharmacy: process.env.GHIMS_P7_PHARMACY_EMAIL || 'p7.pharmacy@g-hims.invalid',
};

async function establishPersona(key: PersonaKey): Promise<Persona> {
  const email = String(personaEmails[key]).trim().toLowerCase();
  const idToken = await signIn(email);
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
        deviceId: `drp10-${key}-runner`,
        deviceType: 'QUALIFICATION_RUNNER',
        platform: 'SERVER',
        appVersion: 'DRP10',
      },
    }),
  });
  const body = await readJson(response);
  if (!response.ok || !body.authenticated || !body.session?.sessionId) {
    throw new Error(
      `DRP10_SESSION_FAILED:${key}:${body?.code || body?.error || response.status}`
    );
  }
  return {
    key,
    idToken,
    sessionId: String(body.session.sessionId),
    tenantId: String(body.tenant?.tenantId || tenantId),
    roles: Array.isArray(body.authorization?.roles)
      ? body.authorization.roles.map(String)
      : [],
  };
}

function authHeaders(persona: Persona): Record<string, string> {
  return {
    Authorization: `Bearer ${persona.idToken}`,
    'x-ghims-tenant-id': persona.tenantId,
    'x-ghims-session-id': persona.sessionId,
    'x-ghims-device-id': `drp10-${persona.key}-runner`,
    'Content-Type': 'application/json',
  };
}

async function runCommand(
  persona: Persona,
  commandType: string,
  payload: Record<string, unknown>,
  key: string
): Promise<any> {
  const response = await request('/api/commands/execute', {
    method: 'POST',
    headers: authHeaders(persona),
    body: JSON.stringify({
      command: {
        commandId: `drp10_${crypto.randomUUID()}`,
        idempotencyKey: key,
        tenantId: persona.tenantId,
        commandType,
        schemaVersion: 1,
        payload,
      },
    }),
  });
  const body = await readJson(response);
  const ok = response.ok && body.success === true;
  checks.push({
    name: commandType,
    persona: persona.key,
    ok,
    status: response.status,
    details: {
      entityId: body?.entityId,
      eventId: body?.eventId,
      errorCode: body?.error?.code,
      replayedFromCache: body?.replayedFromCache === true,
    },
  });
  if (!ok) {
    throw new Error(
      `DRP10_COMMAND_FAILED:${commandType}:${body?.error?.code || body?.error?.message || response.status}`
    );
  }
  return body;
}

async function relayOutbox(rounds = 1): Promise<void> {
  for (let index = 0; index < rounds; index += 1) {
    const response = await request('/api/outbox/relay', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-ghims-worker-key': workerKey,
        'x-ghims-tenant-id': tenantId,
      },
      body: JSON.stringify({ tenantId }),
    });
    const body = await readJson(response);
    if (!response.ok || body.success !== true || Number(body.deadLetterCount || 0) > 0) {
      throw new Error(
        `DRP10_OUTBOX_RELAY_FAILED:${body?.error?.code || body?.error || response.status}`
      );
    }
    if (Number(body.dispatchedCount || 0) === 0) break;
  }
}

async function pollDocument(
  collection: string,
  id: string,
  predicate: (value: Record<string, any>) => boolean,
  attempts = 20
): Promise<Record<string, any>> {
  for (let index = 0; index < attempts; index += 1) {
    const snap = await tenantRef.collection(collection).doc(id).get();
    if (snap.exists) {
      const value = snap.data() as Record<string, any>;
      if (predicate(value)) return value;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
    await relayOutbox(2);
  }
  throw new Error(`DRP10_PROJECTION_TIMEOUT:${collection}/${id}`);
}

const p7Evidence = JSON.parse(await readFile(evidencePath, 'utf8'));
if (
  p7Evidence?.summary?.failed !== 0 ||
  String(p7Evidence?.tenantId || '') !== tenantId ||
  !p7Evidence?.canonicalEntities?.patientId ||
  !p7Evidence?.canonicalEntities?.encounterId
) {
  throw new Error('DRP10_VALID_P7_EVIDENCE_REQUIRED');
}

const patientId = String(p7Evidence.canonicalEntities.patientId);
const sourceEncounterId = String(p7Evidence.canonicalEntities.encounterId);

const personas = new Map<PersonaKey, Persona>();
for (const key of Object.keys(personaEmails) as PersonaKey[]) {
  personas.set(key, await establishPersona(key));
}
const admin = personas.get('admin')!;
const reception = personas.get('reception')!;
const doctor = personas.get('doctor')!;
const billing = personas.get('billing')!;
const lab = personas.get('lab')!;
const pharmacy = personas.get('pharmacy')!;

const runId = crypto.randomUUID().replaceAll('-', '').slice(0, 12);
const now = new Date();
const fiscalYear = now.getUTCFullYear();
const postingPeriod = now.getUTCMonth() + 1;
const periodStart = Date.UTC(fiscalYear, postingPeriod - 1, 1, 0, 0, 0, 0);
const periodEnd = Date.UTC(fiscalYear, postingPeriod, 1, 0, 0, 0, 0) - 1;
const today = now.toISOString().slice(0, 10);
const futureDate = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
const futureExpiry = new Date(Date.now() + 365 * 86_400_000).toISOString().slice(0, 10);

// ---------------------------------------------------------------------------
// Finance: governed accounts -> period -> balanced journal.
// ---------------------------------------------------------------------------
const financeAccounts = [
  { code: '1100', name: 'DRP-10 Cash Asset', category: 'asset', normalBalance: 'debit' },
  { code: '4100', name: 'DRP-10 Qualification Revenue', category: 'revenue', normalBalance: 'credit' },
  { code: '6510', name: 'Regular Payroll Expense', category: 'expense', normalBalance: 'debit' },
  { code: '6520', name: 'Variable Payroll Expense', category: 'expense', normalBalance: 'debit' },
  { code: '2060', name: 'Payroll Payable', category: 'liability', normalBalance: 'credit' },
] as const;
const accountIds = new Map<string, string>();
for (const account of financeAccounts) {
  const result = await runCommand(
    billing,
    'CreateFinanceAccountCommand',
    {
      accountCode: account.code,
      accountName: account.name,
      category: account.category,
      subCategory: 'DRP10_STAGING_QUALIFICATION',
      normalBalance: account.normalBalance,
      currency: 'PKR',
      allowManualPosting: true,
      allowCashReceipts: account.code === '1100',
      allowSupplierPayments: false,
      isSystemLocked: false,
    },
    `drp10-fin-account-${account.code}-${runId}`
  );
  accountIds.set(account.code, String(result.entityId));
}

await runCommand(
  billing,
  'CreateFinancePeriodCommand',
  {
    fiscalYear,
    postingPeriod,
    periodName: `DRP-10 ${fiscalYear}-${String(postingPeriod).padStart(2, '0')}`,
    startAt: periodStart,
    endAt: periodEnd,
  },
  `drp10-fin-period-${fiscalYear}-${postingPeriod}-${runId}`
);

const journal = await runCommand(
  billing,
  'PostJournalCommand',
  {
    fiscalYear,
    postingPeriod,
    documentDate: Date.now(),
    postingDate: Date.now(),
    referenceDocumentId: `DRP10-${runId}`,
    documentHeader: 'DRP-10 authenticated staging balanced journal',
    currency: 'PKR',
    sourceModule: 'MANUAL',
    lines: [
      {
        glAccountId: accountIds.get('1100'),
        glAccountName: 'DRP-10 Cash Asset',
        debitMinorUnits: 100_000,
        creditMinorUnits: 0,
        lineDescription: 'DRP-10 qualification debit',
      },
      {
        glAccountId: accountIds.get('4100'),
        glAccountName: 'DRP-10 Qualification Revenue',
        debitMinorUnits: 0,
        creditMinorUnits: 100_000,
        lineDescription: 'DRP-10 qualification credit',
      },
    ],
  },
  `drp10-fin-journal-${runId}`
);

// ---------------------------------------------------------------------------
// SCM -> inventory -> AP.
// ---------------------------------------------------------------------------
const requisitionId = `drp10-pr-${runId}`;
await runCommand(
  pharmacy,
  'SubmitPurchaseRequisitionCommand',
  {
    requisitionId,
    requisitionNumber: `DRP10-PR-${runId}`,
    facilityId: 'P7H0',
    requestingDepartment: 'Pharmacy',
    requestingLocationId: 'drp10-central-store',
    priority: 'EMERGENCY',
    items: [
      {
        itemId: 'drp10-item-paracetamol',
        itemCode: 'DRP10-PARA-500',
        itemName: 'DRP-10 Synthetic Paracetamol 500mg',
        requestedQuantity: 10,
        uom: 'TABLET',
        currentStock: 0,
        reorderPoint: 100,
        suggestedQuantity: 10,
        estimatedUnitCost: 10,
        estimatedTotal: 100,
        justification: 'Synthetic staging qualification stock',
      },
    ],
    justification: 'DRP-10 isolated staging emergency procurement qualification',
    requiredByDate: futureDate,
    estimatedTotalCost: 100,
    currency: 'PKR',
    clinicalCriticality: 'VITAL',
  },
  `drp10-pr-submit-${runId}`
);

await runCommand(
  reception,
  'ApprovePurchaseRequisitionCommand',
  { requisitionId, decision: 'APPROVED', comments: 'DRP-10 maker-checker approval' },
  `drp10-pr-approve-${runId}`
);

const poId = `drp10-po-${runId}`;
await runCommand(
  lab,
  'CreatePurchaseOrderCommand',
  {
    poId,
    poNumber: `DRP10-PO-${runId}`,
    requisitionId,
    supplierId: 'drp10-supplier-primary',
    emergencyWaiverReason:
      'DRP-10 synthetic staging emergency waiver used only to qualify the governed off-contract path.',
    currency: 'PKR',
    paymentTerms: 'NET30',
    expectedDeliveryDate: futureDate,
    destinationLocationId: 'drp10-central-store',
    destinationLocationName: 'DRP-10 Synthetic Central Store',
    items: [
      {
        lineId: `drp10-pol-${runId}`,
        itemId: 'drp10-item-paracetamol',
        quantityOrdered: 10,
        uom: 'TABLET',
        unitPrice: 10,
        discount: 0,
        taxPercent: 0,
      },
    ],
  },
  `drp10-po-create-${runId}`
);

await runCommand(
  admin,
  'ApprovePurchaseOrderCommand',
  { poId, decision: 'APPROVED', comments: 'DRP-10 independent PO approval' },
  `drp10-po-approve-${runId}`
);

const grnId = `drp10-grn-${runId}`;
await runCommand(
  pharmacy,
  'RecordGoodsReceiptCommand',
  {
    grnId,
    grnNumber: `DRP10-GRN-${runId}`,
    purchaseOrderId: poId,
    facilityId: 'P7H0',
    deliveryNoteNumber: `DRP10-DN-${runId}`,
    receivedAt: new Date().toISOString(),
    inspectionStatus: 'PASSED',
    destinationLocationId: 'drp10-central-store',
    destinationLocationName: 'DRP-10 Synthetic Central Store',
    items: [
      {
        itemId: 'drp10-item-paracetamol',
        batchId: `drp10-batch-${runId}`,
        batchNumber: `DRP10-BATCH-${runId}`,
        quantityReceived: 10,
        quantityAccepted: 10,
        quantityRejected: 0,
        quantityDamaged: 0,
        uom: 'TABLET',
        expiryDate: futureExpiry,
        manufacturer: 'DRP-10 Synthetic Manufacturer',
        inspectionPassed: true,
        unitCost: 10,
      },
    ],
  },
  `drp10-grn-${runId}`
);

const supplierInvoice = await runCommand(
  billing,
  'RecordSupplierInvoiceCommand',
  {
    facilityId: 'P7H0',
    supplierId: 'drp10-supplier-primary',
    invoiceNumber: `DRP10-SINV-${runId}`,
    poId,
    grnIds: [grnId],
    issueDate: today,
    dueDate: futureDate,
    currency: 'PKR',
    shippingMinorUnits: 0,
    priceToleranceBasisPoints: 100,
    quantityTolerance: 0,
    lines: [
      {
        lineId: `drp10-sinv-line-${runId}`,
        itemId: 'drp10-item-paracetamol',
        billedQuantity: 10,
        uom: 'TABLET',
        unitPriceMinorUnits: 1000,
        discountMinorUnits: 0,
        taxMinorUnits: 0,
      },
    ],
  },
  `drp10-supplier-invoice-${runId}`
);

await runCommand(
  admin,
  'RecognizeSupplierInvoicePayableCommand',
  {
    invoiceId: String(supplierInvoice.entityId),
    poId,
    fiscalYear,
    postingPeriod,
    documentDate: Date.now(),
    postingDate: Date.now(),
  },
  `drp10-ap-recognize-${runId}`
);

// ---------------------------------------------------------------------------
// HCM -> credential -> roster -> attendance -> payroll -> Finance.
// ---------------------------------------------------------------------------
const employee = await runCommand(
  admin,
  'CreateEmployeeCommand',
  {
    facilityIds: ['P7H0'],
    primaryFacilityId: 'P7H0',
    departmentIds: ['Administration'],
    primaryDepartmentId: 'Administration',
    primaryDepartmentName: 'Administration',
    positionId: 'DRP10-OPS',
    positionTitle: 'DRP-10 Operations Coordinator',
    employmentType: 'FULL_TIME',
    hireDate: today,
    personalInfo: {
      legalFirstName: 'DRP10',
      legalLastName: `Employee${runId}`,
      dateOfBirth: '1990-01-01',
      gender: 'UNDISCLOSED',
      contactEmail: `drp10.employee.${runId}@g-hims.invalid`,
      contactPhone: '+920000000002',
      emergencyContact: {
        name: 'Synthetic Emergency Contact',
        relationship: 'Qualification',
        phone: '+920000000003',
      },
      residentialAddress: {
        street: 'Synthetic Staging Address',
        city: 'Qualification City',
        state: 'Punjab',
        postalCode: '00000',
        country: 'Pakistan',
      },
    },
  },
  `drp10-employee-create-${runId}`
);
const employeeId = String(employee.entityId);

await runCommand(
  admin,
  'UpdateEmployeeStatusCommand',
  { employeeId, newStatus: 'ACTIVE', reason: 'DRP-10 staging qualification activation' },
  `drp10-employee-activate-${runId}`
);

const credential = await runCommand(
  admin,
  'SubmitCredentialCommand',
  {
    employeeId,
    credentialType: 'HOSPITAL_CREDENTIAL',
    title: 'DRP-10 Synthetic Hospital Credential',
    issuingAuthority: 'G-HIMS Staging Qualification Authority',
    credentialNumber: `DRP10-CRED-${runId}`,
    issueDate: today,
    expiryDate: futureExpiry,
    isMandatoryForPractice: false,
  },
  `drp10-credential-submit-${runId}`
);

await runCommand(
  admin,
  'VerifyCredentialCommand',
  {
    credentialId: String(credential.entityId),
    status: 'VERIFIED',
    notes: 'Synthetic staging qualification verification',
  },
  `drp10-credential-verify-${runId}`
);

const shiftStart = new Date(Date.now() - 60_000);
const shiftEnd = new Date(Date.now() + 30 * 60_000);
const shift = await runCommand(
  admin,
  'AssignShiftCommand',
  {
    facilityId: 'P7H0',
    facilityName: 'G-HIMS P7 Hospital-0 Staging',
    departmentId: 'Administration',
    departmentName: 'Administration',
    employeeId,
    date: shiftStart.toISOString().slice(0, 10),
    shiftId: `drp10-shift-template-${runId}`,
    shiftName: 'DRP-10 Qualification Shift',
    startTime: shiftStart.toISOString(),
    endTime: shiftEnd.toISOString(),
    notes: 'Synthetic staging qualification roster',
  },
  `drp10-shift-${runId}`
);

const clockIn = await runCommand(
  admin,
  'RecordClockInCommand',
  {
    employeeId,
    source: 'SUPERVISOR_OVERRIDE',
    deviceIdentifier: 'DRP10-STAGING-RUNNER',
    scheduledShiftId: String(shift.entityId),
  },
  `drp10-clockin-${runId}`
);
await new Promise((resolve) => setTimeout(resolve, 25));
await runCommand(
  admin,
  'RecordClockOutCommand',
  { attendanceId: String(clockIn.entityId) },
  `drp10-clockout-${runId}`
);

const compensation = await runCommand(
  admin,
  'SetCompensationCommand',
  {
    employeeId,
    payBasis: 'SALARIED',
    payFrequency: 'MONTHLY',
    currency: 'PKR',
    annualSalaryMinorUnits: 1_200_000,
    hourlyRateMinorUnits: 0,
    overtimeMultiplierBasisPoints: 15_000,
    monthlyAllowanceMinorUnits: 0,
    deductions: [],
    effectiveFrom: today,
  },
  `drp10-comp-submit-${runId}`
);
await runCommand(
  billing,
  'ReviewCompensationCommand',
  {
    compensationId: String(compensation.entityId),
    decision: 'APPROVE',
    notes: 'DRP-10 independent Finance compensation approval',
  },
  `drp10-comp-approve-${runId}`
);

const payroll = await runCommand(
  admin,
  'CreatePayrollPeriodCommand',
  {
    facilityId: 'P7H0',
    periodNumber: `DRP10-${runId}`,
    periodName: `DRP-10 Qualification Payroll ${runId}`,
    payFrequency: 'MONTHLY',
    startDate: today,
    endDate: today,
    paymentDate: today,
    currency: 'PKR',
  },
  `drp10-payroll-period-${runId}`
);
const payrollPeriodId = String(payroll.entityId);
await runCommand(
  admin,
  'EnrollPayrollEmployeeCommand',
  { periodId: payrollPeriodId, employeeId },
  `drp10-payroll-enroll-${runId}`
);
await runCommand(
  admin,
  'CalculatePayrollEmployeeCommand',
  { periodId: payrollPeriodId, employeeId },
  `drp10-payroll-calc-${runId}`
);
await runCommand(
  admin,
  'FinalizePayrollPeriodCommand',
  { periodId: payrollPeriodId },
  `drp10-payroll-finalize-${runId}`
);
await runCommand(
  billing,
  'ApprovePayrollPeriodCommand',
  { periodId: payrollPeriodId, notes: 'DRP-10 independent payroll approval' },
  `drp10-payroll-approve-${runId}`
);
await runCommand(
  admin,
  'PostPayrollPeriodCommand',
  { periodId: payrollPeriodId },
  `drp10-payroll-post-${runId}`
);

// ---------------------------------------------------------------------------
// Facilities + IPD + offline replay + Patient 360/CI-7 governed discharge.
// ---------------------------------------------------------------------------
const room = await runCommand(
  admin,
  'RegisterRoomCommand',
  {
    roomNumber: `DRP10-${runId}`,
    facilityId: 'P7H0',
    facilityName: 'G-HIMS P7 Hospital-0 Staging',
    building: 'DRP-10 Qualification Wing',
    floor: '1',
    departmentId: 'General Medicine',
    departmentName: 'General Medicine',
    roomType: 'inpatient_room',
    capacity: 1,
    currentOccupancy: 0,
    status: 'AVAILABLE',
  },
  `drp10-room-${runId}`
);
const bed = await runCommand(
  admin,
  'RegisterBedCommand',
  {
    bedNumber: `DRP10-BED-${runId}`,
    facilityId: 'P7H0',
    departmentId: 'General Medicine',
    roomId: String(room.entityId),
    ward: 'General',
    bedType: 'STANDARD',
    capabilities: ['DRP10_STAGING_QUALIFICATION'],
  },
  `drp10-bed-${runId}`
);
const admission = await runCommand(
  doctor,
  'AdmitPatientToInpatientCareCommand',
  {
    patientId,
    bedId: String(bed.entityId),
    sourceEncounterId,
    admittingDiagnosis: 'Synthetic DRP-10 inpatient qualification admission',
    targetWard: 'General Medicine',
    assignedDoctor: doctor.key,
    priority: 'ROUTINE',
  },
  `drp10-admit-${runId}`
);
const inpatientEncounterId = String(admission.entityId);

const offlineIdempotencyKey = `drp10-offline-vitals-${runId}`;
const offlineBatch = {
  deviceId: 'forged-client-device-will-be-replaced',
  tenantId,
  actorId: 'forged-client-actor-will-be-replaced',
  batchId: `drp10-batch-${runId}`,
  submittedAt: Date.now(),
  mutations: [
    {
      mutationId: `drp10-mutation-${runId}`,
      occurredAt: Date.now(),
      commandType: 'RecordVitalsCommand',
      collection: 'clinicalObservations',
      idempotencyKey: offlineIdempotencyKey,
      schemaVersion: 1,
      payload: {
        encounterId: inpatientEncounterId,
        patientId,
        heartRate: 76,
        bloodPressure: '116/74',
        temperature: 36.7,
        respiratoryRate: 15,
        oxygenSaturation: 99,
      },
    },
  ],
};
for (const attempt of [1, 2]) {
  const response = await request('/api/sync/batch', {
    method: 'POST',
    headers: authHeaders(doctor),
    body: JSON.stringify({ batch: offlineBatch }),
  });
  const body = await readJson(response);
  const ok =
    response.ok &&
    body.success === true &&
    Number(body.summary?.rejected || 0) === 0 &&
    Number(body.summary?.conflicted || 0) === 0;
  checks.push({
    name: `offline_replay_attempt_${attempt}`,
    persona: 'doctor',
    ok,
    status: response.status,
    details: body.summary || {},
  });
  if (!ok) throw new Error(`DRP10_OFFLINE_REPLAY_FAILED:${attempt}`);
}
const replayEvents = await tenantRef
  .collection('events')
  .where('idempotencyKey', '==', offlineIdempotencyKey)
  .get();
checks.push({
  name: 'offline_replay_single_authoritative_event',
  ok: replayEvents.size === 1,
  details: { eventCount: replayEvents.size },
});
if (replayEvents.size !== 1) throw new Error('DRP10_OFFLINE_DUPLICATE_EVENT');

await runCommand(
  doctor,
  'ReviewPatientClinicalKnowledgeCommand',
  {
    patientId,
    encounterId: inpatientEncounterId,
    domain: 'ALLERGIES',
    status: 'KNOWN_NONE',
    reason: 'DRP-10 synthetic qualification review',
  },
  `drp10-knowledge-allergy-${runId}`
);
await runCommand(
  doctor,
  'ReviewPatientClinicalKnowledgeCommand',
  {
    patientId,
    encounterId: inpatientEncounterId,
    domain: 'PROBLEM_LIST',
    status: 'KNOWN_NONE',
    reason: 'DRP-10 synthetic qualification review',
  },
  `drp10-knowledge-problem-${runId}`
);
await runCommand(
  pharmacy,
  'CompleteMedicationReconciliationCommand',
  {
    encounterId: inpatientEncounterId,
    patientId,
    reconciledMedicationIds: [],
    discrepancyCount: 0,
    unresolvedDiscrepancies: [],
    notes: 'DRP-10 synthetic medication reconciliation',
  },
  `drp10-medrec-${runId}`
);
await runCommand(
  doctor,
  'SignClinicalNoteCommand',
  {
    encounterId: inpatientEncounterId,
    patientId,
    category: 'DISCHARGE',
    content:
      'DRP-10 synthetic discharge summary. Qualification data only; no real patient information.',
  },
  `drp10-discharge-note-${runId}`
);

await relayOutbox(12);

const readiness = await pollDocument(
  'dischargeReadinessProjections',
  inpatientEncounterId,
  (value) =>
    String(value.patientId || '') === patientId &&
    Number(value.patient360Revision || 0) > 0
);
checks.push({
  name: 'ci7_current_discharge_readiness',
  ok: Array.isArray(readiness.blockers) && readiness.blockers.length === 0,
  details: {
    evaluationId: readiness.evaluationId,
    state: readiness.state,
    blockerCount: Array.isArray(readiness.blockers) ? readiness.blockers.length : -1,
    blockerCodes: Array.isArray(readiness.blockers)
      ? readiness.blockers.map((item: any) => item.code)
      : [],
  },
});
if (!checks.at(-1)?.ok) {
  throw new Error(
    `DRP10_CI7_BLOCKERS:${JSON.stringify(checks.at(-1)?.details || {})}`
  );
}

await runCommand(
  doctor,
  'RecordDischargeReadinessReviewCommand',
  {
    patientId,
    encounterId: inpatientEncounterId,
    evaluationId: String(readiness.evaluationId),
    outcome: 'ACKNOWLEDGED',
    reviewedFindingIds: [
      ...(Array.isArray(readiness.warnings)
        ? readiness.warnings.map((item: any) => String(item.findingId))
        : []),
      ...(Array.isArray(readiness.information)
        ? readiness.information.map((item: any) => String(item.findingId))
        : []),
    ].filter(Boolean),
    reason: 'DRP-10 staging clinician reviewed the current CI-7 evidence.',
  },
  `drp10-ci7-review-${runId}`
);

const discharge = await runCommand(
  doctor,
  'DischargeInpatientEncounterCommand',
  {
    encounterId: inpatientEncounterId,
    bedId: String(bed.entityId),
    disposition: 'HOME',
    followUpInstructions: 'Synthetic DRP-10 staging follow-up instructions',
    notes: 'DRP-10 staging qualification discharge',
  },
  `drp10-discharge-${runId}`
);
await relayOutbox(8);

const [encounterSnap, bedSnap, payrollSnap, invoiceSnap, journalSnap] =
  await Promise.all([
    tenantRef.collection('encounters').doc(inpatientEncounterId).get(),
    tenantRef.collection('beds').doc(String(bed.entityId)).get(),
    tenantRef.collection('payrollPeriods').doc(payrollPeriodId).get(),
    tenantRef.collection('scmSupplierInvoices').doc(String(supplierInvoice.entityId)).get(),
    tenantRef.collection('journalEntries').doc(String(journal.entityId)).get(),
  ]);

const finalAssertions = {
  inpatientDischarged:
    encounterSnap.exists &&
    ['DISCHARGED', 'COMPLETED'].includes(
      String(encounterSnap.data()?.status || '').toUpperCase()
    ),
  bedReleased:
    bedSnap.exists &&
    ['cleaning', 'available'].includes(
      String(bedSnap.data()?.status || '').toLowerCase()
    ),
  payrollPosted: payrollSnap.exists && payrollSnap.data()?.status === 'POSTED',
  supplierPayableRecognized:
    invoiceSnap.exists && invoiceSnap.data()?.status === 'PAYABLE_RECOGNIZED',
  manualJournalPosted: journalSnap.exists && journalSnap.data()?.status === 'POSTED',
  dischargeCommandEntity: String(discharge.entityId || '') === inpatientEncounterId,
};
const finalOk = Object.values(finalAssertions).every(Boolean);
checks.push({
  name: 'authoritative_cross_domain_final_state',
  ok: finalOk,
  details: finalAssertions,
});
if (!finalOk) throw new Error('DRP10_FINAL_STATE_ASSERTION_FAILED');

const failed = checks.filter((check) => !check.ok);
const evidence = {
  schemaVersion: 1,
  program: 'DRP-10 Authenticated Hospital E2E',
  runtime: 'STAGING',
  syntheticOnly: true,
  tenantId,
  baseUrl: baseUrl.origin,
  executedAt: new Date().toISOString(),
  runId,
  sourceP7Evidence: evidencePath,
  summary: {
    total: checks.length,
    passed: checks.length - failed.length,
    failed: failed.length,
  },
  canonicalEntities: {
    patientId,
    sourceEncounterId,
    inpatientEncounterId,
    roomId: room.entityId,
    bedId: bed.entityId,
    requisitionId,
    poId,
    grnId,
    supplierInvoiceId: supplierInvoice.entityId,
    employeeId,
    payrollPeriodId,
    financeJournalId: journal.entityId,
  },
  checks,
};

process.stdout.write(JSON.stringify(evidence, null, 2) + '\n');
if (failed.length > 0) process.exit(1);
