import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  const rules = await readFile(join(process.cwd(), 'firestore.rules'), 'utf8');

  testEnv = await initializeTestEnvironment({
    projectId: 'ghims-p0-ci',
    firestore: {
      host: '127.0.0.1',
      port: 8080,
      rules,
    },
  });

  await testEnv.clearFirestore();

  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();

    await setDoc(doc(db, 'tenants', 'tenant-a'), {
      name: 'Tenant A',
    });
    await setDoc(doc(db, 'tenants', 'tenant-b'), {
      name: 'Tenant B',
    });

    await setDoc(doc(db, 'tenants', 'tenant-a', 'users', 'user-a'), {
      userId: 'user-a',
      tenantId: 'tenant-a',
      status: 'ACTIVE',
      role: 'doctor',
    });
    await setDoc(doc(db, 'tenants', 'tenant-a', 'users', 'user-other'), {
      userId: 'user-other',
      tenantId: 'tenant-a',
      status: 'ACTIVE',
      role: 'nurse',
    });
    await setDoc(doc(db, 'tenants', 'tenant-b', 'users', 'user-b'), {
      userId: 'user-b',
      tenantId: 'tenant-b',
      status: 'ACTIVE',
      role: 'doctor',
    });

    await setDoc(doc(db, 'tenants', 'tenant-a', 'patients', 'pat-a'), {
      id: 'pat-a',
      mrn: 'MRN-A',
    });
    await setDoc(doc(db, 'tenants', 'tenant-b', 'patients', 'pat-b'), {
      id: 'pat-b',
      mrn: 'MRN-B',
    });

    await setDoc(doc(db, 'tenants', 'tenant-a', 'users', 'user-billing'), {
      userId: 'user-billing',
      tenantId: 'tenant-a',
      status: 'ACTIVE',
      role: 'billing_clerk',
      roles: ['billing_clerk'],
    });
    await setDoc(doc(db, 'tenants', 'tenant-a', 'users', 'user-patient'), {
      userId: 'user-patient',
      tenantId: 'tenant-a',
      status: 'ACTIVE',
      role: 'patient',
      roles: ['patient'],
    });
    await setDoc(doc(db, 'tenants', 'tenant-a', 'users', 'user-admin'), {
      userId: 'user-admin',
      tenantId: 'tenant-a',
      status: 'ACTIVE',
      role: 'administrator',
      roles: ['administrator'],
    });
    await setDoc(doc(db, 'tenants', 'tenant-a', 'users', 'user-suspended'), {
      userId: 'user-suspended',
      tenantId: 'tenant-a',
      status: 'SUSPENDED',
      role: 'doctor',
      roles: ['doctor'],
    });
    await setDoc(doc(db, 'tenants', 'tenant-a', 'invoices', 'inv-a'), {
      id: 'inv-a',
      patientId: 'pat-a',
      totalMinorUnits: 1000,
    });
    await setDoc(doc(db, 'tenants', 'tenant-a', 'audit_logs', 'audit-a'), {
      id: 'audit-a',
      action: 'TEST',
    });
    await setDoc(doc(db, 'tenants', 'tenant-a', 'telehealthSessions', 'th-private'), {
      id: 'th-private', patientId: 'pat-a', roomToken: 'ROOM-PRIVATE',
      soapNote: { subjective: 'patient-only history' },
    });

    await setDoc(doc(db, 'patients', 'legacy-pat'), {
      id: 'legacy-pat',
      mrn: 'LEGACY',
    });
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

