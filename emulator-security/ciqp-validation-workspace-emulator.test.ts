/**
 * Run ONLY via firebase emulators:exec --project ghims-ciqp-synthetic
 * This tests the actual Next API route with Firebase Auth-emulator ID tokens,
 * stored sessions and credentialed HCM clinician authority against Firestore.
 * Data and identities are entirely disposable synthetic emulator fixtures.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { NextRequest } from 'next/server';
import { createSession } from '@/server/auth/session-service';
import { getAdminAuth, getAdminFirestore } from '@/server/firebase/admin';
import {
  GET as getValidation,
  POST as postValidation,
} from '@/app/api/clinical/validation/route';
import { assertFails, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { readFile } from 'node:fs/promises';

const projectId = 'ghims-ciqp-synthetic';
const tenantId = 'ciqp-renal-emulator';
const otherTenant = 'ciqp-renal-cross-tenant';
const facilityId = 'ciqp-test-hospital';
const departmentId = 'ciqp-test-medicine';
const password = 'SyntheticPasswordOnly!836';
const users = {
  coord: 'cv_coord_001',
  a: 'cv_doctorA_001',
  b: 'cv_doctorB_001',
  adjudicator: 'cv_adjudicator_001',
  outsider: 'cv_outsider_001',
} as const;
const tokens = new Map<string, string>();
const sessions = new Map<string, string>();
let rulesEnv: Awaited<ReturnType<typeof initializeTestEnvironment>> | null = null;

async function membership(uid: string, admin = false): Promise<void> {
  const db = getAdminFirestore();
  if (!db) throw Error('CIQP_TEST_FIRESTORE_UNAVAILABLE');
  const tenant = db.collection('tenants').doc(tenantId);
  await tenant.collection('users').doc(uid).set({
    userId: uid, tenantId, status: 'ACTIVE',
    roles: admin ? ['SYSTEM_ADMIN'] : ['DOCTOR'],
    permissions: admin ? ['CLINICAL_VALIDATION_ADMIN'] : ['CLINICAL_VALIDATION_REVIEW'],
    facilityIds: [facilityId], departmentIds: [departmentId],
    credentialStatus: 'VERIFIED', clinicalPrivileges: [],
    email: uid + '@synthetic.invalid',
  });
  if (admin) return;

  const employeeId = 'emp_' + uid;
  await tenant.collection('employees').doc(employeeId).set({
    employeeId, tenantId, userId: uid, employmentStatus: 'ACTIVE',
    facilityIds: [facilityId], departmentIds: [departmentId],
  });
  await tenant.collection('clinicalCredentials').doc('creds_' + uid).set({
    credentialId: 'creds_' + uid, employeeId,
    isMandatoryForPractice: true, verificationStatus: 'VERIFIED',
    verifiedByActorId: 'synthetic-credential-verifier',
    verifiedAt: '2026-10-20T08:00:00.000Z',
    issueDate: '2024-01-01', expiryDate: '2030-12-31',
  });
  await tenant.collection('clinicalPrivileges').doc('priv_' + uid).set({
    privilegeId: 'priv_' + uid, employeeId,
    privilegeType: 'SIGN_CLINICAL_NOTE', status: 'GRANTED',
    effectiveFrom: '2024-01-01', effectiveUntil: '2030-12-31',
    facilityId, departmentId,
  });
}

async function signIn(uid: string): Promise<string> {
  const response = await fetch(
    'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=synthetic-only',
    { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: uid + '@synthetic.invalid', password, returnSecureToken: true }) }
  );
  const payload = await response.json() as { idToken?: string; error?: { message?: string } };
  if (!response.ok || !payload.idToken) throw Error('CIQP_EMULATOR_LOGIN_FAILED:' + String(payload.error?.message || response.status));
  return payload.idToken;
}

function request(uid: string, method: 'GET' | 'POST', body?: Record<string, unknown>, tenant = tenantId): NextRequest {
  return new NextRequest('http://127.0.0.1:3000/api/clinical/validation?tenantId=' + encodeURIComponent(tenant), {
    method,
    headers: {
      Authorization: 'Bearer ' + tokens.get(uid),
      'x-ghims-session-id': sessions.get(uid) || '',
      'x-ghims-tenant-id': tenant,
      ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

async function post(uid: string, body: Record<string, unknown>, tenant = tenantId) {
  const response = await postValidation(request(uid, 'POST', body, tenant));
  const data = await response.json() as {
    success: boolean; error?: { code: string }; result?: unknown;
  };
  return { status: response.status, ...data };
}

async function get(uid: string, tenant = tenantId) {
  const response = await getValidation(request(uid, 'GET', undefined, tenant));
  const data = await response.json() as {
    success: boolean; cases?: Array<Record<string, any>>; role?: string; error?: { code: string };
  };
  return { status: response.status, ...data };
}

function assessment(caseId: string, judgment: string, ref = 'creatinine-a') {
  return {
    action: 'SUBMIT_ASSESSMENT', caseId, judgment,
    confidence: 'MEDIUM', evidenceRefs: [ref],
    rationale: 'Synthetic evidence was independently reviewed by this assigned test clinician.',
    attestation: 'I confirm this is my independent clinical assessment of synthetic evidence.',
  };
}

beforeAll(async () => {
  for (const [key,value] of Object.entries({
    GHIMS_RUNTIME_MODE: 'TEST',
    NEXT_PUBLIC_GHIMS_RUNTIME_MODE: 'TEST',
    FIREBASE_PROJECT_ID: projectId,
    GHIMS_FIREBASE_PROJECT_ID_TEST: projectId,
    NEXT_PUBLIC_FIREBASE_PROJECT_ID: projectId,
    FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
    FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099',
  })) if (process.env[key] !== value) throw Error('CIQP_EMULATOR_ENVIRONMENT_REQUIRED:' + key);

  const auth = getAdminAuth();
  const db = getAdminFirestore();
  if (!auth || !db) throw Error('CIQP_AUTH_AND_FIRESTORE_EMULATORS_REQUIRED');
  // Fixture data can be recreated only inside the explicitly isolated CI project.
  for (const uid of Object.values(users)) {
    try { await auth.getUser(uid); }
    catch { await auth.createUser({uid,email:uid+'@synthetic.invalid',password,emailVerified:true}); }
    await membership(uid, uid === users.coord);
    const idToken = await signIn(uid);
    tokens.set(uid, idToken);
    sessions.set(uid, (await createSession({userId:uid,tenantId})).sessionId);
  }

  const rules = await readFile('firestore.rules', 'utf8');
  rulesEnv = await initializeTestEnvironment({
    projectId,
    firestore: { host: '127.0.0.1', port: 8080, rules },
  });
}, 120_000);

afterAll(async () => {
  if (rulesEnv) await rulesEnv.cleanup();
});

describe('CIQP real Auth+Firestore emulator route qualification', () => {
  test('rejects missing Firebase token and missing session', async () => {
    const absent = await getValidation(new NextRequest(
      'http://127.0.0.1:3000/api/clinical/validation?tenantId=' + tenantId
    ));
    expect(absent.status).toBeGreaterThanOrEqual(400);
    const missingSession = new NextRequest('http://127.0.0.1:3000/api/clinical/validation?tenantId=' + tenantId, {
      headers: {Authorization: 'Bearer ' + tokens.get(users.a)},
    });
    const res = await getValidation(missingSession);
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  test('coordinator seeds exactly three cases; duplicate and reviewer assignment denied', async () => {
    const assignment = {
      action: 'INITIALIZE_STUDY',
      reviewerAUid: users.a, reviewerBUid: users.b,
      adjudicatorUid: users.adjudicator,
    };
    const unauthorized = await post(users.a, assignment);
    expect(unauthorized.status).toBe(403);
    const first = await post(users.coord, assignment);
    expect(first.status).toBe(201);
    expect(first.success).toBe(true);
    const duplicate = await post(users.coord, assignment);
    expect(duplicate.status).toBe(409);
    const coord = await get(users.coord);
    expect(coord.success).toBe(true);
    expect(coord.cases).toHaveLength(3);
    expect(coord.cases?.every(c => c.myAssessment === null &&
      c.primaryAssessments === undefined)).toBe(true);
  });

  test('wrong tenant and unassigned clinician cannot read assigned case or submit', async () => {
    const cross = await get(users.a, otherTenant);
    expect(cross.status).toBe(403);
    const outsider = await get(users.outsider);
    expect(outsider.status).toBe(200);
    expect(outsider.cases).toEqual([]);
    const attempt = await post(users.outsider, assessment('renal-synthetic-001','YES'));
    expect(attempt.status).toBe(403);
  });

  test('primary reviewer A submits; B and adjudicator see no prelock opinion', async () => {
    const beforeA = await get(users.a);
    expect(beforeA.cases?.find(c => c.caseId==='renal-synthetic-001')?.primaryAssessments).toBeUndefined();
    const first = await post(users.a, assessment('renal-synthetic-001', 'YES'));
    expect(first.status).toBe(201);
    const replay = await post(users.a, assessment('renal-synthetic-001','NO'));
    expect(replay.status).toBe(409);

    const b = await get(users.b);
    expect(b.cases?.find(c=>c.caseId==='renal-synthetic-001')?.myAssessment).toBeNull();
    expect(b.cases?.find(c=>c.caseId==='renal-synthetic-001')?.primaryAssessments).toBeUndefined();
    const adj = await get(users.adjudicator);
    expect(adj.cases?.find(c=>c.caseId==='renal-synthetic-001')?.primaryAssessments).toBeUndefined();
    const early = await post(users.adjudicator, assessment('renal-synthetic-001', 'YES'));
    expect(early.status).toBe(409);
  });

  test('B locks independent review; adjudicator alone sees deidentified opinions and can finalize', async () => {
    const second = await post(users.b, assessment('renal-synthetic-001','NO', 'creatinine-c'));
    expect(second.status).toBe(201);
    const b = await get(users.b);
    expect(b.cases?.find(c=>c.caseId==='renal-synthetic-001')?.primaryAssessments).toBeUndefined();
    const adj = await get(users.adjudicator);
    const target = adj.cases?.find(c=>c.caseId==='renal-synthetic-001');
    expect(target?.primaryAssessments).toHaveLength(2);
    expect(target?.primaryAssessments?.map((x:any)=>x.judgment).sort()).toEqual(['NO','YES']);
    expect(JSON.stringify(target?.primaryAssessments)).not.toContain(users.a);
    expect(JSON.stringify(target?.primaryAssessments)).not.toContain(users.b);
    const finalized = await post(users.adjudicator,assessment('renal-synthetic-001','INSUFFICIENT_EVIDENCE','context-unknown'));
    expect(finalized.status).toBe(201);
    const coord = await get(users.coord);
    const row = coord.cases?.find(c=>c.caseId==='renal-synthetic-001');
    expect(row?.status).toBe('ADJUDICATED');
    expect(row?.primaryAssessments).toBeUndefined();
    expect(row?.myAssessment).toBeNull();
  });

  test('invalid and forged evidence citations are rejected without writes', async () => {
    const invalid = await post(users.a,assessment('renal-synthetic-002','YES','forged-evidence'));
    expect(invalid.status).toBe(400);
    const db = getAdminFirestore()!;
    const record = await db.collection('tenants').doc(tenantId)
      .collection('clinicalValidationAssessments').doc('renal-synthetic-002_'+users.a).get();
    expect(record.exists).toBe(false);
  });

  test('revoking canonical clinical privilege blocks fresh reviewer access', async () => {
    const db = getAdminFirestore()!;
    await db.collection('tenants').doc(tenantId).collection('clinicalPrivileges')
      .doc('priv_'+users.outsider).update({status:'REVOKED'});
    const denied = await get(users.outsider);
    expect(denied.status).toBe(403);
  });

  test('a synthetic clinical submission writes an event and audit; no clinical order', async () => {
    const db = getAdminFirestore()!;
    const tenant = db.collection('tenants').doc(tenantId);
    const eventSnap = await tenant.collection('events')
      .where('aggregateType','==','CLINICAL_VALIDATION_SYNTHETIC').get();
    const auditSnap = await tenant.collection('audit_logs')
      .where('resourceType','==','CLINICAL_VALIDATION_SYNTHETIC').get();
    expect(eventSnap.size).toBe(6);
    expect(auditSnap.size).toBe(6);
    expect(eventSnap.docs.every(d => d.data().payload?.syntheticOnly===true)).toBe(true);
    const orderSnap = await tenant.collection('orders').get();
    expect(orderSnap.empty).toBe(true);
  });

  test('stages 120 locked synthetic rehearsal cases without unlocking the clinical study', async () => {
    const result = await post(users.coord, { action: 'STAGE_SYNTHETIC_REHEARSAL' });
    expect(result.status).toBe(201);
    expect((result.result as { caseCount: number }).caseCount).toBe(120);
    const again = await post(users.coord, { action: 'STAGE_SYNTHETIC_REHEARSAL' });
    expect(again.status).toBe(409);
    const denied = await post(users.a, { action: 'STAGE_SYNTHETIC_REHEARSAL' });
    expect(denied.status).toBe(403);
    const coordinator = await get(users.coord);
    const cohort = (coordinator as unknown as {cohort?: {
      present: boolean; caseCount: number; policyApproved: boolean; outcomesAvailable: boolean;
    }}).cohort;
    expect(cohort?.present).toBe(true);
    expect(cohort?.caseCount).toBe(120);
    expect(cohort?.policyApproved).toBe(false);
    expect(cohort?.outcomesAvailable).toBe(false);
    const db = getAdminFirestore()!;
    const tenant = db.collection('tenants').doc(tenantId);
    const records = await tenant.collection('clinicalValidationRehearsalCases').get();
    expect(records.size).toBe(120);
    expect(records.docs.every(x => x.data().classification === 'SYNTHETIC_ONLY')).toBe(true);
    const nonCoordinator = await get(users.a);
    expect(JSON.stringify(nonCoordinator)).not.toContain('sourceHashVerified');
  });

  test('Firestore rules deny direct review case reads and writes, including authenticated staff', async () => {
    if (!rulesEnv) throw Error('RULES_ENV_REQUIRED');
    for (const uid of [users.a,users.b,users.coord,users.outsider]) {
      const client = rulesEnv.authenticatedContext(uid,{tenantId}).firestore();
      for (const name of ['clinicalValidationCases','clinicalValidationAssessments']) {
        const record = doc(client,'tenants',tenantId,name,'renal-synthetic-001');
        await assertFails(getDoc(record));
        await assertFails(setDoc(record,{judgment:'FORGED'}));
      }
    }
  });
});