describe('Firestore P0 tenant isolation and server-authoritative writes', () => {
  test('anonymous user cannot read tenant patient PHI', async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, 'tenants', 'tenant-a', 'patients', 'pat-a')));
  });

  test('authenticated clinician cannot bypass server ABAC with raw tenant patient reads', async () => {
    const db = testEnv.authenticatedContext('user-a', {
      tenantId: 'tenant-a',
      accessibleTenants: ['tenant-a'],
      role: 'doctor',
    }).firestore();

    await assertFails(
      getDoc(doc(db, 'tenants', 'tenant-a', 'patients', 'pat-a'))
    );
  });

  test('tenant A authenticated user cannot read tenant B patient', async () => {
    const db = testEnv.authenticatedContext('user-a', {
      tenantId: 'tenant-a',
      accessibleTenants: ['tenant-a'],
      role: 'doctor',
    }).firestore();

    await assertFails(getDoc(doc(db, 'tenants', 'tenant-b', 'patients', 'pat-b')));
  });

  test('signed-in user cannot read legacy root patient collection', async () => {
    const db = testEnv.authenticatedContext('user-a', {
      tenantId: 'tenant-a',
      accessibleTenants: ['tenant-a'],
    }).firestore();

    await assertFails(getDoc(doc(db, 'patients', 'legacy-pat')));
  });

  test('browser cannot directly mutate tenant patient state', async () => {
    const db = testEnv.authenticatedContext('user-a', {
      tenantId: 'tenant-a',
      accessibleTenants: ['tenant-a'],
      role: 'doctor',
    }).firestore();

    await assertFails(
      setDoc(doc(db, 'tenants', 'tenant-a', 'patients', 'new-patient'), {
        id: 'new-patient',
      })
    );
  });

  test('browser cannot create audit, event, outbox, idempotency or journal authority records', async () => {
    const db = testEnv.authenticatedContext('user-a', {
      tenantId: 'tenant-a',
      accessibleTenants: ['tenant-a'],
      role: 'doctor',
    }).firestore();

    const forbiddenWrites = [
      ['audit_logs', 'audit-1'],
      ['events', 'evt-1'],
      ['outbox', 'out-1'],
      ['idempotency', 'idem-1'],
      ['journalEntries', 'je-1'],
    ] as const;

    for (const [collectionName, id] of forbiddenWrites) {
      await assertFails(
        setDoc(doc(db, 'tenants', 'tenant-a', collectionName, id), {
          createdBy: 'user-a',
        })
      );
    }
  });

  test('user can read own membership but not another user membership', async () => {
    const db = testEnv.authenticatedContext('user-a', {
      tenantId: 'tenant-a',
      accessibleTenants: ['tenant-a'],
    }).firestore();

    await assertSucceeds(getDoc(doc(db, 'tenants', 'tenant-a', 'users', 'user-a')));
    await assertFails(getDoc(doc(db, 'tenants', 'tenant-a', 'users', 'user-other')));
  });

  test('browser cannot create or update tenant membership', async () => {
    const db = testEnv.authenticatedContext('user-a', {
      tenantId: 'tenant-a',
      accessibleTenants: ['tenant-a'],
      role: 'administrator',
    }).firestore();

    await assertFails(
      setDoc(doc(db, 'tenants', 'tenant-a', 'users', 'attacker'), {
        userId: 'attacker',
        tenantId: 'tenant-a',
        role: 'administrator',
        status: 'ACTIVE',
      })
    );
  });

  test('browser cannot access session state', async () => {
    const db = testEnv.authenticatedContext('user-a', {
      tenantId: 'tenant-a',
      accessibleTenants: ['tenant-a'],
    }).firestore();

    await assertFails(getDoc(doc(db, 'tenants', 'tenant-a', 'sessions', 'sess-1')));
    await assertFails(
      setDoc(doc(db, 'tenants', 'tenant-a', 'sessions', 'sess-1'), {
        userId: 'user-a',
      })
    );
  });

  test('suspended membership is denied even when the token still carries the tenant claim', async () => {
    const db = testEnv.authenticatedContext('user-suspended', {
      tenantId: 'tenant-a',
      accessibleTenants: ['tenant-a'],
      roles: ['doctor'],
    }).firestore();

    await assertFails(getDoc(doc(db, 'tenants', 'tenant-a', 'patients', 'pat-a')));
    await assertFails(getDoc(doc(db, 'tenants', 'tenant-a')));
  });

  test('patient role cannot browse tenant-wide clinical PHI', async () => {
    const db = testEnv.authenticatedContext('user-patient', {
      tenantId: 'tenant-a',
      accessibleTenants: ['tenant-a'],
      roles: ['patient'],
    }).firestore();

    await assertFails(getDoc(doc(db, 'tenants', 'tenant-a', 'patients', 'pat-a')));
  });

  test('billing role can read finance but cannot read clinical patient charts', async () => {
    const db = testEnv.authenticatedContext('user-billing', {
      tenantId: 'tenant-a',
      accessibleTenants: ['tenant-a'],
      roles: ['billing_clerk'],
    }).firestore();

    await assertSucceeds(getDoc(doc(db, 'tenants', 'tenant-a', 'invoices', 'inv-a')));
    await assertFails(getDoc(doc(db, 'tenants', 'tenant-a', 'patients', 'pat-a')));
  });

  test('clinical role must use server clinical APIs and cannot read finance directly', async () => {
    const db = testEnv.authenticatedContext('user-a', {
      tenantId: 'tenant-a',
      accessibleTenants: ['tenant-a'],
      roles: ['doctor'],
    }).firestore();

    await assertFails(
      getDoc(doc(db, 'tenants', 'tenant-a', 'patients', 'pat-a'))
    );
    await assertFails(
      getDoc(doc(db, 'tenants', 'tenant-a', 'invoices', 'inv-a'))
    );
  });

  test('audit logs are administrator-only', async () => {
    const doctorDb = testEnv.authenticatedContext('user-a', {
      tenantId: 'tenant-a',
      accessibleTenants: ['tenant-a'],
      roles: ['doctor'],
    }).firestore();
    const adminDb = testEnv.authenticatedContext('user-admin', {
      tenantId: 'tenant-a',
      accessibleTenants: ['tenant-a'],
      roles: ['administrator'],
    }).firestore();

    await assertFails(getDoc(doc(doctorDb, 'tenants', 'tenant-a', 'audit_logs', 'audit-a')));
    await assertSucceeds(getDoc(doc(adminDb, 'tenants', 'tenant-a', 'audit_logs', 'audit-a')));
  });
});


describe('Telehealth PHI is never readable directly from Firestore clients', () => {
  for (const [uid, role] of [
    ['user-a', 'doctor'],
    ['user-other', 'nurse'],
    ['user-admin', 'administrator'],
  ] as const) {
    test(`${role} cannot directly fetch a telehealth session or room secret`, async () => {
      const db = testEnv.authenticatedContext(uid, {
        tenantId: 'tenant-a',
        accessibleTenants: ['tenant-a'],
      }).firestore();
      await assertFails(getDoc(doc(db, 'tenants', 'tenant-a', 'telehealthSessions', 'th-private')));
    });
  }
});
